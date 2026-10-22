import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { getModelArchitecture } from "../../lib/api";
import { EmptyState, Notice } from "../../components/Controls";
import { architectureScrollContainer, architectureSignature, defaultArchitectureNavigation, defaultTensorNavigation, readArchitectureNavigation, writeArchitectureNavigation } from "../../lib/architectureNavigation";
import {
  actualLayerCount, architectureSource, formatNumber, formatParameters, gqaGroup, isDense, modelSource, teachingSteps,
  type ArchitectureView, type DetailedArchitecture,
} from "./architectureModel";
import { ArchitectureArrow, ArchitectureConnections, ResidualSum, overviewFlowEdges, layerFlowEdges, type FlowEdge } from "./ArchitectureFlow";
import { TensorWeightsPanel } from "./TensorWeightsPanel";
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
function Specs({ children }: { children: ReactNode }) {
  return <dl className="ma-specs">{children}</dl>;
}
function Spec({ name, value, title }: { name: string; value: string; title?: string }) {
  return <div title={title}><dt>{name}</dt><dd>{value}</dd></div>;
}
function LayerSelector({ count, layer, onChange }: { count: number; layer: number; onChange: (layer: number) => void }) {
  if (!count) return null;
  return <label className="ma-layer-select">查看层{count > 128 ? <input type="number" min="1" max={count} value={layer} aria-label="选择 Transformer 层编号" onChange={(event) => { const value = Number(event.target.value); if (Number.isSafeInteger(value) && value >= 1 && value <= count) onChange(value); }} /> : <select value={layer} aria-label="选择 Transformer 层编号" onChange={(event) => onChange(Number(event.target.value))}>{Array.from({ length: count }, (_, index) => <option key={index} value={index + 1}>第 {index + 1} / {count} 层</option>)}</select>}</label>;
}

function Overview({ architecture, layer, step, navigate }: { architecture: DetailedArchitecture; layer: number; step: number; navigate: (view: ArchitectureView) => void }) {
  const actual = actualLayerCount(architecture);
  const container = useRef<HTMLDivElement>(null);
  return <div ref={container} data-flow-scope className="ma-overview-diagram ma-stacked-overview" data-step={step}>
    <ArchitectureConnections containerRef={container} edges={overviewFlowEdges(actual, step)} />
    <button type="button" className="ma-module ma-embedding-node" data-flow-node="embedding" data-active={step === 0} onClick={() => navigate({ level: "embedding", layer })}><Matrix name="LOOKUP" active={step === 0} /><small>01 · EMBEDDING</small><strong>Token 嵌入</strong><span>{formatNumber(architecture.embedding_length)} 维</span><em>点击放大 <ArchitectureArrow direction="external" size={11} /></em></button>
    {actual > 0 ? <section className="ma-layer-stack" aria-label={`Transformer 层结构，共 ${actual} 层`} data-flow-node="stack" data-active={step === 1}>
      {Array.from({ length: Math.min(2, actual - 1) }, (_, index) => <div className="ma-stack-back" key={index} aria-hidden="true" style={{ "--stack-depth": index + 1 } as CSSProperties} />)}
      <div className="ma-stack-front"><header className="ma-stack-heading"><div><span className="ma-kicker">02 · TRANSFORMER</span><h3>第 {layer} 层的完整结构</h3><p>{isDense(architecture) ? "Dense Decoder" : "通用结构示意"} · {actual > 1 ? "结构相似，各层参数独立" : "单层结构，参数独立"}</p></div><span className="ma-stack-count">×{formatNumber(actual)} 层</span></header>
        <LayerDiagram key={layer} architecture={architecture} layer={layer} step={-1} active={step === 1} navigate={navigate} />
        <div className="ma-stack-footer"><span>只展开当前一层 · 模型按层号依次计算</span><button type="button" className="secondary-button" aria-label={`进入第 ${layer} 层`} onClick={() => navigate({ level: "layer", layer })}>查看第 {layer} 层步骤与参数 <ArchitectureArrow direction="external" size={12} /></button></div>
      </div>
    </section> : <EmptyState className="ma-stack-unavailable" title="层数未知">GGUF 未提供有效层数，无法展示或定位具体 Transformer 层。</EmptyState>}
    <button type="button" className="ma-module ma-output-node" data-flow-node="output" data-active={step >= 2} onClick={() => navigate({ level: "output", layer })}><span className="ma-output-symbol" aria-hidden="true"><i /><i /><i /><i /></span><small>03 · OUTPUT</small><strong>输出 head</strong><span>词表 logits → 采样</span><em>点击放大 <ArchitectureArrow direction="external" size={11} /></em></button>
    <p className="ma-generation-loop">下一 token · 重新经过嵌入与各层，复用 KV cache</p>
  </div>;
}

