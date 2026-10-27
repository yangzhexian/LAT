import type { BlockTensor } from "./architectureModel";

const roles = [
  { key: "attn_q", label: "Q 投影", group: "Attention", description: "Query 投影参数，用于构造查询表示。" },
  { key: "attn_k", label: "K 投影", group: "Attention", description: "Key 投影参数，用于构造上下文匹配的键。" },
  { key: "attn_v", label: "V 投影", group: "Attention", description: "Value 投影参数，用于构造被注意力加权的内容。" },
  { key: "attn_output", label: "O 投影", group: "Attention", description: "多头注意力合并后的输出投影参数。" },
  { key: "ffn_gate", label: "Gate 投影", group: "FFN", description: "前馈网络门控分支的投影参数。" },
  { key: "ffn_up", label: "Up 投影", group: "FFN", description: "前馈网络扩展分支的投影参数。" },
  { key: "ffn_down", label: "Down 投影", group: "FFN", description: "将前馈中间表示投影回隐藏维度的参数。" },
  { key: "attn_norm", label: "输入归一化", group: "Norm", description: "注意力前归一化的参数向量。" },
  { key: "attn_q_norm", label: "Q 归一化", group: "Norm", description: "Query 归一化的参数向量。" },
  { key: "attn_k_norm", label: "K 归一化", group: "Norm", description: "Key 归一化的参数向量。" },
  { key: "ffn_norm", label: "FFN 归一化", group: "Norm", description: "前馈网络前归一化的参数向量。" },
];

export function tensorRole(name: string) {
  const key = name.replace(/^blk\.\d+\./, "").replace(/\.(weight|bias)$/, "");
  const index = roles.findIndex((role) => role.key === key);
  const role = roles[index];
  return {
    label: (role?.label ?? key) + (name.endsWith(".bias") ? "（偏置）" : ""),
    group: role?.group ?? "其他",
    description: role?.description ?? "该张量的专属计算用途尚未确认，按 GGUF 描述展示存储结构。",
    order: index === -1 ? roles.length : index,
  };
}

export function validDimension(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0;
}

export function tensorSummary(tensors: BlockTensor[]) {
  const known = tensors.filter((tensor) => tensor.elements !== null && Number.isSafeInteger(tensor.elements) && tensor.elements >= 0);
  const sum = known.reduce((total, tensor) => total + (tensor.elements ?? 0), 0);
  return { elements: Number.isSafeInteger(sum) ? sum : null, incomplete: known.length !== tensors.length || !Number.isSafeInteger(sum) };
}

export function tensorShare(tensor: BlockTensor, total: number | null) {
  return total !== null && total > 0 && tensor.elements !== null && Number.isSafeInteger(tensor.elements) && tensor.elements >= 0 && tensor.elements <= total
    ? tensor.elements / total * 100 : null;
}

export function matrixLayout(shape: number[]) {
  if (!shape.length || !shape.every(validDimension)) return null;
  const vector = shape.length === 1;
  return { vector, columns: vector ? 16 : 12, rows: vector ? 1 : 8, ratio: vector ? 5 : Math.max(.6, Math.min(2.6, shape[0] / shape[1])) };
}
