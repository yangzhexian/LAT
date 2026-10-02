import { useEffect, useId, useState, type CSSProperties } from "react";
import type { InferenceRecord, InferenceSnapshot, ModelArchitecture } from "../../types";
import "./inference.css";

type ModuleId = "embedding" | "attention" | "ffn" | "output";
const modules: { id: ModuleId; name: string; eyebrow: string; description: string }[] = [
  { id: "embedding", name: "Token 嵌入", eyebrow: "EMBEDDING", description: "按 token 在嵌入矩阵中查表，将输入转为向量，作为 Transformer 的输入。输入处理阶段处理提示词；后续生成复用已有上下文。" },
  { id: "attention", name: "注意力", eyebrow: "ATTENTION", description: "通过 Query、Key、Value 投影结合上下文信息，并使用 KV cache 复用已计算的上下文。注意力头数量来自当前 GGUF 元数据；这里没有逐个注意力头的活动遥测。" },
  { id: "ffn", name: "前馈网络", eyebrow: "FEED FORWARD", description: "在每个 Transformer block 内对表示做非线性变换，与注意力和残差路径共同构成计算过程。图中矩阵纹理是装饰，不表示权重或激活值。" },
  { id: "output", name: "输出投影", eyebrow: "OUTPUT", description: "输出 head 将最终隐藏表示投影为词表 logits，再通过采样选择后续 token。流式收到的文本片段与单个 token 并非一一对应。" },
];
const statusLabels = { running: "推理中", completed: "已完成", cancelled: "已取消", failed: "失败" };
const phaseLabels = { prefill: "等待首段输出", decode: "生成输出", idle: "待命" };
const numberFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

function number(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? numberFormat.format(value) : "—";
}
function duration(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}
function rate(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "—";
}
function parameters(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value >= 1e9 ? `${(value / 1e9).toFixed(2)} B` : value >= 1e6 ? `${(value / 1e6).toFixed(1)} M` : number(value);
}
function useSystemReduceMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function Metric({ name, value, unit, note, prominent = false }: { name: string; value: string; unit?: string; note: string; prominent?: boolean }) {
  return <article className={`inference-metric${prominent ? " inference-metric-prominent" : ""}`}>
    <h3>{name}</h3><p className="inference-value">{value}{unit && <small>{unit}</small>}</p><span className="inference-metric-note">{note}</span>
  </article>;
}

function CallTrend({ history }: { history: InferenceRecord[] }) {
  const gradient = useId().replace(/:/g, "");
  const calls = history.slice(-24);
  const values = calls.map((call) => typeof call.tokens_per_second === "number" && Number.isFinite(call.tokens_per_second) ? call.tokens_per_second : null);
  const max = Math.max(1, ...values.map((value) => value ?? 0));
  let drawing = false;
  const path = values.map((value, index) => {
    if (value === null) { drawing = false; return ""; }
    const x = 12 + 376 * (calls.length === 1 ? 1 : index / Math.max(1, calls.length - 1));
    const command = `${drawing ? "L" : "M"}${x.toFixed(1)},${(86 - value / max * 68).toFixed(1)}`;
    drawing = true;
    return command;
  }).join(" ");
  return <figure className="inference-call-trend" aria-label="最近模型调用的生成速度，按调用顺序排列，缺失数据留空">
    <figcaption><strong>调用速度轨迹</strong><span>最近 {calls.length} 次 · tok/s · 每点为一次真实调用</span></figcaption>
    <svg viewBox="0 0 400 110" aria-hidden="true">
      <defs><linearGradient id={gradient} x1="0" x2="1"><stop stopColor="var(--accent)" /><stop offset="1" stopColor="var(--success)" /></linearGradient></defs>
      {[18, 52, 86].map((y) => <line key={y} x1="12" x2="388" y1={y} y2={y} className="chart-grid" />)}
      {path && <path d={path} fill="none" stroke={`url(#${gradient})`} strokeWidth="2.5" />}
      {values.map((value, index) => value === null ? null : <circle key={calls[index].id} cx={12 + 376 * (calls.length === 1 ? 1 : index / Math.max(1, calls.length - 1))} cy={86 - value / max * 68} r="3" fill="var(--accent)" />)}
      <text x="12" y="105">较早</text><text x="361" y="105">最新</text><text x="12" y="12">{max.toFixed(1)}</text>
    </svg>
    {values.every((value) => value === null) && <p>等待 llama.cpp 返回推理计时</p>}
    <span className="inference-trend-accessible">{calls.map((call, index) => `第 ${index + 1} 次：${values[index] === null ? "未知" : `${rate(values[index])} tok/s`}，${statusLabels[call.status]}`).join("；") || "尚无调用"}</span>
  </figure>;
}