function LayerDiagram({ architecture, layer, step, active = false, navigate }: { architecture: DetailedArchitecture; layer: number; step: number; active?: boolean; navigate: (view: ArchitectureView) => void }) {
  const container = useRef<HTMLDivElement>(null);
  return <div ref={container} data-flow-scope className="ma-layer-diagram ma-connected-layer" data-step={step} data-layer={layer}>
    <ArchitectureConnections containerRef={container} edges={layerFlowEdges(step).map((edge) => ({ ...edge, active: active || edge.active }))} />
    <div className="ma-layer-inout ma-layer-input" data-flow-node="input"><small>01 · INPUT</small><span>第 {layer} 层输入</span><strong>h ∈ ℝ<sup>{formatNumber(architecture.embedding_length)}</sup></strong></div>
    <span className="ma-normalization ma-norm-first" data-flow-node="norm-1" data-active={step === 0}><small>02</small>{isDense(architecture) ? "RMSNorm" : "归一化"}</span>
    <button type="button" className="ma-module ma-layer-attention" data-flow-node="attention" data-active={step === 1} onClick={() => navigate({ level: "attention", layer })}><Matrix name="Q · K · V" active={step === 1} rows={3} cols={8} /><small>03 · SELF ATTENTION</small><strong>注意力</strong><span>{formatNumber(architecture.attention_heads)} Q / {formatNumber(architecture.kv_heads)} KV heads</span><em>进入头分组与 KV cache <ArchitectureArrow direction="external" size={11} /></em></button>
    <span className="ma-residual-sum ma-sum-first" data-active={step === 2}><ResidualSum flowNode="sum-1" label="04 · 残差 1" /></span>
    <span className="ma-normalization ma-norm-second" data-flow-node="norm-2" data-active={step >= 2}><small>05</small>{isDense(architecture) ? "RMSNorm" : "归一化"}</span>
    <button type="button" className="ma-module ma-layer-ffn" data-flow-node="ffn" data-active={step === 3} onClick={() => navigate({ level: "ffn", layer })}><Matrix name={isDense(architecture) ? "GATE × UP" : "FFN"} active={step === 3} rows={3} cols={8} /><small>06 · FEED FORWARD</small><strong>前馈网络</strong><span>{formatNumber(architecture.embedding_length)} → {formatNumber(architecture.feed_forward_length)} → {formatNumber(architecture.embedding_length)}</span><em>进入矩阵与激活路径 <ArchitectureArrow direction="external" size={11} /></em></button>
    <span className="ma-residual-sum ma-sum-second" data-active={step === 4}><ResidualSum flowNode="sum-2" label="07 · 残差 2" /></span>
    <div className="ma-layer-inout ma-layer-exit" data-flow-node="output"><small>08 · OUTPUT</small><span>{layer < actualLayerCount(architecture) ? `进入第 ${layer + 1} 层` : "进入最终归一化与输出"}</span><strong>隐藏维度 {formatNumber(architecture.embedding_length)}</strong></div>
    <div className="ma-residual-legend"><span>虚线 R1：原始输入接回残差 1</span><span>虚线 R2：残差 1 输出接回残差 2</span></div>
  </div>;
}

