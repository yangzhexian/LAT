import { actualLayerCount, isDense, teachingSteps, type ArchitectureView, type DetailedArchitecture } from "../features/model-architecture/architectureModel";

export const architectureNavigationKey = "lat.architecture-navigation.v1";
export interface TensorNavigation { tab: "matrix" | "list"; selectedName: string | null }
export interface ArchitectureNavigation {
  view: ArchitectureView;
  step: number;
  tensor: TensorNavigation;
  scrollTop: number;
  scrollLeft: number;
}
interface SavedNavigation extends ArchitectureNavigation { model: string; signature: string }
export const defaultTensorNavigation = (): TensorNavigation => ({ tab: "matrix", selectedName: null });
export const defaultArchitectureNavigation = (): ArchitectureNavigation => ({ view: { level: "overview", layer: 1 }, step: 0, tensor: defaultTensorNavigation(), scrollTop: 0, scrollLeft: 0 });

// Include the descriptors, not only their count: a replaced tensor or changed shape invalidates the view.
export function architectureSignature(architecture: DetailedArchitecture) {
  const description = JSON.stringify([architecture.model, architecture.architecture, architecture.block_count, architecture.embedding_length, architecture.attention_heads, architecture.kv_heads, architecture.head_dim, architecture.feed_forward_length, architecture.vocab_size, architecture.block_tensors_truncated, architecture.block_tensors?.map(({ layer, name, shape, elements }) => [layer, name, shape, elements])]);
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < description.length; index++) {
    const code = description.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second, 33) ^ code;
  }
  return `${description.length}:${first >>> 0}:${second >>> 0}`;
}

function records(): unknown[] {
  try {
    const raw = window.sessionStorage.getItem(architectureNavigationKey);
    if (!raw || raw.length > 65536) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length <= 8 ? parsed : [];
  } catch { return []; }
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function scrollValue(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10000000; }

export function readArchitectureNavigation(architecture: DetailedArchitecture, signature: string): ArchitectureNavigation | null {
  const saved = records().find((item) => object(item) && item.model === architecture.model);
  if (!object(saved) || saved.signature !== signature || !object(saved.view) || !object(saved.tensor)) return null;
  const { level, layer } = saved.view;
  if (typeof level !== "string" || !["overview", "layer", "attention", "ffn", "embedding", "output"].includes(level)) return null;
  if (typeof layer !== "number" || !Number.isSafeInteger(layer) || layer < 1 || layer > Math.max(1, actualLayerCount(architecture))) return null;
  if (["layer", "attention", "ffn"].includes(level) && !actualLayerCount(architecture)) return null;
  const view = { level, layer } as ArchitectureView;
  if (typeof saved.step !== "number" || !Number.isSafeInteger(saved.step) || saved.step < 0 || saved.step >= teachingSteps(view.level, isDense(architecture)).length) return null;
  if (saved.tensor.tab !== "matrix" && saved.tensor.tab !== "list") return null;
  const selectedName = saved.tensor.selectedName;
  if (selectedName !== null && (typeof selectedName !== "string" || !architecture.block_tensors?.some((tensor) => tensor.layer === layer && tensor.name === selectedName))) return null;
  if (!scrollValue(saved.scrollTop) || !scrollValue(saved.scrollLeft)) return null;
  return { view, step: saved.step, tensor: { tab: saved.tensor.tab, selectedName }, scrollTop: saved.scrollTop, scrollLeft: saved.scrollLeft };
}

export function writeArchitectureNavigation(model: string, signature: string, navigation: ArchitectureNavigation) {
  const saved: SavedNavigation = { model, signature, ...navigation };
  try {
    const previous = records().filter((item) => object(item) && typeof item.model === "string" && item.model !== model);
    window.sessionStorage.setItem(architectureNavigationKey, JSON.stringify([...previous.slice(-7), saved]));
  } catch { /* Disabled or full session storage must not interrupt navigation. */ }
}

export function architectureScrollContainer(element: HTMLElement): HTMLElement {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent);
    if (/(auto|scroll|overlay)/.test(style.overflowY || style.overflow)) return parent;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}