function Architecture({ architecture, phase, motion, selected, onSelect }: {
  architecture: ModelArchitecture; phase: InferenceRecord["phase"]; motion: boolean; selected: ModuleId; onSelect: (id: ModuleId) => void;
}) {
  const count = architecture.block_count;
  const layers = count != null && count > 0 ? count <= 4 ? Array.from({ length: count }, (_, index) => index + 1) : [1, 2, count - 1, count] : [];
  const selectedModule = modules.find((module) => module.id === selected)!;
  const dense = architecture.available && /^hunyuan.*dense$/.test(architecture.architecture ?? "");
  return <section className="inference-architecture" data-motion={motion ? "running" : "stopped"} data-phase={phase} aria-label="模型架构计算路径示意">
    <div className="inference-architecture-heading"><div><span className="inference-kicker">MODEL ANATOMY</span><h3>计算路径 · 架构剖面</h3></div><span className="inference-source">{architecture.source === "gguf" ? "GGUF 元数据" : "元数据不可用"}</span></div>
    {architecture.available ? <>
      <div className="inference-architecture-meta"><strong>{architecture.name || architecture.architecture || "模型架构"}</strong><span>{architecture.architecture || "架构类型未知"}{dense ? " · Dense Transformer" : ""}</span></div>
      <div className="inference-anatomy">
        <div className="inference-orbit" aria-hidden="true" />
        <button type="button" className="inference-module inference-endpoint" aria-pressed={selected === "embedding"} onClick={() => onSelect("embedding")}>
          <span className="inference-token-grid" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</span><small>EMBEDDING</small><strong>Token 嵌入</strong><span>{number(architecture.embedding_length)} 维</span>
        </button>
        <span className="inference-flow" aria-hidden="true"><i className="inference-flow-packet" /></span>
        <div className="inference-transformer">
          <div className="inference-layer-stack" aria-hidden="true">{layers.map((layer, index) => <div className="inference-layer" key={layer} style={{ "--layer-index": index } as CSSProperties}><span>BLOCK {layer.toString().padStart(2, "0")}</span><i /><i /></div>)}</div>
          <div className="inference-block-title"><strong>Transformer blocks</strong><span>× {number(count)}</span></div>
          {count != null && count > 4 && <small className="inference-layer-note">展示首尾 4 层，中间 {number(count - 4)} 层省略</small>}
          {!layers.length && <small className="inference-layer-note">GGUF 未提供层数</small>}
          <div className="inference-block-modules">{modules.slice(1, 3).map((module) => <button type="button" className={`inference-module inference-${module.id}`} key={module.id} aria-pressed={selected === module.id} onClick={() => onSelect(module.id)}><small>{module.eyebrow}</small><strong>{module.name}</strong><span>{module.id === "attention" ? `${number(architecture.attention_heads)} Q / ${number(architecture.kv_heads)} KV heads` : `${number(architecture.feed_forward_length)} 中间维度`}</span></button>)}</div>
          <span className="inference-residual">归一化 · 残差连接 · 按层重复</span>
        </div>
        <span className="inference-flow inference-flow-out" aria-hidden="true"><i className="inference-flow-packet" /></span>
        <button type="button" className="inference-module inference-endpoint inference-output" aria-pressed={selected === "output"} onClick={() => onSelect("output")}>
          <span className="inference-output-ring" aria-hidden="true"><i /></span><small>OUTPUT</small><strong>输出投影</strong><span>词表分数 → 采样</span>
        </button>
      </div>
      <div className="inference-module-detail" aria-live="polite"><span>{selectedModule.eyebrow}</span><div><strong>{selectedModule.name}</strong><p>{selected === "ffn" && dense ? "密集前馈网络执行 dense 矩阵计算。" : ""}{selectedModule.description}</p></div></div>
      <dl className="inference-architecture-specs"><div title="按本地 GGUF 文件张量形状统计；共享权重只统计一次"><dt>存储参数</dt><dd>{parameters(architecture.parameter_count)}</dd></div><div><dt>张量数量</dt><dd>{number(architecture.tensor_count)}</dd></div><div title="GGUF 元数据记录的训练上下文容量，不是当前运行配置 num_ctx"><dt>训练上下文</dt><dd>{number(architecture.context_length)}</dd></div><div><dt>量化</dt><dd>{architecture.quantization || "—"}</dd></div></dl>
    </> : <div className="inference-architecture-empty"><span aria-hidden="true">◇</span><p>{architecture.message || "选中模型的 GGUF 元数据暂不可用。读取后会展示实际层数与维度。"}</p></div>}
    <p className="inference-visual-note">选中模型：{architecture.model || "未知"}。{dense ? "密集 Decoder 的每个生成 token 都经过全部 Transformer 层；计算会使用嵌入、注意力、前馈与输出路径。" : ""}这是计算路径示意；流光由调用阶段驱动，不代表逐层、逐参数活动，也不是注意力热力图。</p>
  </section>;
}

