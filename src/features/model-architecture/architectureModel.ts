import type { ModelArchitecture } from "../../types";

export type ArchitectureLevel = "overview" | "layer" | "attention" | "ffn" | "embedding" | "output";
export interface ArchitectureView { level: ArchitectureLevel; layer: number }
export interface BlockTensor { layer: number; name: string; shape: number[]; elements: number | null }
export type DetailedArchitecture = ModelArchitecture & {
  vocab_size?: number | null;
  head_dim?: number | null;
  block_tensors?: BlockTensor[];
  block_tensors_truncated?: boolean;
};
export interface TeachingStep { name: string; description: string }

export const architectureSource = "https://github.com/huggingface/transformers/blob/main/src/transformers/models/hunyuan_v1_dense/modeling_hunyuan_v1_dense.py";
export const modelSource = "https://huggingface.co/tencent/Hy-MT2-1.8B/blob/main/config.json";

export function isDense(architecture: DetailedArchitecture) {
  return architecture.available && /^hunyuan.*dense$/.test(architecture.architecture ?? "");
}
export function layerCount(architecture: DetailedArchitecture) {
  return Math.min(actualLayerCount(architecture), 1024);
}
export function actualLayerCount(architecture: DetailedArchitecture) {
  const count = architecture.block_count;
  return count != null && Number.isSafeInteger(count) && count > 0 ? count : 0;
}
export function formatNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("zh-CN").format(value) : "—";
}
export function formatParameters(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value >= 1e9 ? `${(value / 1e9).toFixed(2)} B` : value >= 1e6 ? `${(value / 1e6).toFixed(1)} M` : formatNumber(value);
}
export function gqaGroup(architecture: DetailedArchitecture, queryHead: number) {
  const query = architecture.attention_heads;
  const kv = architecture.kv_heads;
  if (!query || !kv || !Number.isSafeInteger(query) || !Number.isSafeInteger(kv) || !Number.isSafeInteger(queryHead) || query % kv || queryHead < 1 || queryHead > query || !isDense(architecture)) return null;
  return { group: Math.floor((queryHead - 1) / (query / kv)) + 1, queriesPerGroup: query / kv };
}

export function teachingSteps(level: ArchitectureLevel, dense: boolean): TeachingStep[] {
  switch (level) {
    case "overview": return [
      { name: "嵌入输入", description: "Token ID 通过嵌入矩阵查表，成为隐藏向量。图中流光是教学节奏，不是当前推理计时。" },
      { name: "逐层处理", description: dense ? "密集 Decoder 的生成 token 沿全部 Transformer 层前进。各层结构相似，但具有各自的参数。点击任一层可展开内部计算。" : "层数来自本地 GGUF。点击任一层查看通用 Transformer 计算路径；模型专属算子尚未确认。" },
      { name: "输出投影", description: "最终表示经过归一化与输出 head，得到词表候选的分数 logits。" },
      { name: "采样与回流", description: "采样决定后续 token，再进入下一轮生成。图中候选及连线均为计算过程示例。" },
    ];
    case "layer": return [
      { name: "输入归一化", description: dense ? "本层输入先进行 RMSNorm，再送入注意力；原始输入沿残差支路保留。" : "通用示意：输入经过归一化，原始表示沿残差支路保留；具体算子取决于模型实现。" },
      { name: "注意力", description: "Q/K/V 投影结合当前表示和历史上下文，输出上下文相关的表示。点击注意力模块继续放大。" },
      { name: "第一条残差", description: "注意力输出与保留的本层输入相加，然后进入前馈路径前的归一化。" },
      { name: "前馈变换", description: dense ? "密集前馈网络进行 gate/up 投影、激活与门控相乘，再 down 投影回隐藏维度。点击前馈模块查看。" : "通用前馈示意：中间表示经过非线性变换，再返回隐藏维度；具体分支未确认。" },
      { name: "第二条残差", description: "前馈结果加回第一条残差的输出，即第二次归一化前保留的隐藏表示，成为后续层的输入。这是结构演示，不包含真实张量值。" },
    ];
    case "attention": return [
      { name: "Q/K/V 投影", description: "同一隐藏表示分别经过 Query、Key、Value 投影。头数来自本地元数据；下方可选择任意 Query head 查看分组。" },
      { name: "位置与归一化", description: dense ? "Hunyuan Dense 官方实现对 Q/K 进行位置编码和归一化。此页不展示未读取的位置编码配置参数。" : "位置处理和归一化的具体配置尚未确认，此步骤仅为通用位置处理示意。" },
      { name: "KV 缓存", description: "将本层新产生的 Key/Value 与历史缓存结合。缓存按层保留，后续生成复用上下文，不需要重新计算已有 token 的 K/V。" },
      { name: "匹配上下文", description: "Q 与 K 计算匹配分数，经因果掩码和 softmax 后对 V 加权。示意中没有真实注意力权重或热力图。" },
      { name: "合并与投影", description: "各 Query head 的结果合并，并经输出投影返回隐藏维度，再回到本层残差连接。" },
    ];
    case "ffn": return dense ? [
      { name: "双路投影", description: "残差 1 的输出先进行 RMSNorm，归一化后的隐藏表示分别进入 gate_proj 与 up_proj，扩展到前馈中间维度。矩阵纹理仅为示意。" },
      { name: "激活与门控", description: "gate 分支经过配置的激活函数，再与 up 分支逐元素相乘。此页未读取具体激活函数类型。" },
      { name: "返回隐藏维度", description: "down_proj 将中间表示投影回隐藏维度。这里使用密集矩阵计算，没有展示或模拟 MoE 专家选择。" },
      { name: "接回残差", description: "变换结果与归一化前保留的隐藏表示（残差 1 的输出）相加。此动画是演示，未读取任何权重或激活值。" },
    ] : [
      { name: "输入投影", description: "通用前馈示意：将隐藏表示变换为中间表示。具体网络分支尚未确认。" },
      { name: "非线性处理", description: "非线性处理增强表示能力；具体激活函数未读取，不将示意曲线当作模型配置。" },
      { name: "输出投影", description: "中间表示返回隐藏维度，继续本层后续计算。" },
      { name: "残差路径", description: "图中展示通用的残差接回过程，具体结构以模型实现为准。" },
    ];
    case "embedding": return [
      { name: "Token ID", description: "分词器将文本映射为 token ID。此处 α / β / γ 是教学占位，不是当前文本的真实分词结果。" },
      { name: "查找矩阵行", description: "Token ID 选择嵌入矩阵中的对应行，不会对整个词表逐行做投影。词表规模与隐藏维度在有元数据时显示。" },
      { name: "取出隐藏向量", description: "选中的行成为该 token 的隐藏向量，并输入首层 Transformer。展示的单元格没有真实权重数值。" },
    ];
    case "output": return [
      { name: "最终归一化", description: "经过全部层后的隐藏表示先进入最终归一化，再送入输出 head。" },
      { name: "词表分数", description: "输出投影将隐藏表示变成词表 logits。下方候选条形是教学示例，不是当前 token 的分数或概率。" },
      { name: "选择后续 token", description: "运行配置决定采样策略，选出后续 token。此页没有读取采样温度，也不会用示例分数代替真实概率。" },
      { name: "进入下一轮", description: "新 token 返回嵌入与 Transformer 路径，复用已有 KV cache，重复生成，直到满足停止条件。" },
    ];
  }
}
