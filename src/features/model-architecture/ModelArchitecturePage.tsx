import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { getTelemetry } from "../../lib/api";
import {
  actualLayerCount, architectureSource, formatNumber, formatParameters, gqaGroup, isDense, layerCount, modelSource, teachingSteps,
  type ArchitectureView, type DetailedArchitecture,
} from "./architectureModel";
import "./architecture.css";

function useMotionPreference(reduceMotion: boolean) {
  const [systemReduced, setSystemReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const motion = () => setSystemReduced(media?.matches ?? false);
    const visibility = () => setVisible(!document.hidden);
    media?.addEventListener("change", motion);
    document.addEventListener("visibilitychange", visibility);
    return () => { media?.removeEventListener("change", motion); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  return { reduced: reduceMotion || systemReduced, visible };
}

function Matrix({ name, rows = 4, cols = 7, active = false }: { name: string; rows?: number; cols?: number; active?: boolean }) {
  return <div className="ma-matrix" data-active={active} style={{ "--matrix-columns": cols } as CSSProperties} aria-hidden="true">{Array.from({ length: rows * cols }, (_, index) => <i key={index} style={{ "--cell-delay": `${(index % cols) * 70}ms` } as CSSProperties} />)}<small>{name}</small></div>;
}
function Flow({ active = false }: { active?: boolean }) {
  return <span className="ma-flow" data-active={active} aria-hidden="true"><i /><b>→</b></span>;
}
function Specs({ children }: { children: ReactNode }) {
  return <dl className="ma-specs">{children}</dl>;
}
function Spec({ name, value, title }: { name: string; value: string; title?: string }) {
  return <div title={title}><dt>{name}</dt><dd>{value}</dd></div>;
}
function TensorTable({ architecture, layer }: { architecture: DetailedArchitecture; layer: number }) {
  const tensors = architecture.block_tensors?.filter((tensor) => tensor.layer === layer) ?? [];
  return <section className="ma-tensors"><header><h3>第 {layer} 层 · 存储张量</h3><span>GGUF 描述 · 只展示形状</span></header>
    {tensors.length ? <table><thead><tr><th scope="col">张量</th><th scope="col">存储维度</th><th scope="col">元素数量</th></tr></thead><tbody>{tensors.map((tensor) => <tr key={tensor.name}><th scope="row">{tensor.name}</th><td>{tensor.shape.map(formatNumber).join(" × ") || "—"}</td><td>{formatNumber(tensor.elements)}</td></tr>)}</tbody></table> : <p>{architecture.block_tensors_truncated ? "描述列表达到读取上限，该层形状可能未包含在当前响应中。" : "当前元数据未提供该层的张量形状。"}</p>}
    {architecture.block_tensors_truncated && <p>张量描述列表已截断；当前展示不是全部存储张量。</p>}
    <small>维度遵循 GGUF 原生存储顺序；不是标准矩阵行列展示，也不是实时权重值。</small>
  </section>;
}

function Overview({ architecture, step, navigate }: { architecture: DetailedArchitecture; step: number; navigate: (view: ArchitectureView) => void }) {
  const count = layerCount(architecture);
  const actual = actualLayerCount(architecture);
  return <div className="ma-overview-diagram" data-step={step}>
    <button type="button" className="ma-module ma-embedding-node" data-active={step === 0} onClick={() => navigate({ level: "embedding", layer: 1 })}><Matrix name="LOOKUP" active={step === 0} /><small>01 · EMBEDDING</small><strong>Token 嵌入</strong><span>{formatNumber(architecture.embedding_length)} 维</span><em>点击放大 ↗</em></button>
    <Flow active={step === 0 || step === 3} />
    <section className="ma-layer-bank" data-active={step === 1}><header><div><small>02 · TRANSFORMER</small><strong>{actual ? `${formatNumber(actual)} 个真实层` : "层数未知"}</strong></div><span>{isDense(architecture) ? "Dense Decoder" : "通用结构示意"}</span></header>
      <div className="ma-layer-grid">{Array.from({ length: count }, (_, index) => <button type="button" key={index} className="ma-layer-tile" aria-label={`进入第 ${index + 1} 层`} onClick={() => navigate({ level: "layer", layer: index + 1 })} style={{ "--layer-delay": `${index * 45}ms` } as CSSProperties}><strong>L{String(index + 1).padStart(2, "0")}</strong><span>ATTN</span><span>FFN</span></button>)}</div>
      <p>{actual > count ? `仅绘制前 ${count} 层；进入后可输入任意真实层编号。` : count ? "点击任意一层，展开内部结构与计算步骤" : "GGUF 未提供有效层数，无法定位具体层"}</p>
    </section>
    <Flow active={step === 2 || step === 3} />
    <button type="button" className="ma-module ma-output-node" data-active={step >= 2} onClick={() => navigate({ level: "output", layer: Math.max(1, count) })}><span className="ma-output-symbol" aria-hidden="true"><i /><i /><i /><i /></span><small>03 · OUTPUT</small><strong>输出 head</strong><span>词表 logits → 采样</span><em>点击放大 ↗</em></button>
    <div className="ma-generation-loop" data-active={step === 3} aria-hidden="true"><span>下一 token · 复用 KV cache</span><i /></div>
  </div>;
}

function LayerDiagram({ architecture, layer, step, navigate }: { architecture: DetailedArchitecture; layer: number; step: number; navigate: (view: ArchitectureView) => void }) {
  return <div className="ma-layer-diagram" data-step={step}>
    <div className="ma-layer-inout"><span>第 {layer} 层输入</span><strong>h ∈ ℝ<sup>{formatNumber(architecture.embedding_length)}</sup></strong></div>
    <div className="ma-layer-path"><span className="ma-normalization" data-active={step === 0}>{isDense(architecture) ? "RMSNorm" : "归一化"}</span><Flow active={step <= 1} /><button type="button" className="ma-module ma-layer-attention" data-active={step === 1} onClick={() => navigate({ level: "attention", layer })}><Matrix name="Q · K · V" active={step === 1} rows={3} cols={8} /><small>SELF ATTENTION</small><strong>注意力</strong><span>{formatNumber(architecture.attention_heads)} Q / {formatNumber(architecture.kv_heads)} KV heads</span><em>进入头分组与 KV cache ↗</em></button><Flow active={step === 2} /><span className="ma-residual-sum" data-active={step === 2}>＋<small>残差相加</small></span></div>
    <div className="ma-residual-route"><span>保留输入 · 残差支路</span><i /></div>
    <div className="ma-layer-path"><span className="ma-normalization" data-active={step >= 2}>{isDense(architecture) ? "RMSNorm" : "归一化"}</span><Flow active={step === 3} /><button type="button" className="ma-module ma-layer-ffn" data-active={step === 3} onClick={() => navigate({ level: "ffn", layer })}><Matrix name={isDense(architecture) ? "GATE × UP" : "FFN"} active={step === 3} rows={3} cols={8} /><small>FEED FORWARD</small><strong>前馈网络</strong><span>{formatNumber(architecture.embedding_length)} → {formatNumber(architecture.feed_forward_length)} → {formatNumber(architecture.embedding_length)}</span><em>进入矩阵与激活路径 ↗</em></button><Flow active={step === 4} /><span className="ma-residual-sum" data-active={step === 4}>＋<small>残差相加</small></span></div>
    <div className="ma-residual-route"><span>保留前馈输入 · 残差支路</span><i /></div>
    <div className="ma-layer-inout ma-layer-exit"><span>{layer < actualLayerCount(architecture) ? `进入第 ${layer + 1} 层` : "进入最终归一化与输出"}</span><strong>隐藏维度保持 {formatNumber(architecture.embedding_length)}</strong></div>
  </div>;
}

function AttentionDiagram({ architecture, layer, step }: { architecture: DetailedArchitecture; layer: number; step: number }) {
  const [queryHead, setQueryHead] = useState(1);
  const queryCount = Math.min(128, Math.max(0, architecture.attention_heads ?? 0));
  const kvCount = Math.min(128, Math.max(0, architecture.kv_heads ?? 0));
  const grouping = gqaGroup(architecture, queryHead);
  return <div className="ma-attention-diagram" data-step={step}>
    <div className="ma-attention-input"><small>HIDDEN STATE</small><strong>{formatNumber(architecture.embedding_length)} 维隐藏表示</strong><span>三路参数投影</span></div>
    <div className="ma-qkv-branches">
      <section className="ma-qkv-card ma-query" data-active={step <= 1}><header><strong>Q · Query</strong><span>{formatNumber(architecture.attention_heads)} heads</span></header><div className="ma-head-grid">{Array.from({ length: queryCount }, (_, index) => <button type="button" key={index} aria-label={`Query head ${index + 1}`} aria-pressed={queryHead === index + 1} onClick={() => setQueryHead(index + 1)} data-group={grouping && Math.floor(index / grouping.queriesPerGroup) + 1 === grouping.group}>{index + 1}</button>)}</div></section>
      <section className="ma-qkv-card ma-key" data-active={step === 1 || step === 2}><header><strong>K · Key</strong><span>{formatNumber(architecture.kv_heads)} heads</span></header><div className="ma-kv-heads">{Array.from({ length: kvCount }, (_, index) => <span key={index} data-selected={grouping?.group === index + 1}>K{index + 1}</span>)}</div></section>
      <section className="ma-qkv-card ma-value" data-active={step === 2}><header><strong>V · Value</strong><span>{formatNumber(architecture.kv_heads)} heads</span></header><div className="ma-kv-heads">{Array.from({ length: kvCount }, (_, index) => <span key={index} data-selected={grouping?.group === index + 1}>V{index + 1}</span>)}</div></section>
    </div>
    {(architecture.attention_heads ?? 0) > 128 || (architecture.kv_heads ?? 0) > 128 ? <label className="ma-head-selector">图中最多绘制前 128 个 heads；输入编号可查看其余 Query head 的分组。<input type="number" min="1" max={architecture.attention_heads ?? 1} value={queryHead} aria-label="选择 Query head 编号" onChange={(event) => { const value = Number(event.target.value); if (Number.isSafeInteger(value) && value >= 1 && value <= (architecture.attention_heads ?? 0)) setQueryHead(value); }} /></label> : null}
    <div className="ma-attention-cache" data-active={step === 2}><div><small>PER-LAYER KV CACHE</small><strong>第 {layer} 层 · 上下文记忆</strong><span>新 K/V 追加 · 历史 K/V 复用</span></div><div className="ma-cache-slots" aria-hidden="true">{["t₀", "t₁", "t₂", "新 t"].map((label, index) => <span key={label} data-new={index === 3}><i /><i /><small>{label}</small></span>)}</div><p>时间槽位是示例，不代表当前缓存长度或占用</p></div>
    <div className="ma-attention-result" data-active={step >= 3}><span>因果掩码 · softmax · V 加权</span><strong>softmax(QKᵀ / √d + mask) V</strong><div><Flow active={step === 4} /><span>多头结果合并 → 输出投影</span><Flow active={step === 4} /></div></div>
    <p className="ma-head-explanation">{grouping ? `选择 Query head ${queryHead} → KV group ${grouping.group}；每组 ${grouping.queriesPerGroup} 个 Query heads 共享同组 Key/Value。` : "当前元数据无法确认均衡 GQA 分组；不推断 Query 与 KV 的对应关系。"}头维度：{formatNumber(architecture.head_dim)}。高亮表示所选结构关系，不代表该 head 正在推理。</p>
  </div>;
}

function FfnDiagram({ architecture, step }: { architecture: DetailedArchitecture; step: number }) {
  const dense = isDense(architecture);
  return <div className="ma-ffn-diagram" data-step={step}><div className="ma-vector-chip"><small>INPUT</small><strong>{formatNumber(architecture.embedding_length)}</strong><span>隐藏维度</span></div><Flow active={step === 0} />
    <div className="ma-ffn-fork">{(dense ? ["gate_proj", "up_proj"] : ["输入投影"]).map((name) => <div className="ma-ffn-matrix" key={name} data-active={step === 0}><Matrix name={name} active={step === 0} rows={5} cols={8} /><strong>{formatNumber(architecture.embedding_length)} → {formatNumber(architecture.feed_forward_length)}</strong></div>)}</div>
    <div className="ma-activation" data-active={step === 1}><svg viewBox="0 0 120 70" aria-hidden="true"><path className="ma-axis" d="M12 56H110M30 62V8" /><path className="ma-activation-curve" d="M12 49C30 48 38 54 49 39S63 39 72 26S88 22 105 10" /></svg><strong>{dense ? "激活 × 门控" : "非线性处理"}</strong><span>具体激活类型未读取</span></div>
    <Flow active={step === 2} /><div className="ma-ffn-return" data-active={step === 2}><Matrix name={dense ? "down_proj" : "输出投影"} active={step === 2} rows={5} cols={8} /><strong>{formatNumber(architecture.feed_forward_length)} → {formatNumber(architecture.embedding_length)}</strong></div>
    <div className="ma-ffn-residual" data-active={step === 3}><span>原始前馈输入</span><i /><strong>＋ 残差 → 后续层</strong></div>
    <p className="ma-demo-caption">单元格与曲线仅为过程示意，未读取权重、激活值或具体激活函数；维度来自本地 GGUF。</p>
  </div>;
}

function EmbeddingDiagram({ architecture, step }: { architecture: DetailedArchitecture; step: number }) {
  const [token, setToken] = useState(1);
  return <div className="ma-embedding-diagram" data-step={step}><div className="ma-example-tokens"><small>TOKEN ID · 示例</small>{["α", "β", "γ"].map((label, index) => <button type="button" key={label} aria-pressed={token === index} onClick={() => setToken(index)} aria-label={`查看示例 token ${label}`}><strong>{label}</strong><span>ID{label}</span></button>)}</div><Flow active={step === 1} />
    <div className="ma-embedding-table" data-active={step === 1}><header><strong>Embedding lookup</strong><span>{formatNumber(architecture.vocab_size)} 词表 × {formatNumber(architecture.embedding_length)} 隐藏维度</span></header>{["…", "IDα", "IDβ", "IDγ", "…"].map((label, index) => <div className="ma-embedding-row" key={index} data-selected={index === token + 1}><span>{label}</span><Matrix name="" rows={1} cols={10} active={index === token + 1 && step >= 1} /></div>)}</div><Flow active={step === 2} />
    <div className="ma-vector-chip ma-embedding-vector" data-active={step === 2}><Matrix name="TOKEN VECTOR" rows={7} cols={1} active={step === 2} /><strong>{formatNumber(architecture.embedding_length)} 维</strong><span>进入第 1 层</span></div><p className="ma-demo-caption">ID 与行纹理是教学占位，不是当前文本的分词结果或模型权重。</p>
  </div>;
}

function OutputDiagram({ architecture, step }: { architecture: DetailedArchitecture; step: number }) {
  return <div className="ma-output-diagram" data-step={step}><div className="ma-vector-chip" data-active={step === 0}><small>FINAL NORM</small><strong>{formatNumber(architecture.embedding_length)}</strong><span>最终隐藏表示</span></div><Flow active={step === 1} /><div className="ma-output-head" data-active={step === 1}><Matrix name="LM HEAD" active={step === 1} rows={6} cols={8} /><strong>输出投影</strong><span>{formatNumber(architecture.embedding_length)} → {formatNumber(architecture.vocab_size)}</span></div><Flow active={step === 2} /><div className="ma-logits" data-active={step >= 1}><header><strong>词表 logits · 示例</strong><span>示意分数，非真实概率</span></header>{[35, 58, 91, 46, 24].map((width, index) => <div key={index} data-selected={step >= 2 && index === 2}><span>候选 {String.fromCharCode(65 + index)}</span><i style={{ "--logit-width": `${width}%` } as CSSProperties} /></div>)}</div><div className="ma-sampled-token" data-active={step >= 2}><span>示例采样</span><strong>候选 C</strong><small>采样策略由运行配置决定</small></div><div className="ma-output-feedback" data-active={step === 3}><span>新 token → Embedding → 各层 · 复用 KV cache</span><i /></div></div>;
}

export function ArchitectureExplorer({ architecture, connected = true, reduceMotion = false }: { architecture: DetailedArchitecture; connected?: boolean; reduceMotion?: boolean }) {
  const [view, setView] = useState<ArchitectureView>({ level: "overview", layer: 1 });
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const { reduced, visible } = useMotionPreference(reduceMotion);
  const explorerRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigationPending = useRef(false);
  const regionId = useId();
  const steps = teachingSteps(view.level, isDense(architecture));
  const current = Math.min(step, steps.length - 1);
  const animating = playing && !reduced && visible && connected && architecture.available;
  const count = layerCount(architecture);
  const actual = actualLayerCount(architecture);
  function navigate(next: ArchitectureView, focus = true) { navigationPending.current = focus; setView(next); setStep(0); }
  useEffect(() => { setView({ level: "overview", layer: 1 }); setStep(0); }, [architecture.model, architecture.block_count]);
  useEffect(() => {
    if (!navigationPending.current) return;
    navigationPending.current = false;
    headingRef.current?.focus({ preventScroll: true });
    explorerRef.current?.scrollIntoView?.({ behavior: "auto", block: "start" });
  }, [view]);
  useEffect(() => {
    if (!animating) return;
    const timer = setInterval(() => setStep((previous) => (previous + 1) % steps.length), 2400);
    return () => clearInterval(timer);
  }, [animating, steps.length, view.level, view.layer]);
  const titles = { overview: "整体计算框架", layer: `第 ${view.layer} 层`, attention: "Attention · 头与缓存", ffn: "FFN · 前馈变换", embedding: "Embedding · 查表", output: "Output · 投影与采样" };
  const isLayer = view.level === "layer" || view.level === "attention" || view.level === "ffn";
  return <div className="ma-explorer" ref={explorerRef} data-motion={animating ? "playing" : "paused"} data-level={view.level}>
    <nav className="ma-breadcrumb" aria-label="架构层级"><button type="button" onClick={() => navigate({ level: "overview", layer: 1 })} aria-current={view.level === "overview" ? "page" : undefined}>模型框架</button>{isLayer && <><span aria-hidden="true">›</span><button type="button" onClick={() => navigate({ level: "layer", layer: view.layer })} aria-current={view.level === "layer" ? "page" : undefined}>第 {view.layer} 层</button></>}{view.level !== "overview" && view.level !== "layer" && <><span aria-hidden="true">›</span><span aria-current="page">{titles[view.level]}</span></>}</nav>
    <section className="ma-canvas" aria-label={titles[view.level]}><header className="ma-canvas-heading"><div><span className="ma-kicker">{view.level === "overview" ? "MODEL ATLAS" : "COMPUTATION CLOSE-UP"}</span><h2 ref={headingRef} tabIndex={-1}>{titles[view.level]}</h2></div>{isLayer && count > 0 ? <label className="ma-layer-select">跳转层{actual > count ? <input type="number" min="1" max={actual} value={view.layer} aria-label="选择 Transformer 层编号" onBlur={() => navigate(view)} onChange={(event) => { const value = Number(event.target.value); if (Number.isSafeInteger(value) && value >= 1 && value <= actual) navigate({ level: view.level, layer: value }, false); }} /> : <select value={view.layer} onChange={(event) => navigate({ level: view.level, layer: Number(event.target.value) })}>{Array.from({ length: count }, (_, index) => <option key={index} value={index + 1}>第 {index + 1} / {count} 层</option>)}</select>}</label> : <span className="ma-teaching-badge">教学演示 · 可逐步查看</span>}</header>
      <div id={regionId} className="ma-diagram-stage" key={`${view.level}-${view.layer}`}>
        {view.level === "overview" && <Overview architecture={architecture} step={current} navigate={navigate} />}
        {view.level === "layer" && <LayerDiagram architecture={architecture} layer={view.layer} step={current} navigate={navigate} />}
        {view.level === "attention" && <AttentionDiagram architecture={architecture} layer={view.layer} step={current} />}
        {view.level === "ffn" && <FfnDiagram architecture={architecture} step={current} />}
        {view.level === "embedding" && <EmbeddingDiagram architecture={architecture} step={current} />}
        {view.level === "output" && <OutputDiagram architecture={architecture} step={current} />}
      </div>
      <div className="ma-playback"><div className="ma-playback-buttons"><button type="button" aria-pressed={playing} aria-controls={regionId} onClick={() => setPlaying((previous) => !previous)} disabled={reduced || !connected}>{playing && !reduced && connected ? "暂停动画" : "播放动画"}</button><button type="button" aria-label="上一步" onClick={() => { setPlaying(false); setStep((previous) => Math.max(0, previous - 1)); }} disabled={current === 0}>←</button><button type="button" aria-label="下一步" onClick={() => { setPlaying(false); setStep((previous) => (previous + 1) % steps.length); }}>→</button><span>{current + 1} / {steps.length}</span></div><span className="ma-animation-label">{reduced ? "减少动态效果 · 手动查看步骤" : !connected ? "连接中断 · 教学动画暂停" : !visible ? "页面隐藏 · 动画暂停" : "独立教学时间线 · 非实时参数活动"}</span></div>
      <ol className="ma-step-track" aria-label="计算步骤">{steps.map((item, index) => <li key={item.name}><button type="button" aria-current={current === index ? "step" : undefined} onClick={() => { setPlaying(false); setStep(index); }}><span>{String(index + 1).padStart(2, "0")}</span>{item.name}</button></li>)}</ol>
      <div className="ma-step-explanation" aria-live={animating ? "off" : "polite"}><strong>{steps[current].name}</strong><p>{steps[current].description}</p></div>
    </section>
    {isLayer && <TensorTable architecture={architecture} layer={view.layer} />}
    <p className="ma-accuracy-note">维度与层数来自所选本地 GGUF。动画、矩阵纹理、候选条形与 token 占位是计算原理示意；没有读取权重值、激活值、实时逐层时序或注意力热力图。{!isDense(architecture) && " 当前架构身份尚未确认为 Hunyuan Dense，专属计算细节保留为通用示意。"}</p>
  </div>;
}

export function ModelArchitecturePage({ interval = 2, reduceMotion = false }: { interval?: number; reduceMotion?: boolean }) {
  const [architecture, setArchitecture] = useState<DetailedArchitecture | null>(null);
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: AbortController | null = null;
    async function poll() {
      if (stopped || document.hidden || active) return;
      const controller = new AbortController(); active = controller;
      const timeout = setTimeout(() => controller.abort(), 4500);
      try {
        const telemetry = await getTelemetry(controller.signal);
        if (stopped || document.hidden || controller.signal.aborted) return;
        setArchitecture(telemetry.inference?.architecture ?? null);
        setLoaded(true); setConnected(true); setError("");
      } catch {
        if (!stopped && !document.hidden && controller.signal.reason !== "hidden") { setConnected(false); setError("架构连接中断，保留上次元数据，正在重连…"); }
      } finally {
        clearTimeout(timeout); active = null;
        if (!stopped && !document.hidden) timer = setTimeout(() => void poll(), Math.max(.5, interval) * 1000);
      }
    }
    function visibility() { clearTimeout(timer); if (document.hidden) active?.abort("hidden"); else void poll(); }
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => { stopped = true; clearTimeout(timer); active?.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [interval]);
  return <div className="model-architecture-page"><header className="ma-page-heading"><div><span className="ma-kicker">EXPLORE THE MODEL</span><h1>模型架构</h1><p>从整体框架深入每一层，逐步理解 token 如何成为输出。</p></div><span className="ma-metadata-badge">{architecture?.available ? "本地 GGUF · 结构实读" : "本地模型 · 结构读取"}</span></header>
    {error && <p className="ma-notice" role="status">{error}</p>}
    {architecture?.available ? <><section className="ma-model-identity"><div><strong>{architecture.name || architecture.model}</strong><span>{architecture.model} · {architecture.architecture || "架构类型未知"}</span></div><Specs><Spec name="层数" value={formatNumber(architecture.block_count)} /><Spec name="隐藏维度" value={formatNumber(architecture.embedding_length)} /><Spec name="Q / KV heads" value={`${formatNumber(architecture.attention_heads)} / ${formatNumber(architecture.kv_heads)}`} /><Spec name="存储参数" value={formatParameters(architecture.parameter_count)} title="GGUF 存储张量元素总数，不等于活跃参数" /><Spec name="训练上下文" value={formatNumber(architecture.context_length)} title="GGUF 训练上下文容量，不是当前运行 num_ctx" /><Spec name="量化" value={architecture.quantization || "—"} /></Specs></section><ArchitectureExplorer architecture={architecture} connected={connected} reduceMotion={reduceMotion} /></> : <section className="ma-unavailable"><span aria-hidden="true">◇</span><h2>{loaded ? "暂未读取模型结构" : "正在读取模型结构…"}</h2><p>{architecture?.message || (loaded ? "选中模型的本地 GGUF 元数据暂不可用，或当前网关尚未提供架构信息。不会猜测层数或矩阵维度。" : "无需开始翻译，读取本地模型描述即可查看架构。")}</p></section>}
    <footer className="ma-sources"><span>计算路径参考</span><a href={architectureSource} target="_blank" rel="noreferrer">Hunyuan Dense 官方实现 ↗</a><a href={/7b/i.test(architecture?.model ?? "") ? modelSource.replace("1.8B", "7B") : modelSource} target="_blank" rel="noreferrer">Tencent {/7b/i.test(architecture?.model ?? "") ? "7B" : "1.8B"} 参考配置 ↗</a></footer>
  </div>;
}