export function InferenceDashboard({ inference, connected = true, visible = true, reduceMotion = false }: {
  inference?: InferenceSnapshot; connected?: boolean; visible?: boolean; reduceMotion?: boolean;
}) {
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<ModuleId>("attention");
  const systemReduceMotion = useSystemReduceMotion();
  if (!inference) return <section className="inference-legacy"><h2>模型推理</h2><p>当前网关尚未提供推理指标。连接支持此功能的网关后，会显示真实 token 与计时数据。</p></section>;
  const active = inference.active?.status === "running" ? inference.active : null;
  const record = active || inference.latest;
  const phase = connected && active ? active.phase : "idle";
  const architectureMatches = active?.model === inference.architecture.model;
  const motion = connected && visible && inference.architecture.available && architectureMatches && phase !== "idle" && !paused && !reduceMotion && !systemReduceMotion;
  const tokenNote = record?.token_source === "llama.cpp" ? record.tokens_complete ? "llama.cpp 真实计数" : "llama.cpp 已知部分计数" : "未返回 usage，保留未知";
  const speedNote = record?.speed_source === "llama.cpp" ? "llama.cpp 推理计时" : record?.speed_source === "wall_clock" ? "墙钟时间计算" : "等待推理计时";
  const { summary } = inference;
  return <section className="inference-dashboard" aria-label="模型推理性能" data-connected={connected}>
    <header className="inference-heading"><div><span className="inference-kicker">INFERENCE OBSERVATORY</span><h2>模型推理</h2><p>{record ? `${!connected ? "上次观测" : active ? "当前调用" : "最近调用"} · ${record.model} · ${!connected ? "状态待重新确认" : statusLabels[record.status]}${record.segment_index != null ? ` · 分段 ${record.segment_index}` : ""} · 尝试 ${record.attempt}` : "等待首次模型调用"}</p></div><span className={`inference-phase-pill phase-${phase}`}><i aria-hidden="true" />{!connected ? "连接中断" : active ? phaseLabels[phase] : "待命"}</span></header>
    <div className="inference-metrics">
      <Metric name="生成速度" value={rate(record?.tokens_per_second)} unit="tok/s" note={speedNote} prominent />
      <Metric name="输入处理速度" value={rate(record?.prompt_tokens_per_second)} unit="tok/s" note={record?.prompt_ms != null ? `输入用时 ${duration(record.prompt_ms)} · llama.cpp` : "等待 llama.cpp prompt 计时"} />
      <Metric name="输入 tokens" value={number(record?.prompt_tokens)} note={tokenNote} />
      <Metric name="输出 tokens" value={number(record?.generated_tokens)} note={tokenNote} />
      <Metric name="总 tokens" value={number(record?.total_tokens)} note="输入 + 输出 · 非字符数" />
      <Metric name="首段输出延迟" value={duration(record?.first_token_ms)} note="网关观测，含调度与传输" />
      <Metric name="调用耗时" value={record ? duration(record.elapsed_ms) : "—"} note={!connected ? "上次观测 · 墙钟时间" : active ? "进行中 · 墙钟时间" : "整个调用 · 墙钟时间"} />
      <Metric name="生成耗时" value={duration(record?.decode_ms)} note="llama.cpp decode 计时" />
    </div>
    <div className="inference-stage-bar"><ol aria-label="推理阶段">{(["prefill", "decode", "idle"] as const).map((stage, index) => <li key={stage} aria-current={phase === stage ? "step" : undefined}><span>0{index + 1}</span>{stage === "idle" ? "结束 / 待命" : phaseLabels[stage]}</li>)}</ol><button type="button" className="inference-motion-button" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? "继续动画" : "暂停动画"}</button></div>
    <p className="inference-stage-note">阶段按请求与首段流式输出推断。等待阶段包含调度、输入处理与通信，并非实测 prefill 进度。{reduceMotion || systemReduceMotion ? " 减少动态效果已开启。" : ""}{active && !architectureMatches ? ` 当前调用与选中架构不同：推理 ${active.model}，选中 ${inference.architecture.model || "未知"}，架构动画已停止。` : ""}</p>
    <Architecture architecture={inference.architecture} phase={architectureMatches ? phase : "idle"} motion={motion} selected={selected} onSelect={setSelected} />
    <div className="inference-session"><section className="inference-session-summary"><span className="inference-kicker">GATEWAY SESSION</span><h3>本次网关会话</h3><div className="inference-session-total"><strong>{number(summary.total_tokens)}</strong><span>tokens{summary.unknown_token_calls > 0 ? " · 已知下限" : " · 已统计总量"}</span></div><p>输入 {number(summary.prompt_tokens)} · 输出 {number(summary.generated_tokens)}{summary.unknown_token_calls > 0 ? ` · ${number(summary.unknown_token_calls)} 次调用统计不完整` : " · llama.cpp 真实计数"}</p><dl><div><dt>模型调用</dt><dd>{number(summary.calls)}</dd></div><div><dt>完成</dt><dd>{number(summary.completed_calls)}</dd></div><div><dt>取消</dt><dd>{number(summary.cancelled_calls)}</dd></div><div><dt>失败</dt><dd>{number(summary.failed_calls)}</dd></div></dl><small>Token 累计为已结束调用用量 · 调用次数含进行中 · 分段与重试分别计数 · 网关重启后清零</small></section><CallTrend history={inference.history} /></div>
  </section>;
}
