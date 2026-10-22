import { useEffect, useId, useMemo, useState, type RefObject } from "react";

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
  route?: "auto" | "vertical" | "above" | "below" | "left" | "right" | "outside-right" | "right-below";
  offset?: number;
  kind?: "main" | "residual" | "feedback";
  active?: boolean;
}
export interface FlowRect { left: number; top: number; width: number; height: number }
interface FlowBounds { top: number; bottom: number; right: number }
const round = (value: number) => Number(value.toFixed(2));

export function connectionBounds(rectangles: Record<string, FlowRect>): FlowBounds {
  let top = Infinity, bottom = -Infinity, right = -Infinity;
  for (const rect of Object.values(rectangles)) {
    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.top + rect.height);
    right = Math.max(right, rect.left + rect.width);
  }
  return { top, bottom, right };
}

function anchor(rect: FlowRect, side: FlowAnchor) {
  return { x: round(side === "left" ? rect.left : side === "right" ? rect.left + rect.width : rect.left + rect.width / 2), y: round(side === "top" ? rect.top : side === "bottom" ? rect.top + rect.height : rect.top + rect.height / 2) };
}

export function connectionPath(edge: FlowEdge, rectangles: Record<string, FlowRect>, bounds = connectionBounds(rectangles)) {
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
  const offset = edge.offset ?? 12;
  const top = round(bounds.top - offset);
  const bottom = round(bounds.bottom + offset);
  const right = round(bounds.right + offset);
  const begin = `M${start.x},${start.y}`;
  if (edge.route === "above") return `${begin} V${top} H${end.x} V${end.y}`;
  if (edge.route === "below") return `${begin} V${bottom} H${end.x} V${end.y}`;
  if (edge.route === "left") return `${begin} H${round(Math.min(from.left, to.left) - offset)} V${end.y} H${end.x}`;
  if (edge.route === "right") return `${begin} H${round(Math.max(from.left + from.width, to.left + to.width) + offset)} V${end.y} H${end.x}`;
  if (edge.route === "outside-right") return `${begin} H${right} V${end.y} H${end.x}`;
  if (edge.route === "right-below") return `${begin} H${right} V${bottom} H${end.x} V${end.y}`;
  if (edge.route === "vertical") return `${begin} V${end.y} H${end.x}`;
  if (source === "top" || source === "bottom") {
    const middle = round((start.y + end.y) / 2);
    return `${begin} V${middle} H${end.x} V${end.y}`;
  }
  const middle = round((start.x + end.x) / 2);
  return `${begin} H${middle} V${end.y} H${end.x}`;
}

export function overviewFlowEdges(count: number, step = 0): FlowEdge[] {
  if (!count) return [];
  return [
    { id: "embedding-to-layers", from: "embedding", to: "stack", source: "bottom", target: "top", active: step === 0 },
    { id: "layers-to-output", from: "stack", to: "output", source: "bottom", target: "top", active: step === 2 },
    { id: "next-token-feedback", from: "output", to: "embedding", source: "right", target: "right", route: "outside-right", offset: 18, kind: "feedback", active: step === 3 },
  ];
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
  // Active steps change every animation tick; they never invalidate geometry.
  const signature = JSON.stringify(edges.map(({ active: _active, ...geometry }) => geometry));
  const geometry = useMemo(() => JSON.parse(signature) as FlowEdge[], [signature]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const endpoints = new Set(geometry.flatMap((edge) => [edge.from, edge.to]));
    const scope = container.closest("[data-flow-scope]");
    const nodes = [...container.querySelectorAll<HTMLElement>("[data-flow-node]")].filter((node) => endpoints.has(node.dataset.flowNode!) && node.closest("[data-flow-scope]") === scope);
    let stopped = false;
    let frame: number | null = null;
    const refresh = () => {
      frame = null;
      if (stopped) return;
      const outer = container.getBoundingClientRect();
      if (!outer.width || !outer.height) return;
      const rectangles: Record<string, FlowRect> = {};
      nodes.forEach((node) => {
        const rect = node.getBoundingClientRect();
        rectangles[node.dataset.flowNode!] = { left: rect.left - outer.left, top: rect.top - outer.top, width: rect.width, height: rect.height };
      });
      setLayout((previous) => {
        const keys = Object.keys(rectangles);
        if (previous.width === outer.width && previous.height === outer.height && keys.length === Object.keys(previous.rectangles).length && keys.every((key) => {
          const before = previous.rectangles[key], after = rectangles[key];
          return before && before.left === after.left && before.top === after.top && before.width === after.width && before.height === after.height;
        })) return previous;
        return { width: outer.width, height: outer.height, rectangles };
      });
    };
    const schedule = () => { if (!stopped && frame === null) frame = window.requestAnimationFrame(refresh); };
    refresh();
    const observer = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(schedule) : null;
    observer?.observe(container);
    nodes.forEach((node) => observer?.observe(node));
    window.addEventListener("resize", schedule);
    document.fonts?.addEventListener("loadingdone", schedule);
    if (document.fonts?.status === "loading") void document.fonts.ready.then(schedule);
    return () => { stopped = true; observer?.disconnect(); window.removeEventListener("resize", schedule); document.fonts?.removeEventListener("loadingdone", schedule); if (frame !== null) window.cancelAnimationFrame(frame); };
  }, [containerRef, geometry]);
  const paths = useMemo(() => {
    const bounds = connectionBounds(layout.rectangles);
    return geometry.map((edge) => connectionPath(edge, layout.rectangles, bounds));
  }, [geometry, layout]);
  return <svg className="ma-connections" viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none" aria-hidden="true">
    <defs><marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="m2 2 6 3-6 3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></marker></defs>
    {edges.map((edge, index) => <path key={edge.id} data-connection={edge.id} data-from={edge.from} data-to={edge.to} data-kind={edge.kind ?? "main"} data-active={Boolean(edge.active)} d={paths[index]} markerEnd={`url(#${marker})`} />)}
  </svg>;
}
