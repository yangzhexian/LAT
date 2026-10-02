# LAT 模型架构浏览（0.2.1-beta.4）

左侧“模型架构”独立入口与“模型”监测页分开。未启用模型时也可以读取已安装 GGUF 的架构；查看架构不会启动 llama-server 或执行额外推理。缺少本地模型、旧网关或读取失败时显示相应状态，不伪造层数或维度。

## 逐级查看

- 总览展示输入嵌入、书架中的 Transformer 层和输出路径。层编号从 1 开始，连接沿编号连续经过各层；点击书脊先抽出对应层，再展开内部计算。减少动态效果时直接进入细节。
- Transformer 层展示规范化、Attention、残差与 FFN 路径；输入分出第一条残差接回 Attention 后的加法节点，该节点再分出第二条残差接回 FFN 后的加法节点。主路、旁路及相邻层的输入/输出端口连续可见，可以继续进入注意力或前馈细节，也可以切换层编号。
- Attention 展示 Q/K/V、查询头与 KV 头的分组关系，以及每层 KV cache 的读写示意。
- FFN 展示隐藏表示的扩展、激活/门控与投影返回；Dense 路径只在确认支持的架构上使用，缺失的激活配置不编造名称。
- Embedding 用占位 token 演示查表获得隐藏向量；Output 用示例词表分数演示 logits、概率与采样。

每个细节有解释与独立步骤动画，可播放、暂停、逐步查看，并返回上一级或总览。动画、token、向量、概率和矩阵纹理是教学示例，不是用户提示词、实际权重、真实注意力分数或采样结果。当前层中使用的结构由模型元数据说明；播放位置不代表运行模型正在执行该层。

参数区默认使用矩阵视图，按 Q/K/V/O、FFN 和归一化等用途选择张量，展示其 GGUF 原生存储轴、元素数量，以及占本层已读取元素的比例。一维归一化参数显示向量，不乘以 head 数；二维或高阶张量使用有界分块示意，不按元素数量创建 DOM。格子颜色不编码实际权重、正负或活跃状态；高阶张量同时列出其他存储轴。

“矩阵视图 / 张量列表”可用鼠标和方向键切换，列表保留原始名称及形状。占比分母仅包含本层返回的已知元素数量；未知数量和截断列表明确提示。该占比不是显存占比，模型整体量化名称也不作为每个张量的精度。

## 数据与边界

沿用 `/admin/telemetry.inference.architecture`，增加可选 `vocab_size`、`head_dim`、`block_tensors` 和 `block_tensors_truncated`。每个张量描述包含 1-based `layer`、名称、GGUF 存储维度 `shape` 与元素数量 `elements`。维度顺序保留 GGUF 原始顺序，不当成普通矩阵的行列顺序。元素数不是实际激活数或运行时 FLOPs。

词表大小来自嵌入张量形状或元数据；head 维度优先读取 `attention.key_length`，仅对已确认的 `hunyuan-dense` 在可整除时由隐藏维度与查询头数推导。每层张量列表以本地 GGUF 描述为准，不假设所有层的存储形状必定相同。

只读取有界 header、metadata 和 tensor descriptor，最多保留 4096 个层张量描述；超过时标记截断。参数总量仍统计整个有界文件头中的张量。缓存按模型、路径、大小与修改时间失效，返回值深拷贝避免共享嵌套形状被改动；不读取权重数据、词表内容或用户翻译文本。

模型与架构页统一采用外侧页面滚动，内部内容自然展开。主动钻取和切层后聚焦新标题并定位到细节，轮询更新不会抢走滚动位置。动画遵守暂停、页面隐藏、断联、应用和系统减少动态效果；不靠颜色或动画单独表达步骤。键盘可操作入口、层选择、模块与步骤控制。

总览最多绘制 1024 层，查询头最多绘制 128 个按钮；超出时说明绘制范围，并提供真实编号输入以访问其余层或头。张量描述达到 4096 条上限时提示列表截断，不将缺失详情误报为缺少模型结构。

## 参考

- [Transformers HunYuan Dense 官方实现](https://github.com/huggingface/transformers/blob/main/src/transformers/models/hunyuan_v1_dense/modeling_hunyuan_v1_dense.py)：规范化、Attention、KV cache、门控 MLP、嵌入和输出路径。
- [Tencent Hy-MT2-1.8B 配置](https://huggingface.co/tencent/Hy-MT2-1.8B/blob/main/config.json)：官方模型配置，界面尺寸仍以本地 GGUF 为准。
- [Tencent Hy-MT2-7B 配置](https://huggingface.co/tencent/Hy-MT2-7B/blob/main/config.json)：7B 模型对应的官方参考配置。
- [GGUF 格式](https://github.com/ggml-org/ggml/blob/master/docs/gguf.md)：元数据和张量描述的存储顺序。