function AttentionDiagram({ architecture, layer, step }: { architecture: DetailedArchitecture; layer: number; step: number }) {
  const container = useRef<HTMLDivElement>(null);
  const [queryHead, setQueryHead] = useState(1);
  const queryCount = Math.min(128, Math.max(0, architecture.attention_heads ?? 0));
  const kvCount = Math.min(128, Math.max(0, architecture.kv_heads ?? 0));
  const grouping = gqaGroup(architecture, queryHead);
  const edges: FlowEdge[] = [
    ...["query", "key", "value"].map((to) => ({ id: `input-to-${to}`, from: "attention-input", to, source: "bottom" as const, target: "top" as const, active: step <= 1 })),
    { id: "key-to-cache", from: "key", to: "cache", source: "bottom", target: "top", active: step === 2 },
    { id: "value-to-cache", from: "value", to: "cache", source: "bottom", target: "top", active: step === 2 },
    { id: "query-to-score", from: "query", to: "score", source: "left", target: "left", route: "left", offset: 11, active: step === 3 },
    { id: "cache-to-score", from: "cache", to: "score", source: "bottom", target: "top", active: step === 3 },
    { id: "score-to-projection", from: "score", to: "projection", source: "bottom", target: "top", active: step === 4 },
  ];
  return <div ref={container} data-flow-scope className="ma-attention-diagram ma-connected-attention" data-step={step}>
    <ArchitectureConnections containerRef={container} edges={edges} />
    <div className="ma-attention-input" data-flow-node="attention-input"><small>HIDDEN STATE</small><strong>{formatNumber(architecture.embedding_length)} 维隐藏表示</strong><span>三路参数投影</span></div>
    <div className="ma-qkv-branches">
      <section className="ma-qkv-card ma-query" data-flow-node="query" data-active={step <= 1}><header><strong>Q · Query</strong><span>{formatNumber(architecture.attention_heads)} heads</span></header><div className="ma-head-grid">{Array.from({ length: queryCount }, (_, index) => <button type="button" key={index} aria-label={`Query head ${index + 1}`} aria-pressed={queryHead === index + 1} onClick={() => setQueryHead(index + 1)} data-group={grouping && Math.floor(index / grouping.queriesPerGroup) + 1 === grouping.group}>{index + 1}</button>)}</div></section>
      <section className="ma-qkv-card ma-key" data-flow-node="key" data-active={step === 1 || step === 2}><header><strong>K · Key</strong><span>{formatNumber(architecture.kv_heads)} heads</span></header><div className="ma-kv-heads">{Array.from({ length: kvCount }, (_, index) => <span key={index} data-selected={grouping?.group === index + 1}>K{index + 1}</span>)}</div></section>
      <section className="ma-qkv-card ma-value" data-flow-node="value" data-active={step === 2}><header><strong>V · Value</strong><span>{formatNumber(architecture.kv_heads)} heads</span></header><div className="ma-kv-heads">{Array.from({ length: kvCount }, (_, index) => <span key={index} data-selected={grouping?.group === index + 1}>V{index + 1}</span>)}</div></section>
    </div>
    {(architecture.attention_heads ?? 0) > 128 || (architecture.kv_heads ?? 0) > 128 ? <label className="ma-head-selector">图中最多绘制前 128 个 heads；输入编号可查看其余 Query head 的分组。<input type="number" min="1" max={architecture.attention_heads ?? 1} value={queryHead} aria-label="选择 Query head 编号" onChange={(event) => { const value = Number(event.target.value); if (Number.isSafeInteger(value) && value >= 1 && value <= (architecture.attention_heads ?? 0)) setQueryHead(value); }} /></label> : null}
    <div className="ma-attention-cache" data-flow-node="cache" data-active={step === 2}><div><small>PER-LAYER KV CACHE</small><strong>第 {layer} 层 · 上下文记忆</strong><span>新 K/V 追加 · 历史 K/V 复用</span></div><div className="ma-cache-slots" aria-hidden="true">{["t₀", "t₁", "t₂", "新 t"].map((label, index) => <span key={label} data-new={index === 3}><i /><i /><small>{label}</small></span>)}</div><p>时间槽位是示例，不代表当前缓存长度或占用</p></div>
    <div className="ma-attention-result" data-active={step >= 3}><span>因果掩码 · softmax · V 加权</span><strong className="ma-attention-score" data-flow-node="score">softmax(QKᵀ / √d + mask) V</strong><div className="ma-attention-projection" data-flow-node="projection"><span>多头结果合并 → 输出投影</span></div></div>
    <p className="ma-head-explanation">{grouping ? `选择 Query head ${queryHead} → KV group ${grouping.group}；每组 ${grouping.queriesPerGroup} 个 Query heads 共享同组 Key/Value。` : "当前元数据无法确认均衡 GQA 分组；不推断 Query 与 KV 的对应关系。"}头维度：{formatNumber(architecture.head_dim)}。高亮表示所选结构关系，不代表该 head 正在推理。</p>
  </div>;
}

