import { useEffect, useId, useState, type RefObject } from "react";

export function ArchitectureArrow({ direction = "right", size = 14, className = "" }: { direction?: "right" | "left" | "external" | "chevron"; size?: number; className?: string }) {
  const paths = { right: "M4 12h15m-5-5 5 5-5 5", left: "M20 12H5m5-5-5 5 5 5", external: "M7 17 17 7M7 7h10v10", chevron: "m9 6 6 6-6 6" };
  return <svg className={`ma-arrow-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[direction]} /></svg>;
}

export function ResidualSum({ label = "残差相加", flowNode }: { label?: string; flowNode?: string }) {
  return <span className="ma-sum-symbol"><svg viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle data-flow-node={flowNode} cx="18" cy="18" r="13" /><path d="M12 18h12M18 12v12" /></svg><small>{label}</small></span>;
}

export type FlowAnchor = "left" | "right" | "top" | "bottom";
export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  source?: FlowAnchor;
  target?: FlowAnchor;
  route?: "auto" | "vertical" | "above" | "below" | "left" | "right" | "right-below";
  offset?: number;
  kind?: "main" | "residual" | "feedback";
  active?: boolean;
}
export interface FlowRect { left: number; top: number; width: number; height: number }
const round = (value: number) => Number(value.toFixed(2));

function anchor(rect: FlowRect, side: FlowAnchor) {
  return { x: round(side === "left" ? rect.left : side === "right" ? rect.left + rect.width : rect.left + rect.width / 2), y: round(side === "top" ? rect.top : side === "bottom" ? rect.top + rect.height : rect.top + rect.height / 2) };
}

export function connectionPath(edge: FlowEdge, rectangles: Record<string, FlowRect>) {
  const from = rectangles[edge.from];
  const to = rectangles[edge.to];
  if (!from || !to) return "";
  const automatic = !edge.source && !edge.target && (!edge.route || edge.route === "auto");
  const overlapX = from.left < to.left + to.width && to.left < from.left + from.width;
  const below = from.top + from.height <= to.top;
  const above = to.top + to.height <= from.top;
  const stacked = automatic && overlapX && (below || above);
  const source = edge.source ?? (stacked ? below ? "bottom" : "top" : "right");
  const target = edge.target ?? (stacked ? below ? "top" : "bottom" : "left");
  const start = anchor(from, source);
  const end = anchor(to, target);
  const bounds = Object.values(rectangles);
  const offset = edge.offset ?? 12;
  const top = round(Math.min(...bounds.map((rect) => rect.top)) - offset);
  const bottom = round(Math.max(...bounds.map((rect) => rect.top + rect.height)) + offset);
  const right = round(Math.max(...bounds.map((rect) => rect.left + rect.width)) + offset);
  const begin = `M${start.x},${start.y}`;
  if (edge.route === "above") return `${begin} V${top} H${end.x} V${end.y}`;
  if (edge.route === "below") return `${begin} V${bottom} H${end.x} V${end.y}`;
  if (edge.route === "left") return `${begin} H${round(Math.min(from.left, to.left) - offset)} V${end.y} H${end.x}`;
  if (edge.route === "right") return `${begin} H${round(Math.max(from.left + from.width, to.left + to.width) + offset)} V${end.y} H${end.x}`;
  if (edge.route === "right-below") return `${begin} H${right} V${bottom} H${end.x} V${end.y}`;
  if (edge.route === "vertical") return `${begin} V${end.y} H${end.x}`;
  if (source === "top" || source === "bottom") {
    const middle = round((start.y + end.y) / 2);
    return `${begin} V${middle} H${end.x} V${end.y}`;
  }
  const middle = round((start.x + end.x) / 2);
  return `${begin} H${middle} V${end.y} H${end.x}`;
}

export function bookFlowEdges(count: number, columns: number, step = 0): FlowEdge[] {
  if (!count || !columns) return [];
  const edges: FlowEdge[] = [{ id: "embedding-to-first-layer", from: "embedding", to: "book-1", active: step === 0 }];
  for (let layer = 1; layer < count; layer++) {
    const row = Math.floor((layer - 1) / columns);
    const reverse = row % 2 === 1;
    const turn = layer % columns === 0;
    edges.push({ id: `layer-${layer}-to-${layer + 1}`, from: `book-${layer}`, to: `book-${layer + 1}`, source: reverse ? "left" : "right", target: turn ? reverse ? "left" : "right" : reverse ? "right" : "left", route: turn ? reverse ? "left" : "right" : "auto", offset: 6, active: step === 1 });
  }
  const reverse = Math.floor((count - 1) / columns) % 2 === 1;
  edges.push({ id: "last-layer-to-output", from: `book-${count}`, to: "output", source: reverse ? "left" : "right", target: count > columns ? "bottom" : "left", route: count > columns ? "below" : "auto", offset: 20, active: step === 2 });
  edges.push({ id: "next-token-feedback", from: "output", to: "embedding", source: "bottom", target: "bottom", route: "below", offset: 51, kind: "feedback", active: step === 3 });
  return edges;
}

export function layerFlowEdges(step = 0): FlowEdge[] {
  return [
    { id: "input-to-norm", from: "input", to: "norm-1", active: step === 0 },
    { id: "norm-to-attention", from: "norm-1", to: "attention", active: step === 1 },
    { id: "attention-to-sum", from: "attention", to: "sum-1", active: step === 2 },
    { id: "sum-to-ffn-norm", from: "sum-1", to: "norm-2", source: "bottom", target: "top", active: step === 2 },
    { id: "ffn-norm-to-ffn", from: "norm-2", to: "ffn", source: "left", target: "right", active: step === 3 },
    { id: "ffn-to-sum", from: "ffn", to: "sum-2", source: "left", target: "right", active: step === 4 },
    { id: "sum-to-output", from: "sum-2", to: "output", source: "left", target: "right", active: step === 4 },
    { id: "input-residual", from: "input", to: "sum-1", source: "top", target: "top", route: "above", offset: 25, kind: "residual", active: step === 2 },
    { id: "ffn-residual", from: "sum-1", to: "sum-2", source: "right", target: "bottom", route: "right-below", offset: 18, kind: "residual", active: step === 4 },
  ];
}

export function ArchitectureConnections({ containerRef, edges }: { containerRef: RefObject<HTMLDivElement | null>; edges: FlowEdge[] }) {
  const marker = useId().replace(/:/g, "");
  const [layout, setLayout] = useState<{ width: number; height: number; rectangles: Record<string, FlowRect> }>({ width: 1, height: 1, rectangles: {} });
  const signature = edges.map((edge) => `${edge.id}:${edge.from}:${edge.to}`).join("|");
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let stopped = false;
    const refresh = () => {
      if (stopped) return;
      const outer = container.getBoundingClientRect();
      if (!outer.width || !outer.height) return;
      const rectangles: Record<string, FlowRect> = {};
      container.querySelectorAll<HTMLElement>("[data-flow-node]").forEach((node) => {
        const rect = node.getBoundingClientRect();
        rectangles[node.dataset.flowNode!] = { left: rect.left - outer.left, top: rect.top - outer.top, width: rect.width, height: rect.height };
      });
      setLayout({ width: outer.width, height: outer.height, rectangles });
    };
    refresh();
    const observer = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(refresh) : null;
    observer?.observe(container);
    container.querySelectorAll<HTMLElement>("[data-flow-node]").forEach((node) => observer?.observe(node));
    window.addEventListener("resize", refresh);
    const frame = window.requestAnimationFrame?.(refresh);
    void document.fonts?.ready.then(refresh);
    return () => { stopped = true; observer?.disconnect(); window.removeEventListener("resize", refresh); if (frame != null) window.cancelAnimationFrame(frame); };
  }, [containerRef, signature]);
  return <svg className="ma-connections" viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none" aria-hidden="true">
    <defs><marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="m2 2 6 3-6 3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></marker></defs>
    {edges.map((edge) => <path key={edge.id} data-connection={edge.id} data-from={edge.from} data-to={edge.to} data-kind={edge.kind ?? "main"} data-active={Boolean(edge.active)} d={connectionPath(edge, layout.rectangles)} markerEnd={`url(#${marker})`} />)}
  </svg>;
}

export function BookCircuit({ layer, reverse }: { layer: number; reverse: boolean }) {
  return <svg className="ma-book-circuit" viewBox="0 0 48 104" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <text x="24" y="9" className="ma-book-number">L{String(layer).padStart(2, "0")}</text>
    <path d={reverse ? "M48 52H42V16H24V22" : "M0 52H6V16H24V22"} />
    <rect x="14" y="22" width="20" height="14" rx="2" /><text x="24" y="31">ATTN</text>
    <path d="M24 36v5m-2-3 2 3 2-3" /><circle cx="24" cy="45" r="4" /><path d="M22 45h4M24 43v4M24 49v9" />
    <rect x="14" y="58" width="20" height="14" rx="2" /><text x="24" y="67">FFN</text>
    <path d="M24 72v8m-2-3 2 3 2-3" /><circle cx="24" cy="84" r="4" /><path d="M22 84h4M24 82v4" />
    <path className="ma-book-residual" d="M24 16H10v29h10M24 49h14v35H28" /><text className="ma-book-residual-label" x="7" y="39">R1</text><text className="ma-book-residual-label" x="41" y="78">R2</text>
    <path d={reverse ? "M24 88v10H6V52H0" : "M24 88v10h18V52h6"} />
  </svg>;
}
