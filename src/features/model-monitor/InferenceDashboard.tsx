import { useId } from "react";
import type { InferenceRecord, InferenceSnapshot } from "../../types";
import "./inference.css";

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
    <figcaption><strong>调用速度轨迹</strong><span>最近 {calls.length} 次，tok/s，每点为一次真实调用</span></figcaption>
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

export function InferenceDashboard({ inference, connected = true }: {
  inference?: InferenceSnapshot; connected?: boolean;
}) {
  if (!inference) return <section className="inference-legacy"><h2>模型推理</h2><p>当前网关尚未提供推理指标。连接支持此功能的网关后，会显示 llama.cpp token 用量与计时数据。</p></section>;
  const active = inference.active?.status === "running" ? inference.active : null;
  const record = active || inference.latest;
  const phase = connected && active ? active.phase : "idle";
  const tokenNote = record?.token_source === "llama.cpp" ? record.tokens_complete ? "llama.cpp token 用量" : "llama.cpp 已知部分计数" : "未返回 usage，保留未知";
  const speedNote = record?.speed_source === "llama.cpp" ? "llama.cpp 推理计时" : record?.speed_source === "wall_clock" ? "墙钟时间计算" : "等待推理计时";
  const { summary } = inference;
  return <section className="inference-dashboard" aria-label="模型推理性能" data-connected={connected}>
    <header className="inference-heading"><div><span className="inference-kicker">INFERENCE OBSERVATORY</span><h2>模型推理</h2><p>{record ? `${!connected ? "上次观测" : active ? "当前调用" : "最近调用"}，${record.model}，${!connected ? "状态待重新确认" : statusLabels[record.status]}${record.segment_index != null ? `，分段 ${record.segment_index}` : ""}，尝试 ${record.attempt}` : "等待首次模型调用"}</p></div><span className={`inference-phase-pill phase-${phase}`}><i aria-hidden="true" />{!connected ? "连接中断" : active ? phaseLabels[phase] : "待命"}</span></header>
    <div className="inference-metrics">
      <Metric name="生成速度" value={rate(record?.tokens_per_second)} unit="tok/s" note={speedNote} prominent />
      <Metric name="输入处理速度" value={rate(record?.prompt_tokens_per_second)} unit="tok/s" note={record?.prompt_ms != null ? `输入用时 ${duration(record.prompt_ms)}，llama.cpp` : "等待 llama.cpp prompt 计时"} />
      <Metric name="输入 tokens" value={number(record?.prompt_tokens)} note={tokenNote} />
      <Metric name="输出 tokens" value={number(record?.generated_tokens)} note={tokenNote} />
      <Metric name="总 tokens" value={number(record?.total_tokens)} note="输入 + 输出，非字符数" />
      <Metric name="首段输出延迟" value={duration(record?.first_token_ms)} note="网关观测，含调度与传输" />
      <Metric name="调用耗时" value={record ? duration(record.elapsed_ms) : "—"} note={!connected ? "上次观测，墙钟时间" : active ? "进行中，墙钟时间" : "整个调用，墙钟时间"} />
      <Metric name="生成耗时" value={duration(record?.decode_ms)} note="llama.cpp decode 计时" />
    </div>
    <p className="inference-stage-note">阶段按请求与首段流式输出推断。等待阶段包含调度、输入处理与通信，并非实测 prefill 进度。</p>
    <div className="inference-session"><section className="inference-session-summary"><span className="inference-kicker">GATEWAY SESSION</span><h3>本次网关会话</h3><div className="inference-session-total"><strong>{number(summary.total_tokens)}</strong><span>tokens{summary.unknown_token_calls > 0 ? "，已知下限" : "，已统计总量"}</span></div><p>输入 {number(summary.prompt_tokens)}，输出 {number(summary.generated_tokens)}{summary.unknown_token_calls > 0 ? `，${number(summary.unknown_token_calls)} 次调用统计不完整` : "，llama.cpp token 用量"}</p><dl><div><dt>模型调用</dt><dd>{number(summary.calls)}</dd></div><div><dt>完成</dt><dd>{number(summary.completed_calls)}</dd></div><div><dt>取消</dt><dd>{number(summary.cancelled_calls)}</dd></div><div><dt>失败</dt><dd>{number(summary.failed_calls)}</dd></div></dl><small>Token 累计为已结束调用用量，调用次数含进行中，分段与重试分别计数，网关重启后清零</small></section><CallTrend history={inference.history} /></div>
  </section>;
}