function FfnDiagram({ architecture, step }: { architecture: DetailedArchitecture; step: number }) {
  const dense = isDense(architecture);
  const container = useRef<HTMLDivElement>(null);
  const branches = dense ? ["gate_proj", "up_proj"] : ["输入投影"];
  const edges: FlowEdge[] = [
    { id: "ffn-input-to-norm", from: "ffn-input", to: "ffn-norm", active: step === 0 },
    ...branches.map((branch) => ({ id: `norm-to-${branch}`, from: "ffn-norm", to: branch, active: step === 0 })),
    ...branches.map((branch) => ({ id: `${branch}-to-activation`, from: branch, to: "activation", active: step === 1 })),
    { id: "activation-to-down", from: "activation", to: "down", active: step === 2 },
    { id: "down-to-residual-sum", from: "down", to: "ffn-sum", source: "bottom", target: "top", active: step === 3 },
    { id: "ffn-input-residual", from: "ffn-input", to: "ffn-sum", source: "bottom", target: "left", route: "vertical", kind: "residual", active: step === 3 },
    { id: "ffn-sum-to-output", from: "ffn-sum", to: "ffn-output", active: step === 3 },
  ];
  return <div ref={container} data-flow-scope className="ma-ffn-diagram ma-connected-ffn" data-step={step}><ArchitectureConnections containerRef={container} edges={edges} /><div className="ma-vector-chip" data-flow-node="ffn-input"><small>R2 · INPUT</small><strong>{formatNumber(architecture.embedding_length)}</strong><span>残差 1 输出</span></div><span className="ma-ffn-normalization ma-normalization" data-flow-node="ffn-norm" data-active={step === 0}>{dense ? "RMSNorm" : "归一化"}</span>
    <div className="ma-ffn-fork">{branches.map((name) => <div className="ma-ffn-matrix" data-flow-node={name} key={name} data-active={step === 0}><Matrix name={name} active={step === 0} rows={5} cols={8} /><strong>{formatNumber(architecture.embedding_length)} → {formatNumber(architecture.feed_forward_length)}</strong></div>)}</div>
    <div className="ma-activation" data-flow-node="activation" data-active={step === 1}><svg viewBox="0 0 120 70" aria-hidden="true"><path className="ma-axis" d="M12 56H110M30 62V8" /><path className="ma-activation-curve" d="M12 49C30 48 38 54 49 39S63 39 72 26S88 22 105 10" /></svg><strong>{dense ? "激活 × 门控" : "非线性处理"}</strong><span>具体激活类型未读取</span></div>
    <span className="ma-flow-space" /><div className="ma-ffn-return" data-flow-node="down" data-active={step === 2}><Matrix name={dense ? "down_proj" : "输出投影"} active={step === 2} rows={5} cols={8} /><strong>{formatNumber(architecture.feed_forward_length)} → {formatNumber(architecture.embedding_length)}</strong></div>
    <span className="ma-ffn-sum" data-active={step === 3}><ResidualSum flowNode="ffn-sum" label="接回归一化前表示" /></span><div className="ma-ffn-output ma-vector-chip" data-flow-node="ffn-output"><strong>{formatNumber(architecture.embedding_length)}</strong><span>返回本层</span></div>
    <p className="ma-demo-caption">单元格与曲线仅为过程示意，未读取权重、激活值或具体激活函数；维度来自本地 GGUF。</p>
  </div>;
}

