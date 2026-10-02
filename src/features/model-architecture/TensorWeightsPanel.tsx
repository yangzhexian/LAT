import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { formatNumber, formatParameters, type BlockTensor, type DetailedArchitecture } from "./architectureModel";
import { matrixLayout, tensorRole, tensorShare, tensorSummary } from "./tensorPresentation";
import "./weights.css";

function TensorSymbol({ vector = false }: { vector?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y={vector ? "9" : "4"} width="16" height={vector ? "6" : "16"} rx="2" />
    <path d={vector ? "M9 9v6m6-6v6" : "M4 9h16M4 15h16M9 4v16M15 4v16"} />
  </svg>;
}

function TensorMatrix({ tensor }: { tensor: BlockTensor }) {
  const layout = matrixLayout(tensor.shape);
  const dimensions = tensor.shape.map(formatNumber).join(" × ");
  if (!layout) return <div className="ma-weight-matrix-unknown">存储形状未知</div>;
  return <figure className="ma-weight-blueprint" style={{ "--weight-ratio": layout.ratio } as CSSProperties} aria-label={`${tensor.name}，存储形状 ${dimensions}，结构分块示意，不包含权重数值`}>
    <div className="ma-weight-axis ma-weight-axis-top"><span>存储轴 1</span><strong>{formatNumber(tensor.shape[0])}</strong></div>
    <div className="ma-weight-grid-wrap">
      <div className="ma-weight-axis ma-weight-axis-side"><span>{layout.vector ? "参数向量" : "存储轴 2"}</span>{!layout.vector && <strong>{formatNumber(tensor.shape[1])}</strong>}</div>
      <div className="ma-weight-grid" data-vector={layout.vector} style={{ "--weight-columns": layout.columns } as CSSProperties} aria-hidden="true">
        {Array.from({ length: layout.columns * layout.rows }, (_, index) => <i key={index} />)}
      </div>
    </div>
    {tensor.shape.length > 2 && <div className="ma-weight-extra-axes">{tensor.shape.slice(2).map((size, index) => <span key={index}>存储轴 {index + 3}：{formatNumber(size)}</span>)}</div>}
    <figcaption>{tensor.shape.length > 2 ? "存储轴 1/2 的平面示意 · " : "结构分块示意 · "}比例已压缩 · 每格不对应一个参数</figcaption>
  </figure>;
}

export function TensorWeightsPanel({ architecture, layer }: { architecture: DetailedArchitecture; layer: number }) {
  const [view, setView] = useState<"matrix" | "list">("matrix");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const panelId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tensors = (architecture.block_tensors?.filter((tensor) => tensor.layer === layer) ?? []).slice().sort((a, b) => tensorRole(a.name).order - tensorRole(b.name).order || a.name.localeCompare(b.name));
  const selected = tensors.find((tensor) => tensor.name === selectedName) ?? tensors[0];
  const summary = tensorSummary(tensors);
  const share = selected ? tensorShare(selected, summary.elements) : null;
  const partial = architecture.block_tensors_truncated || summary.incomplete;
  useEffect(() => { setSelectedName(null); setView("matrix"); }, [architecture.model, layer]);
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
    setView(next === 0 ? "matrix" : "list"); tabRefs.current[next]?.focus();
  }
  return <section className="ma-tensors ma-weights" aria-label={`第 ${layer} 层参数`}>
    <header className="ma-weights-heading"><div><span className="ma-kicker">PARAMETER BLUEPRINT</span><h3>第 {layer} 层 · 参数结构</h3></div>
      {tensors.length > 0 && <div className="ma-weight-view-tabs" role="tablist" aria-label="参数展示方式">{(["matrix", "list"] as const).map((value, index) => <button type="button" key={value} ref={(element) => { tabRefs.current[index] = element; }} role="tab" id={`${panelId}-${value}-tab`} aria-controls={`${panelId}-${value}-panel`} aria-selected={view === value} tabIndex={view === value ? 0 : -1} onClick={() => setView(value)} onKeyDown={(event) => tabKey(event, index)}>{value === "matrix" ? "矩阵视图" : "张量列表"}</button>)}</div>}
    </header>
    {tensors.length ? <>
      <div className="ma-weight-summary"><span><strong>{tensors.length}</strong> 个存储张量</span><span><strong>{formatParameters(summary.elements)}</strong> 已读取元素{partial ? " · 部分描述" : ""}</span><span>GGUF 形状 · 未读取权重数值</span></div>
      <div role="tabpanel" id={`${panelId}-matrix-panel`} aria-labelledby={`${panelId}-matrix-tab`} hidden={view !== "matrix"}>
        {view === "matrix" && selected && <>
          <div className="ma-weight-cards" role="group" aria-label="选择参数张量">{tensors.map((tensor) => {
            const role = tensorRole(tensor.name);
            return <button type="button" key={tensor.name} className="ma-weight-card" aria-label={`查看 ${tensor.name}`} aria-pressed={selected.name === tensor.name} aria-controls={`${panelId}-detail`} onClick={() => setSelectedName(tensor.name)}>
              <TensorSymbol vector={tensor.shape.length === 1} /><span><strong>{role.label}</strong><small>{role.group}</small></span><span className="ma-weight-card-size">{tensor.shape.map(formatNumber).join(" × ") || "—"}</span>
            </button>;
          })}</div>
          <div id={`${panelId}-detail`} className="ma-weight-detail">
            <TensorMatrix tensor={selected} />
            <div className="ma-weight-info"><span className="ma-weight-role">{tensorRole(selected.name).group} · {selected.shape.length === 1 ? "参数向量" : `${selected.shape.length} 维张量`}</span><h4>{tensorRole(selected.name).label}</h4><code>{selected.name}</code><p>{tensorRole(selected.name).description}</p>
              <dl><div><dt>GGUF 存储维度</dt><dd>{selected.shape.map(formatNumber).join(" × ") || "—"}</dd></div><div><dt>存储元素数量</dt><dd>{formatNumber(selected.elements)}</dd></div></dl>
              <div className="ma-weight-share"><div><span>占本层已读取元素</span><strong>{share === null ? "—" : `${share < .1 ? share.toPrecision(2) : share.toFixed(1)}%`}</strong></div><div className="ma-weight-share-track" aria-hidden="true"><i style={{ width: `${share ?? 0}%` }} /></div></div>
            </div>
          </div>
        </>}
      </div>
      <div role="tabpanel" id={`${panelId}-list-panel`} aria-labelledby={`${panelId}-list-tab`} hidden={view !== "list"}>{view === "list" && <table><thead><tr><th scope="col">张量</th><th scope="col">存储维度</th><th scope="col">元素数量</th></tr></thead><tbody>{tensors.map((tensor) => <tr key={tensor.name}><th scope="row">{tensor.name}</th><td>{tensor.shape.map(formatNumber).join(" × ") || "—"}</td><td>{formatNumber(tensor.elements)}</td></tr>)}</tbody></table>}</div>
    </> : <p>{architecture.block_tensors_truncated ? "描述列表达到读取上限，该层形状可能未包含在当前响应中。" : "当前元数据未提供该层的张量形状。"}</p>}
    {architecture.block_tensors_truncated && <p className="ma-weight-partial">张量描述列表已截断；当前展示不是全部存储张量。</p>}
    {summary.incomplete && <p className="ma-weight-partial">部分元素数量未知；累计和占比只包含已知的存储元素。</p>}
    <small>维度遵循 GGUF 原生存储顺序；不是标准矩阵行列展示，也不是实时权重值。矩阵格子只表达结构，不编码权重大小、正负或活跃状态。</small>
  </section>;
}