function EmbeddingDiagram({ architecture, step }: { architecture: DetailedArchitecture; step: number }) {
  const [token, setToken] = useState(1);
  const container = useRef<HTMLDivElement>(null);
  return <div ref={container} data-flow-scope className="ma-embedding-diagram ma-connected-embedding" data-step={step}><ArchitectureConnections containerRef={container} edges={[{ id: "token-to-lookup", from: "tokens", to: "lookup", active: step === 1 }, { id: "lookup-to-vector", from: "lookup", to: "vector", active: step === 2 }]} /><div className="ma-example-tokens" data-flow-node="tokens"><small>TOKEN ID · 示例</small>{["α", "β", "γ"].map((label, index) => <button type="button" key={label} aria-pressed={token === index} onClick={() => setToken(index)} aria-label={`查看示例 token ${label}`}><strong>{label}</strong><span>ID{label}</span></button>)}</div><span className="ma-flow-space" />
    <div className="ma-embedding-table" data-flow-node="lookup" data-active={step === 1}><header><strong>Embedding lookup</strong><span>{formatNumber(architecture.vocab_size)} 词表 × {formatNumber(architecture.embedding_length)} 隐藏维度</span></header>{["…", "IDα", "IDβ", "IDγ", "…"].map((label, index) => <div className="ma-embedding-row" key={index} data-selected={index === token + 1}><span>{label}</span><Matrix name="" rows={1} cols={10} active={index === token + 1 && step >= 1} /></div>)}</div><span className="ma-flow-space" />
    <div className="ma-vector-chip ma-embedding-vector" data-flow-node="vector" data-active={step === 2}><Matrix name="TOKEN VECTOR" rows={7} cols={1} active={step === 2} /><strong>{formatNumber(architecture.embedding_length)} 维</strong><span>{actualLayerCount(architecture) > 0 ? "进入第 1 层" : "后续层数未知"}</span></div><p className="ma-demo-caption">ID 与行纹理是教学占位，不是当前文本的分词结果或模型权重。</p>
  </div>;
}

function OutputDiagram({ architecture, step }: { architecture: DetailedArchitecture; step: number }) {
  const container = useRef<HTMLDivElement>(null);
  const edges: FlowEdge[] = [
    { id: "final-norm-to-head", from: "final-norm", to: "head", active: step === 1 },
    { id: "head-to-logits", from: "head", to: "logits", active: step === 1 },
    { id: "logits-to-sample", from: "logits", to: "sample", source: "bottom", target: "top", active: step === 2 },
    { id: "sample-to-next-token", from: "sample", to: "next-token", source: "bottom", target: "right", route: "vertical", kind: "feedback", active: step === 3 },
    { id: "next-token-to-final-state", from: "next-token", to: "final-norm", source: "left", target: "left", route: "left", offset: 12, kind: "feedback", active: step === 3 },
  ];
  return <div ref={container} data-flow-scope className="ma-output-diagram ma-connected-output" data-step={step}><ArchitectureConnections containerRef={container} edges={edges} /><div className="ma-vector-chip" data-flow-node="final-norm" data-active={step === 0}><small>FINAL NORM</small><strong>{formatNumber(architecture.embedding_length)}</strong><span>最终隐藏表示</span></div><span className="ma-flow-space" /><div className="ma-output-head" data-flow-node="head" data-active={step === 1}><Matrix name="LM HEAD" active={step === 1} rows={6} cols={8} /><strong>输出投影</strong><span>{formatNumber(architecture.embedding_length)} → {formatNumber(architecture.vocab_size)}</span></div><span className="ma-flow-space" /><div className="ma-logits" data-flow-node="logits" data-active={step >= 1}><header><strong>词表 logits · 示例</strong><span>示意分数，非真实概率</span></header>{[35, 58, 91, 46, 24].map((width, index) => <div key={index} data-selected={step >= 2 && index === 2}><span>候选 {String.fromCharCode(65 + index)}</span><i style={{ "--logit-width": `${width}%` } as CSSProperties} /></div>)}</div><div className="ma-sampled-token" data-flow-node="sample" data-active={step >= 2}><span>示例采样</span><strong>候选 C</strong><small>采样策略由运行配置决定</small></div><div className="ma-output-feedback" data-flow-node="next-token" data-active={step === 3}><span>新 token → Embedding → 各层 · 复用 KV cache</span></div></div>;
}

export function ArchitectureExplorer({ architecture, connected = true, reduceMotion = false }: { architecture: DetailedArchitecture; connected?: boolean; reduceMotion?: boolean }) {
  const signature = useMemo(() => architectureSignature(architecture), [architecture]);
  return <ArchitectureExplorerSession key={`${architecture.model}:${signature}`} architecture={architecture} connected={connected} reduceMotion={reduceMotion} signature={signature} />;
}

function ArchitectureExplorerSession({ architecture, connected, reduceMotion, signature }: { architecture: DetailedArchitecture; connected: boolean; reduceMotion: boolean; signature: string }) {
  const [restored] = useState(() => readArchitectureNavigation(architecture, signature));
  const [initial] = useState(() => restored ?? defaultArchitectureNavigation());
  const [view, setView] = useState<ArchitectureView>(initial.view);
  const [step, setStep] = useState(initial.step);
  const [tensor, setTensor] = useState(initial.tensor);
  // Returning to a saved teaching step never restarts playback unexpectedly.
  const [playing, setPlaying] = useState(!restored);
  const { reduced, visible } = useMotionPreference(reduceMotion);
  const explorerRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigationPending = useRef(false);
  const regionId = useId();
  const steps = teachingSteps(view.level, isDense(architecture));
  const current = Math.min(step, steps.length - 1);
  const animating = playing && !reduced && visible && connected && architecture.available;
  const actual = actualLayerCount(architecture);
  const snapshot = useRef(initial);
  useLayoutEffect(() => { snapshot.current = { ...snapshot.current, view, step: current, tensor }; }, [view, current, tensor]);
  useLayoutEffect(() => {
    if (!explorerRef.current) return;
    const scroll = architectureScrollContainer(explorerRef.current);
    const eventTarget = scroll === document.scrollingElement || scroll === document.documentElement ? document : scroll;
    const save = () => {
      snapshot.current = { ...snapshot.current, scrollTop: scroll.scrollTop, scrollLeft: scroll.scrollLeft };
      writeArchitectureNavigation(architecture.model, signature, snapshot.current);
    };
    // All restored detail DOM is present before this layout effect, including the selected tensor tab.
    scroll.scrollTop = initial.scrollTop;
    scroll.scrollLeft = initial.scrollLeft;
    let frame: number | null = null;
    const onScroll = () => { if (frame === null) frame = window.requestAnimationFrame(() => { frame = null; save(); }); };
    eventTarget.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      eventTarget.removeEventListener("scroll", onScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
      save();
    };
  }, [architecture.model, signature, initial]);
  useEffect(() => { writeArchitectureNavigation(architecture.model, signature, snapshot.current); }, [architecture.model, signature, view, current, tensor]);
  function changeView(next: ArchitectureView) {
    if (next.layer !== view.layer) setTensor(defaultTensorNavigation());
    setView(next); setStep(0);
  }
  function navigate(next: ArchitectureView, focus = true) {
    navigationPending.current = focus; changeView(next);
  }
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
    <nav className="ma-breadcrumb" aria-label="架构层级"><button type="button" onClick={() => navigate({ level: "overview", layer: view.layer })} aria-current={view.level === "overview" ? "page" : undefined}>模型框架</button>{isLayer && <><ArchitectureArrow direction="chevron" size={12} /><button type="button" onClick={() => navigate({ level: "layer", layer: view.layer })} aria-current={view.level === "layer" ? "page" : undefined}>第 {view.layer} 层</button></>}{view.level !== "overview" && view.level !== "layer" && <><ArchitectureArrow direction="chevron" size={12} /><span aria-current="page">{titles[view.level]}</span></>}</nav>
    <section className="ma-canvas" aria-label={titles[view.level]}><header className="ma-canvas-heading"><div><span className="ma-kicker">{view.level === "overview" ? "MODEL ATLAS" : "COMPUTATION CLOSE-UP"}</span><h2 ref={headingRef} tabIndex={-1}>{titles[view.level]}</h2></div>{(isLayer || view.level === "overview") && actual > 0 ? <LayerSelector count={actual} layer={view.layer} onChange={(layer) => navigate({ level: view.level, layer }, false)} /> : <span className="ma-teaching-badge">教学演示 · 可逐步查看</span>}</header>
      <div id={regionId} className="ma-diagram-stage" key={view.level === "overview" ? "overview" : `${view.level}-${view.layer}`}>
        {view.level === "overview" && <Overview architecture={architecture} layer={view.layer} step={current} navigate={navigate} />}
        {view.level === "layer" && <LayerDiagram architecture={architecture} layer={view.layer} step={current} navigate={navigate} />}
        {view.level === "attention" && <AttentionDiagram architecture={architecture} layer={view.layer} step={current} />}
        {view.level === "ffn" && <FfnDiagram architecture={architecture} step={current} />}
        {view.level === "embedding" && <EmbeddingDiagram architecture={architecture} step={current} />}
        {view.level === "output" && <OutputDiagram architecture={architecture} step={current} />}
      </div>
      <div className="ma-playback"><div className="ma-playback-buttons"><button type="button" aria-pressed={playing} aria-controls={regionId} onClick={() => setPlaying((previous) => !previous)} disabled={reduced || !connected}>{playing && !reduced && connected ? "暂停动画" : "播放动画"}</button><button type="button" aria-label="上一步" onClick={() => { setPlaying(false); setStep((previous) => Math.max(0, previous - 1)); }} disabled={current === 0}><ArchitectureArrow direction="left" /></button><button type="button" aria-label="下一步" onClick={() => { setPlaying(false); setStep((previous) => (previous + 1) % steps.length); }}><ArchitectureArrow /></button><span>{current + 1} / {steps.length}</span></div><span className="ma-animation-label">{reduced ? "减少动态效果 · 手动查看步骤" : !connected ? "连接中断 · 教学动画暂停" : !visible ? "页面隐藏 · 动画暂停" : "独立教学时间线 · 非实时参数活动"}</span></div>
      <ol className="ma-step-track" aria-label="计算步骤">{steps.map((item, index) => <li key={item.name}><button type="button" aria-current={current === index ? "step" : undefined} onClick={() => { setPlaying(false); setStep(index); }}><span>{String(index + 1).padStart(2, "0")}</span>{item.name}</button></li>)}</ol>
      <div className="ma-step-explanation" aria-live={animating ? "off" : "polite"}><strong>{steps[current].name}</strong><p>{steps[current].description}</p></div>
    </section>
    {isLayer && <TensorWeightsPanel architecture={architecture} layer={view.layer} navigation={tensor} onNavigationChange={setTensor} />}
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
        const metadata = await getModelArchitecture(controller.signal);
        if (stopped || document.hidden || controller.signal.aborted) return;
        setArchitecture(metadata);
        setLoaded(true); setConnected(true); setError("");
      } catch {
        if (!stopped && !document.hidden && controller.signal.reason !== "hidden") { setConnected(false); setError("架构连接中断，保留上次元数据，正在重连…"); }
      } finally {
        clearTimeout(timeout); active = null;
        if (!stopped && !document.hidden) timer = setTimeout(() => void poll(), Math.max(5, interval) * 1000);
      }
    }
    function visibility() { clearTimeout(timer); if (document.hidden) active?.abort("hidden"); else void poll(); }
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => { stopped = true; clearTimeout(timer); active?.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [interval]);
  return <div className="model-architecture-page">
    {error && <Notice className="ma-notice" tone="error">{error}</Notice>}
    {architecture?.available ? <><section className="ma-model-identity"><div><strong>{architecture.name || architecture.model}</strong><span>{architecture.model} · {architecture.architecture || "架构类型未知"}</span></div><Specs><Spec name="层数" value={formatNumber(architecture.block_count)} /><Spec name="隐藏维度" value={formatNumber(architecture.embedding_length)} /><Spec name="Q / KV heads" value={`${formatNumber(architecture.attention_heads)} / ${formatNumber(architecture.kv_heads)}`} /><Spec name="存储参数" value={formatParameters(architecture.parameter_count)} title="GGUF 存储张量元素总数，不等于活跃参数" /><Spec name="训练上下文" value={formatNumber(architecture.context_length)} title="GGUF 训练上下文容量，不是当前运行 num_ctx" /><Spec name="量化" value={architecture.quantization || "—"} /></Specs></section><ArchitectureExplorer architecture={architecture} connected={connected} reduceMotion={reduceMotion} /></> : <EmptyState className="ma-unavailable" title={loaded ? "暂未读取模型结构" : "正在读取模型结构…"}>{architecture?.message || (loaded ? "选中模型的本地 GGUF 元数据暂不可用，或当前网关尚未提供架构信息。不会猜测层数或矩阵维度。" : "无需开始翻译，读取本地模型描述即可查看架构。")}</EmptyState>}
    <footer className="ma-sources"><span>计算路径参考</span><a href={architectureSource} target="_blank" rel="noreferrer">Hunyuan Dense 官方实现 <ArchitectureArrow direction="external" size={12} /></a><a href={/7b/i.test(architecture?.model ?? "") ? modelSource.replace("1.8B", "7B") : modelSource} target="_blank" rel="noreferrer">Tencent {/7b/i.test(architecture?.model ?? "") ? "7B" : "1.8B"} 参考配置 <ArchitectureArrow direction="external" size={12} /></a></footer>
  </div>;
}
