# LAT 统一验收清单

当前验收版本：`0.2.1-beta.9`。本地分支：`codex/acceptance-beta9`。安装包：`artifacts/v0.2.1-beta.9/LAT_0.2.1-beta.9_x64-setup.exe`，同目录提供 `SHA256SUMS.txt`。安装前从托盘退出旧 LAT，沿用已有模型、设置和历史。开发验证见 [beta.9 发布说明](../releases/v0.2.1-beta.9.md)。

beta.8 的 56 项已勾选结果、3 项未勾选的第三方接口项目，以及 7 条原始反馈，已完整保留在下方历史附录；它们不作为 beta.9 的复验结论。本版重点复验历史导出、搜索焦点、架构重新设计及默认 GPU 看板，既有旧清单继续仅作归档，不另建并行验收入口。

## 当前版本验收

### I 安装与兼容

- [ ] I01 安装包与应用版本为 0.2.1-beta.9，SHA-256 与同目录校验文件一致；升级后识别已有数据目录，模型、设置和历史保留。

### H 搜索与历史导出

- [ ] H01 在历史页搜索框中点击、输入并用 Tab 聚焦，左侧及四周的高亮边框完整；900/1320 像素窗口、明暗主题及出现滚动条时均无裁切和横向跳动。
- [ ] H02 点击“导出 JSON”出现原生另存为对话框，可选择目录与文件名；保存完成后页面显示实际路径，目标文件可打开，包含当前筛选下全部完整记录而非只有当前页摘要。
- [ ] H03 “导出 Markdown”同样可选择路径，中文、英文、换行、公式、链接、代码和连续反引号完整；从第二页导出仍包含所有匹配页的记录。
- [ ] H04 取消另存为不报保存成功，不产生文件；导出期间不能重复提交，自然遇到不可写目录等失败时有明确提示并能重新导出，原有同名文件不会被失败写入破坏。
- [ ] H05 搜索、语言/模型/来源筛选、翻页、展开、恢复、删除与容量设置继续正常；全文面板等高，长路径及错误提示不会撑出页面横向滚动。

### A 架构画布与动画

- [ ] A01 相同 Transformer 结构只展示一份共享架构与重复层数，不再为 32 层列出 32 个架构选项；总览可进入 Attention、FFN、Embedding、Output。
- [ ] A02 模块采用一致的对齐、间距和阅读顺序；说明中的分隔符使用自然文字、括号或逗号，打开入口没有突兀的大号右上箭头，其他方向图标大小协调。
- [ ] A03 隐藏向量、注意力计算等数学公式由本地 LaTeX 渲染，分数、上下标、粗体、集合符号正常；断网可查看，首次进入时快速切页不报公式错误，公式完成排版后连线仍准确。
- [ ] A04 连线、矩阵、缓存等组件持续展示计算关系，动画不再定时切换整段步骤说明；手动选择说明不打断布局，暂停和继续动画可用。
- [ ] A05 真实层参数可从独立参数检查区选择，层号与本地 GGUF 张量对应；各层权重独立，示意格子不冒充真实数值；切页返回保留参数位置与手动说明选择。
- [ ] A06 减少动态效果、隐藏页面、断联及离开架构页会停止动态效果；重新进入按原有规则保持暂停。900/1320 像素宽、较矮窗口与明暗主题中能滚到末尾，无重复整页滚动条；未知层数不伪造层，单层无重复背页。

### G 看板与通用回归

- [ ] G01 进入模型页时“GPU 硬件”排在左侧并默认选中，“模型推理”在右侧；鼠标和方向键/Home/End 切换与焦点一致，两张看板数据显示正常。
- [ ] G02 软件启动后其他页面停留的数据仍能在 GPU 看板看到，0.5/1/2/5 秒及最近 1/2/5 分钟可选，切换看板不丢失趋势范围内数据或显示旧请求结果。
- [ ] R01 主窗口及划词的翻译、长文进度、取消/续译、历史保存与模型启停继续正常，普通界面文案减少多余分隔符后仍清晰可读。

### E 第三方接口（沿用 beta.8 待验收项，使用时检查）

- [ ] E01 独立 LAT_API_KEY 可翻译和列出模型，错误或缺失密钥拒绝；第三方不能关闭模型、改目录或关网关，不同密钥不能取消/续译彼此的任务，Origin 白名单按实际配置生效。
- [ ] E02 OpenAI 流式长文在每段通过校验后增量出现，不泄漏 prompt；请求 usage 时获得真实调用汇总，缺失统计不冒充零，断开连接取消对应请求。
- [ ] E03 超出等待容量返回 translation_busy，排队超时返回 translation_queue_timeout，已有分段可继续；被拒绝请求不影响其他正在执行或等待的任务。

## 性能与反馈

本轮主要调整桌面导出与前端呈现，不以自动测试推断实际推理提速。真实桌面视觉与交互由用户验收；不使用的第三方接口或硬件场景可填写“不适用”及原因。

| 项目 ID | 通过 / 失败 / 不适用 | 复现步骤、实际表现与预期 | 模型、输入规模或环境 |
| --- | --- | --- | --- |
| 待用户填写 |  |  |  |

人工验收结论：待填写。本轮开发没有操控桌面或浏览器，也没有自动安装、启动 LAT 界面或加载真实模型。2026-11-11 用户要求创建 PR 并准备 beta.9 Release，按此准备分支推送、面向 master 的 PR 及附带安装包和校验文件的预发布草稿；当前 18 项复验状态保持原样，PR 合并和公开发布另行处理。

## 历史附录

<a id="archive-beta8-feedback"></a>

<details>
<summary>0.2.1-beta.8 验收结果与七条反馈（2026-10-27 原文）</summary>

<!-- preserved-beta8-feedback sha256:cf9737498e44ca3144eb39aef6495e23161db7727f77f89401d2be64b006e978 -->

# LAT 统一验收清单

当前验收版本：`0.2.1-beta.8`。本地分支：`codex/architecture-stack-beta8`。安装包：`artifacts/v0.2.1-beta.8/LAT_0.2.1-beta.8_x64-setup.exe`，同目录提供 `SHA256SUMS.txt`。安装前通过托盘“退出”结束旧 LAT，沿用本地模型、设置和历史。开发与构建记录见 [beta.8 发布说明](../releases/v0.2.1-beta.8.md)。

这是前三轮和既有功能的唯一验收入口。请只更新下方“当前版本验收”及反馈表；本版项目尚未由用户勾选。原六份清单的 95 个已勾选项、85 个未勾选项、反馈、翻译样例与开发记录原样保留在本文件历史附录，不表示这些项目已在 beta.8 复验。附录中的旧版流程与参数只代表当时状态，当前行为以下方清单和最新设计为准，例如长文与划词现为分段排队而非立即返回忙碌，模型架构总览现为单层堆叠页。

beta.8 重点验收 A 组的堆叠视图、层编号选择与导航恢复，再完成尚未确认的其他项目。未使用第三方 API、外部网关或特定硬件的项目，可在反馈表填写“不适用”及原因。没有真实测速数据时不推断提速比例。完整公式样例见 [latex-sample.txt](latex-sample.txt)，旧长文与 prompt 回显样例也保留在历史附录。

## 当前版本验收

### I · 安装升级

- [x] I01 安装包版本为 0.2.1-beta.8，校验值与 SHA256SUMS.txt 一致；安装后正常启动并识别已有数据目录、模型与设置。
- [x] I02 首次进入历史页时旧记录的原文、译文、来源、时间与模型完整；升级建立摘要不会自动清空或裁剪既有超限记录，重启后仍能读取。
- [x] I03 未下载模型、未启用模型与网关断联状态提示正确；查看历史、设置或架构不自动启动模型。

### H · 历史检索、容量与恢复

- [x] H01 准备多于 20 条记录，每页最多显示 20 条短摘要，按时间倒序；连续翻页无重复或遗漏，最后一页无多余下一页。
- [x] H02 含 16,000 字符以上长文时，未展开卡片只显示摘要；展开可以看到全文，同时只保留一条展开内容，收起、换页或筛选后全文面板关闭。
- [x] H03 原文和译文面板等高，中文译英文与英文译中文卡片布局一致；长标题、长链接或公式不会撑出横向滚动，内容与页面滚动条保留间距。
- [x] H04 关键词可以命中原文、提交文本或译文末尾；连续输入、修改和清除关键词后只显示最后一次搜索结果，不回跳至旧结果。
- [x] H05 原文语言、译文语言、模型与工作区/划词来源可以组合筛选；无匹配时有空状态，“清除筛选”恢复列表与第一页。
- [x] H06 JSON 和 Markdown 导出包含当前筛选下所有完整记录，超过一页也不遗漏；多语言、换行、反引号、公式和 Markdown 链接完整，不局限于摘要。
- [x] H07 恢复记录后工作区的原文、语言和译文正确；翻译或模型切换期间恢复/删除/清空受保护，任务结束后恢复操作。
- [x] H08 设置可选 10/30/50/100/200 条及 16/32/64/128 MiB，默认 30 条和 64 MiB；缩减前出现确认，取消不修改设置，连续修改后最终选择生效并持久保存。
- [x] H09 达到任一上限后，下一次成功保存或主动调整上限按时间淘汰最旧完整记录；显示的“内容容量”是完整记录 JSON 的 UTF-8 字节数，超限旧库首次打开只提示、不立即删除。
- [x] H10 如自然遇到存储失败，已完成译文保留并能重试；继续翻译其他内容不会覆盖旧失败记录，成功补存不会产生重复历史。超大单条被拒绝时原有记录保持完整。
- [x] H11 划词历史标记正确，完整成功结果仅保存一条；同一保存请求失败后重发可以成功，暂停保存新记录不影响已有历史浏览。
- [x] H12 全局右上角仅显示一个“清空历史”入口，使用红色危险按钮；取消确认保留记录，确认后列表和统计同步清空，没有重复页面标题。

### A · 单层堆叠与架构浏览连续性

- [x] A01 在任意层进入 Attention 或 FFN，选择张量、参数视图和教学步骤并滚动，切到其他页面再返回后各项恢复；动画保持暂停，主动播放后继续。
- [x] A02 通过层编号选择第一层和最后一层，Embedding、Output、层详情及面包屑返回均可正常使用；返回总览保留所选层，快速连续操作无抽书等待或错误层跳转。
- [x] A03 在同一窗口会话切换已安装模型后，模型各自的浏览位置隔离；结构改变或失效参数回到有效默认状态，未沿用旧张量、维度或词表。
- [x] A04 参数矩阵与张量列表可切换；Q/K/V、FFN、归一化展示本地 GGUF 存储形状，未知字段和截断数量明确，不把示意格子当作真实权重。
- [x] A05 窗口缩放或字体布局完成后，嵌入 → 堆叠页 → 输出路径，以及前页内主路和两条残差仍连接到正确节点；动画高亮切换不造成连线跳动。
- [x] A06 模型架构只在外层显示一个主标题，内部保留模型标识和路径；900/1320 像素宽及较矮窗口中所有内容可滚至末尾，无内部重复页面滚动条。
- [x] A07 离开架构页、隐藏窗口、断联网关或开启减少动态效果时按既有规则停止动画；返回后不会同时运行多个动画或保留隐藏页面轮询。
- [x] A08 32 层等重复结构合并为一张堆叠页，前页只出现一层的完整计算路径，背页仅作装饰，层数标记准确；不再铺开重复的书脊或整层架构。
- [x] A09 总览切换层编号只更新前页，直接点击 Attention/FFN 和进入参数详情使用同一所选层；张量名称、形状和层号对应，切页返回保留该选择。
- [x] A10 按实际可用模型检查：只有一层时无重复背页，层数未知时明确提示且不伪造第一层；键盘能操作层选择和各子页入口，装饰页不会成为额外焦点。

### U · 通用控件与布局

- [x] U01 模型推理/GPU 硬件选项卡支持鼠标、左右方向键、Home/End，焦点与选中面板一致；切换后数据显示正确。
- [x] U02 历史、架构与看板的错误提示、加载提示和空状态样式统一，错误后的重试可用；减少动态效果开关圆心与胶囊对齐。
- [x] U03 明暗主题、语言选择、文本交换、左右/上下排版和模型启停过渡正常；出现或消失页面滚动条时内容不横向跳动。

### R · 第一轮稳定性、会话与退出

- [x] R01 冷启动、连续点击启用、正常关闭并重启模型均正常，同一时刻只保留一个 LAT 模型实例；关闭后显存释放。
- [x] R02 按本机安装情况分别使用 1.8B Q8_0 和 7B Q6_K；界面、译文和看板模型一致，加载失败后可恢复操作并重试。
- [x] R03 运行或排队期间，关闭/切换模型及修改模型目录等冲突操作受保护；完成或取消后恢复，不出现永久忙碌。
- [x] R04 等待首段、生成期间及排队期间均可取消；已完成分段保留，继续翻译后正文不重复，最终只保存完整结果。
- [x] R05 取消后提交新任务，旧输出不覆盖新内容；网关异常断联时原文和已显示译文保留，恢复后可重新翻译，失效断点明确提示。
- [x] R06 普通桌面启动自动使用会话凭据，主窗口、划词、看板无反复 401；不同实例或不兼容网关占用端口时明确报错。
- [x] R07 关闭到托盘保留模型；托盘“退出”或加载模型过程中退出，LAT 自有 gateway 与 llama-server 最终停止，不残留等待任务。
- [x] R08 如复用手动启动的外部网关：相同管理密钥可连接，退出桌面不关闭外部网关；不同管理密钥不能误连或误关。

### P · 第二轮调度、长文与输出质量

- [x] P01 主窗口翻译至少 16,000 字符长文时触发划词，浮窗显示排队位置，当前分段通过校验后获得执行机会，长文随后继续。
- [x] P02 连续触发短句划词时长文仍继续完成新段；划词翻译中主窗口仍可提交等待任务；取消浮窗仅取消自己的请求。
- [x] P03 16,000 字符以上和接近 100,000 字符输入可编辑、滚动、切页及取消，字符统计正确；后台继续翻译后返回的进度和已完成段完整。
- [x] P04 Markdown 标题、加粗、链接、代码块和段落完整，译文没有 prompt、源文本边界或“[结束源文本]”等内部标识；旧文档中的 XMMSE 样例在 1.8B Q8_0 上复验。
- [x] P05 包含公式的长文可以完成、取消和续译，不再因分段丢失格式而误报“流式模型输出未通过结果校验”；发生真实质量失败时有可理解提示且可重试。
- [x] P06 LaTeX 中 `\in`、`\|`、`\boldsymbol` 与行内/独立公式正确；长预览显示范围提示，不残留半个公式，“文本”、复制、导出与历史仍保留完整正文。

### G · GPU 与推理看板

- [x] G01 软件启动后先停留其他页面至少一分钟，再进入 GPU 页能看到此前趋势；切页、隐藏窗口和关闭模型期间继续采集，退出后重开为新会话。
- [x] G02 0.5/1/2/5 秒刷新及最近 1/2/5 分钟范围可选；切换范围数据连续，五分钟外数据正常滚出，横轴时间文字无负号。
- [x] G03 显卡型号右侧显示实际刷新周期、更新时间与最近范围，显存、利用率、温度和功率图表清晰；缺失指标显示未知，不以零冒充测量。
- [x] G04 如自然发生 NVML 兼容回退，界面显示实际两秒或五秒周期，无频繁控制台弹出；切换模型推理/GPU 不出现重复数据或旧会话残影。
- [x] G05 空闲时不伪造 token 和速度；主窗口及划词调用共享指标，首 token 延迟、输入/生成速度、token 与耗时可与本地模型日志对应。
- [x] G06 分段、质量重试与续译按实际调用累计，缓存段不重复计费；取消、错误或断联后不永久显示生成中，未知/部分统计明确，重启网关后会话累计清空。

### S · 划词与桌面回归

- [x] S01 Chrome/Edge 网页和可选文本 PDF 划选后浮标出现，首次点击即可翻译；日常鼠标移动、拖动和选择无明显延迟。
- [x] S02 单击清除选择、右键、滚动、输入或快速重新划选后，旧浮标和迟到取词结果不误触发；密码区域及自身窗口按既有排除规则处理。
- [x] S03 默认 Ctrl+Alt+T 与自定义快捷键正常，冲突时保留原配置；关闭划词或托盘暂停后停止监听，恢复后可用。
- [x] S04 UIA 取词优先；允许复制兜底时仅主动触发后执行，原剪贴板可安全恢复；不支持的控件显示手动粘贴入口，不持续监听剪贴板。
- [x] S05 无选区、模型未启用、超过 5,000 Unicode 字符及扫描 PDF/图片均有正确提示；过长内容可以完整转入主窗口，不自动加载模型或截断原文。
- [x] S06 浮窗目标语言记忆、复制、LaTeX、关闭与转入主窗口可用；替换非空工作区前确认，取消后保留原内容。
- [x] S07 固定浮窗后移动和调整大小，再次跨程序/显示器划词仍保留位置和尺寸；取消固定恢复跟随选区且不越界，标题区域拖动及系统圆角正常。
- [x] S08 关闭到托盘、单实例唤回与真正退出均正常；多显示器、缩放比例或管理员软件按实际使用情况记录兼容性，失败不会卡住主窗口。

### E · 第三方接口（使用时验收）

- [ ] E01 独立 LAT_API_KEY 可翻译和列出模型，错误或缺失密钥拒绝；第三方不能关闭模型、改目录或关网关，不同密钥不能取消/续译彼此的任务，Origin 白名单按实际配置生效。
- [ ] E02 OpenAI 流式长文在每段通过校验后增量出现，不泄漏 prompt；请求 usage 时获得真实调用汇总，缺失统计不冒充零，断开连接取消对应请求。
- [ ] E03 超出等待容量返回 translation_busy，排队超时返回 translation_queue_timeout，已有分段可继续；被拒绝请求不影响其他正在执行或等待的任务。

## 性能与反馈

使用同一个模型、相同文本、默认 f16 KV 和相同采样设置，先预热一次，再做三次记录中位数。没有前版对照时只填写当前数据，不推断提速比例。历史页重点记录条数、内容容量与展开响应；架构页重点记录切页恢复与动画流畅度。

| 版本 / 模型 | 原文字符数 | 划词等待当前分段 | 首个已校验译文 | 整篇耗时 | 输入 / 生成 tokens/s | 显存峰值 |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| 前版（如有） |  |  |  |  |  |  |
| beta.8 |  |  |  |  |  |  |

| 项目 ID | 通过 / 失败 / 不适用 | 复现步骤、实际表现与预期 | 模型、输入规模或环境 |
| --- | --- | --- | --- |
| 待用户填写 |  |  |  |

人工验收结论：待填写。开发自动测试与安装包校验详见发布说明，不代替这里的实际桌面验收；本轮未操控桌面、未自动安装或启动 LAT、未加载真实模型测速。推送 GitHub、PR 和预发布仍等待用户明确指令。

1. 搜索框高亮边框左侧被截断
2. 导出 markdown 和 json 按钮点击无反应, 未知导出文件的位置
3. 模型架构页面如果需要使用数学公式请用 LaTeX 渲染
4. 尽量减少符号 `·` `→` 的使用, 可以用括号 `()` 或者逗号 `,` 代替
5. 指向右上角的打开箭头太大了, 要么直接删除, 要么重新设计一个更协调的箭头, 需要和其它位置的箭头标识统一
6. 目前模型架构展示的较为混乱, 排版不是很整齐, 这个界面需要重新进行系统规划并重新设计, 尽量采用丰富的动画展示模型架构而非当前类似幻灯片的形式播放一遍推理流程, 一些重复的内容可以简写, 例如如果 32 层都是相同的则不需要做 32 个选项可以分别查看对应的架构
7. 模型推理/GPU 硬件选项卡交换, 默认显示 GPU 硬件


</details>


以下是六份原清单的完整正文，保留原有勾选、反馈、样例、版本和开发结论。原文件路径仅作兼容跳转，不再维护另一套勾选；历史未完成项已按当前功能合并进上方验收。每个归档块的正文与合并前源文件相同，仅统一存储换行符以适配仓库文本格式。

<a id="archive-ui-longtext"></a>

<details>
<summary>毛玻璃、长文与 0.2.0-beta.3 · 历史原文</summary>

<!-- preserved-source:lat-ui-longtext-checklist.md sha256:f068d63ca9c6ad9b024fe85900bc1ce70d3592783bc34c9c8fa0e1bc8dc2af1a -->

# LAT 毛玻璃界面与长文本翻译验收

> 最新验收版本：`0.2.0-beta.3`。安装包：`artifacts/v0.2.0-beta.3/LAT_0.2.0-beta.3_x64-setup.exe`。用户已确认 beta2 全项通过，勾选与反馈保留；beta3 待验收项目见文末。

状态：等待用户验收。以下复选框由用户填写；自动化通过不代替桌面视觉和译文质量验收。

## 验收准备

- 分支：`codex/lat-ui-longtext-stability`，由本地 `master` 创建。
- 版本维持 `0.2.0-beta.1`，此包是本地验收构建，不是 GitHub 发布版本。
- 安装包：`artifacts/v0.2.0-beta.1/LAT_0.2.0-beta.1_x64-setup.exe`。
- 校验文件：同目录 `SHA256SUMS.txt`。安装前请退出旧版 LAT，避免仍连接旧网关。
- 不需要重新下载已有模型；建议使用 Hy-MT2-7B Q6_K 验收。
- 公式样例：本目录 `latex-sample.txt`，包含截图中的公式及额外保护样例。
- 长文样例：`artifacts/validation/long-source.txt`（16,001 字符）、`long-paragraph-source.txt`（17,001 字符单段）、`long-32001-source.txt`（32,001 字符）。
- 当前工作区内容在切换页面、关闭/重新启用模型时保留；退出应用后仅完整翻译历史持久化，不自动恢复未完成草稿。

## Bug 修复

- [x] 在原文中粘贴 `latex-sample.txt`，切换 LaTeX 预览：成员符号 `\in`、范数 `\|`、`\boldsymbol` 正常显示。
- [x] 展示公式保留双美元定界符，编号、上下标和求和结构正确；切换“合并换行”后再次翻译仍正常。
- [x] 中英文互译时所有原始公式保留，顺序正确，无公式丢失或重复；复制文本无意外变更。
- [x] 断网后仍能预览公式；公式过宽时只在预览区域横向滚动。
- [x] 普通译文不带内部 `[结束源文本]` 等标识。样例正文明确写出的该标识应保留，这是正常行为。
- [x] 正常长文不再无故报“流式模型输出未通过结果校验”；真实错误应说明失败段和原因，不能误报成功。

真实长文示例 (example 1)：

```markdown
# Local Curvature Correction for XMMSE on a Quotient Space

## 1. Main results

This is the **main report** for the combined post-XMMSE and quotient-curvature study. Read it first. The [structural supplement](Post_XMMSE_MM_Research.md) retains the residual interpretation, Chord construction, scalar limits, and historical solver details; the [Gaussian numerical supplement](Gaussian_Channel_Linear_Convergence_Audit.md) documents all 400 baseline trajectories. Detailed [rate and MM proofs](../_raw/Quotient_Rates_and_MM_Proofs.md) and [curvature numerical details](../_raw/Quotient_Curvature_Numerical_Details.md) support the statements below.

The main conclusions are:

| Question | Result and qualification |
|---|---|
| Must WSR be locally concave? | Ambient concavity is unnecessary. A nondegenerate constrained local maximum implies local contraction after removing the nonzero phase directions. Arbitrary KKT points do not suffice. |
| Can both methods be sublinear? | Yes. An explicit orthogonal two-user channel at an allocation threshold gives a quartically flat maximum and amplitude error proportional to $t^{-1/2}$ for both methods. |
| Can their rate gap be quantified? | At a common regular maximum, the WMMSE-to-XMMSE envelope curvature reduction has rank at most $K$. A generalized eigenvalue formula gives the exact factor difference and a necessary and sufficient condition for strict improvement. |
| What does the XMMSE linearization represent? | It is the derivative of the actual power-constrained XMMSE update modulo phases, not a new algorithm that only reduces to XMMSE. |
| Is a cubic subproblem essential? | No. Cubic regularization certifies the Taylor remainder; a radius-dependent quadratic regularizer also gives a valid MM model and can retain local quadratic convergence. |
| Is the envelope a tighter quadratic? | The exact phase envelope is tighter but nonquadratic and gives the same optimal update orbit. Its Taylor quadratic alone is not a certified lower bound. |

For MISO-BC, the quotient curvature gap of XMMSE factors exactly as the Gram matrix of a matrix with at most $2K$ rows. Its rank is controlled by the number of users, independently of the number of transmit antennas. Local curvature correction therefore becomes a low-rank update problem.

Building on the [Post-XMMSE research report](Post_XMMSE_MM_Research.md), this report establishes four results.[^5]

1. A globally valid, phase-invariant XMMSE envelope. Eliminating phase alone preserves the equivalence class of the exact update.
2. An explicit factorization $\mathbf D=\mathbf R^{\mathsf T}\mathbf R$, with $\operatorname{rank}\mathbf D\le2K$, using user-level $2\times2$ coefficients.
3. At a regular fixed point, correcting the largest normalized gap modes minimizes the local spectral radius within a prescribed rank budget and PSD correction class.
4. Computable Hessian Lipschitz bounds for the exact log-quadratic pullback, yielding certified cubic MM and a small numerical prototype.

On six full-support, nearly orthogonal channels, baseline XMMSE requires 8-10 steps to reach the common KKT tolerance; the full-gap hybrid requires 4-7. These samples and millisecond timings do not establish general wall-clock acceleration. Dense horizontal bases and linear algebra remain prototype bottlenecks.

These are internal analytic derivations and finite numerical checks, without a claim of literature priority. Riemannian Newton methods, quotient optimization, and cubic regularization are established tools; the focus here is the XMMSE-specific gap and its computable certificate.[^1][^2][^3]

## 2. Problem, quotient, and notation

Consider

$$
f(\mathbf V)=\sum_{k=1}^K w_k\log\left(1+
\frac{|\mathbf h_k^{\mathsf H}\mathbf v_k|^2}
{\sigma^2+\sum_{j\ne k}|\mathbf h_k^{\mathsf H}\mathbf v_j|^2}\right),
\qquad \sum_k\|\mathbf v_k\|^2\le P.
\tag{1}
$$

Assume $w_k>0$ and $\sigma>0$. Mathematical beamformers are columns of $\mathbf V$; code stores them by row. The real vector $\mathbf v$ concatenates real and imaginary parts, has dimension $n=2KN_t$, and uses the real Frobenius inner product.

On the regular full-power region with every $\mathbf v_k\ne\mathbf0$, define

$$
\mathcal M=\{\mathbf v:\|\mathbf v\|^2=P,\ \mathbf v_k\ne\mathbf0\},
\qquad
\mathcal Q=\mathcal M/\mathbb T^K.
$$

$\mathbb T^K$ denotes independent user phases. Vertical directions are generated by $i\mathbf v_k$ in the corresponding beam block. The Euclidean horizontal space is

$$
\mathcal H_{\mathbf v}=
\left\{\boldsymbol{\xi}:
\Re\sum_k\mathbf v_k^{\mathsf H}\boldsymbol{\xi}_k=0,
\quad\Im(\mathbf v_k^{\mathsf H}\boldsymbol{\xi}_k)=0\ \forall k\right\}.
\tag{2}
$$

Let $\mathbf Z\in\mathbb R^{n\times d}$ be an orthonormal real basis, $d=2KN_t-K-1$. Horizontal displacements are $\mathbf Z\mathbf s$, $\mathbf s\in\mathbb R^d$. Latin matrices and vectors use $\mathbf A,\mathbf v$; Greek matrices and vectors use $\boldsymbol{\Lambda},\boldsymbol{\xi}$. Scalars such as $\mu,\sigma,\lambda_i$ are unbolded.

The envelope factorization and accelerator below use full support and nonzero desired signals. Their formulas must not be applied through a support change. For the baseline local-rate theorem, a separate smooth slice removes only the phases of nonzero beams and retains every inactive beam perturbation; see Section 5.4. Do not invert a singular phase basis or infer stability just by discarding inactive users.

## 3. Exact phase envelope

At reference $\underline{\mathbf V}$, write the XMMSE model as

$$
Q_{\mathrm X}(\mathbf V\mid\underline{\mathbf V})
=c_0+\sum_k\left[
-\mathbf v_k^{\mathsf H}\mathbf A_k\mathbf v_k
+2\Re(\mathbf B_k^{\mathsf H}\mathbf v_k)\right].
$$

Define

$$
\boxed{
\widehat Q_{\mathrm X}([\mathbf V]\mid[\underline{\mathbf V}])
=c_0+\sum_k\left[
-\mathbf v_k^{\mathsf H}\mathbf A_k\mathbf v_k
+2|\mathbf B_k^{\mathsf H}\mathbf v_k|\right].}
\tag{3}
$$

**Proposition 1.** Equation (3) is a global minorant of the objective, is well-defined on phase classes of both arguments, and has first-order contact whenever every desired signal at the reference is nonzero.

**Proof.** For every phase vector $\boldsymbol{\theta}$, $Q_{\mathrm X}(\{e^{i\theta_k}\mathbf v_k\}\mid\underline{\mathbf V})\le f(\mathbf V)$. Maximizing each phase replaces the linear term by its modulus. Changing reference phases rotates $\mathbf B_k$ and leaves $\mathbf A_k$ unchanged. Since $\mathbf B_k^{\mathsf H}\underline{\mathbf v}_k>0$, the maximizing phase is zero at the reference; the smooth envelope has value and gradient contact.

**Limitation.** Phase elimination alone cannot accelerate exact MM. Phase invariance of the feasible set gives

$$
\max_{\mathbf V\in\mathcal C}\widehat Q_{\mathrm X}(\mathbf V)
=\max_{\mathbf V\in\mathcal C}\max_{\boldsymbol{\theta}}
Q_{\mathrm X}(\{e^{i\theta_k}\mathbf v_k\})
=\max_{\mathbf V\in\mathcal C}Q_{\mathrm X}(\mathbf V).
\tag{4}
$$

Every envelope maximizer can be rotated into a maximizer of the original quadratic. The envelope identifies the appropriate curvature but is not a separate acceleration algorithm.

## 4. Exact quotient curvature at a general reference

### 4.1 Retraction and Lagrangian curvature

At a full-power point $\mathbf v$, use

$$
\mathcal R_{\mathbf v}(\mathbf s)
=\sqrt{\frac P{P+\|\mathbf s\|^2}}
(\mathbf v+\mathbf Z\mathbf s).
\tag{5}
$$

Equation (5) preserves full power for all finite arguments and defines a local quotient section near the origin. Set

$$
\mathcal F(\mathbf s)=f(\mathcal R_{\mathbf v}(\mathbf s)),
\quad\mathbf g_q=\nabla\mathcal F(\mathbf0),
\quad\mathbf H_q=-\nabla^2\mathcal F(\mathbf0).
$$

Use the complex half-gradient $df[\boldsymbol{\xi}]=2\Re\langle\mathbf g,\boldsymbol{\xi}\rangle$, retaining $\mathbf g$ for its real representation. With $\lambda=\langle\mathbf v,\mathbf g\rangle/P$,

$$
\mathbf g_q=2\mathbf Z^{\mathsf T}\mathbf g,
\qquad
\boxed{\mathbf H_q=2\lambda\mathbf I-2\mathbf Z^{\mathsf T}(\mathrm D\mathbf g)\mathbf Z.}
\tag{6}
$$

Here $\lambda$ is the current radial gradient coefficient; it equals the optimal multiplier only at a KKT point. Equation (6) includes the second derivative of the retraction. Simply compressing the Euclidean Hessian is insufficient.

### 4.2 Explicit envelope curvature

Let $\mathbf A=\operatorname{blkdiag}(\mathbf A_k)$ denote the corresponding real symmetric operator. Define

$$
\gamma_k=\Re(\mathbf B_k^{\mathsf H}\mathbf v_k)>0,
\qquad
\mathbf c_k^{\mathsf T}\mathbf s=
\Im[\mathbf B_k^{\mathsf H}(\mathbf Z\mathbf s)_k].
$$

The negative Hessian of the envelope pullback is

$$
\boxed{
\mathbf S_q
=2\mathbf Z^{\mathsf T}\mathbf A\mathbf Z+2\lambda\mathbf I
-2\sum_k\frac{\mathbf c_k\mathbf c_k^{\mathsf T}}{\gamma_k}.}
\tag{7}
$$

The second derivative of $2|\gamma_k+t z|$ at zero is $2(\Im z)^2/\gamma_k$. Adding the quadratic and retraction terms proves (7), including at nonstationary references.

At a regular fixed point, (7) equals the phase Schur complement of $\mathbf A+\mu\mathbf I$ from the preceding report, up to the factor two between real Hessians and complex half-gradients. That fixed-point identity cannot generally be applied away from stationarity.

## 5. The curvature gap has rank at most $2K$

### 5.1 User-level $2\times2$ gap matrix

Use the noise-normalized statistics

$$
p_k=\frac{|\mathbf h_k^{\mathsf H}\mathbf v_k|}{\sigma}>0,
\qquad
y_k=1+\sum_{j\ne k}\frac{|\mathbf h_k^{\mathsf H}\mathbf v_j|^2}{\sigma^2}.
$$

Suppress the user index temporarily. The phase-envelope user model is

$$
\widehat q(p',y')=-a(p')^2+2bp'-cy',
$$

Here $a=[\log(1+p^2/y)-p^2/(y+p^2)]/p^2$, $b=\log(1+p^2/y)/p$, and $c=p^2/[y(y+p^2)]$. The user gap Hessian with respect to $(p\prime,y\prime)$ is

$$
\boxed{
\mathbf T_k=
\begin{bmatrix}
2a_k+\dfrac{2(y_k-p_k^2)}{(y_k+p_k^2)^2}
&-\dfrac{2p_k}{(y_k+p_k^2)^2}\\[5pt]
-\dfrac{2p_k}{(y_k+p_k^2)^2}
&\dfrac1{y_k^2}-\dfrac1{(y_k+p_k^2)^2}
\end{bmatrix}\succeq\mathbf0.}
\tag{8}
$$

This matrix is PSD because the nonnegative gap has a zero minimum at the reference. Its principal minors provide an equivalent direct check; finite sampling is not needed for this conclusion.

For $\boldsymbol{\xi}=\mathbf Z\mathbf s$, define $\mathbf J_k\in\mathbb R^{2\times d}$ by

$$
\mathbf J_k\mathbf s=
\begin{bmatrix}
\sigma^{-1}\Re[e^{-i\phi_k}\mathbf h_k^{\mathsf H}\boldsymbol{\xi}_k]\\[2pt]
2\sigma^{-2}\Re\sum_{j\ne k}
(\mathbf h_k^{\mathsf H}\mathbf v_j)^*
\mathbf h_k^{\mathsf H}\boldsymbol{\xi}_j
\end{bmatrix},
\quad\phi_k=\arg(\mathbf h_k^{\mathsf H}\mathbf v_k).
\tag{9}
$$

### 5.2 Theorem 2: low-rank Gram factorization

At every regular reference described above,

$$
\boxed{
\mathbf D_q:=\mathbf S_q-\mathbf H_q
=\sum_k w_k\mathbf J_k^{\mathsf T}\mathbf T_k\mathbf J_k
=\mathbf R^{\mathsf T}\mathbf R,}
\tag{10}
$$

A valid factor is

$$
\mathbf R=\begin{bmatrix}
\sqrt{w_1}\mathbf T_1^{1/2}\mathbf J_1\\
\vdots\\
\sqrt{w_K}\mathbf T_K^{1/2}\mathbf J_K
\end{bmatrix}\in\mathbb R^{2K\times d}.
$$

Thus $\operatorname{rank}\mathbf D_q\le\min(2K,d)$.

**Proof.** The total gap is a weighted sum of user gaps, each with zero value and gradient at the reference. In the second-order chain rule, every second derivative of the statistics map is multiplied by a zero gap gradient. Only the Jacobian-Hessian-Jacobian terms remain. Taking PSD square roots gives the Gram factorization.

No general $d\times d$ gap matrix needs to be formed, factored, or inverted. The earlier report's certificate involving $\mathbf D_q^{-1}$ is usually unavailable because this gap is highly singular.

### 5.3 Implications for local XMMSE dynamics

Let $T_{\mathrm X}(\mathbf V)$ denote the **actual exact XMMSE update**: form its quadratic coefficients at $\mathbf V$, solve the power-constrained QCQP, and regard the output modulo independent user phases. It obeys

$$
(\mathbf A_{\mathrm X,k}(\mathbf V)+\mu^+(\mathbf V)\mathbf I)
(\mathbf v_k^+-\mathbf v_k)
=\mathbf g_k(\mathbf V)-\mu^+(\mathbf V)\mathbf v_k.
\tag{11a}
$$

At a fixed point, the right-hand side is zero. Differentiating (11a) cancels the derivatives of the surrogate coefficient multiplying the zero displacement. Differentiating the active power equality removes the normal direction; eliminating free output phases produces the Schur complement, which equals $\mathbf S_q$ in (7) at stationarity. Thus, at a regular fixed point with full support, positive multiplier, and $\mathbf H_q\succ\mathbf0$,

$$
\boxed{
\mathbf J_{\mathrm X,q}
=\mathbf I-\mathbf S_q^{-1}\mathbf H_q
=\mathbf S_q^{-1}\mathbf R^{\mathsf T}\mathbf R.}
\tag{11}
$$

This is the Jacobian of $T_{\mathrm X}$ itself. In fixed local quotient coordinates, $\mathbf e_{t+1}=\mathbf J_{\mathrm X,q}\mathbf e_t+O(\|\mathbf e_t\|^2)$. No extra linearized subproblem is being substituted into XMMSE. A zero-correction cubic method shares this first derivative under bounded regularization and an inactive radius, but its finite steps generally differ from XMMSE. Exact maximization of the phase envelope, by contrast, gives exactly the same update orbit by (4).

The quotient Jacobian has rank at most $2K$. At least $\max\{d-2K,0\}$ eigenvalues vanish; only at most $2K$ normalized gap modes govern the linear convergence bottleneck. Its spectral radius is the largest eigenvalue of $\mathbf R\mathbf S_q^{-1}\mathbf R^{\mathsf T}$. A value close to one means the minorant has nearly as much excess curvature as total effective curvature in a slow direction. The purpose of the correction is to remove those modes.

This does not imply finite termination: higher-order coupling can regenerate errors in zero-eigenvalue modes. Support changes, degenerate fixed points, and arbitrary inexact implementations are not covered.

### 5.4 Complete local-rate theorem and what replaces concavity

**Theorem 2A (both exact baseline maps).** Suppose a nonzero-rate KKT point is a constrained local maximum modulo its active phases and has no zero constrained-Hessian directions beyond those phase directions. Equivalently, require second-order stationarity and nonsingularity after phase removal. Then both exact WMMSE and XMMSE converge locally at least linearly from sufficiently close sphere points. Ambient WSR concavity is not assumed. On a smooth slice with orthonormal tangent basis $\mathbf Z$ and active-phase basis $\mathbf F$, set

$$
\begin{aligned}
\mathbf M_j&=\mathbf A_j+\mu_\star\mathbf I,\\
\mathbf H&=2\mathbf Z^{\mathsf T}(\mu_\star\mathbf I-\mathrm D\mathbf g)\mathbf Z,\\
\mathbf S_j&=2[\mathbf Z^{\mathsf T}\mathbf M_j\mathbf Z-
\mathbf Z^{\mathsf T}\mathbf M_j\mathbf F
(\mathbf F^{\mathsf T}\mathbf M_j\mathbf F)^{-1}
\mathbf F^{\mathsf T}\mathbf M_j\mathbf Z],\\
\rho_j&=1-\lambda_{\min}(\mathbf H,\mathbf S_j)<1,
\qquad j\in\{\mathrm W,\mathrm X\}.
\end{aligned}
\tag{11b}
$$

The proof has four steps: positive noise gives a positive multiplier at a nonzero-rate KKT point; the bordered quadratic KKT system is nonsingular; constrained second-order necessity plus nondegeneracy gives $\mathbf H\succ\mathbf0$; and minorization gives $\mathbf H\preceq\mathbf S_j$. Therefore $\mathbf I-\mathbf S_j^{-1}\mathbf H$ is similar to a symmetric matrix with eigenvalues in $[0,1)$. Derivative continuity then proves contraction in a neighborhood, not merely an endpoint spectral calculation. See the [complete proof, including active-user slices](../_raw/Quotient_Rates_and_MM_Proofs.md#1-local-convergence-without-ambient-concavity).

For every $q\in(\rho_j,1)$, errors contract at most by $q$ in the fixed $\mathbf S_j$ coordinate norm sufficiently close to the solution. Other equivalent norms give R-linear bounds. Particular trajectories need not attain the worst spectral factor. When $\rho_j=0$, higher-order convergence is possible. Positive definite constrained curvature follows from the stated hypotheses; it is not implied by KKT conditions, full channel rank, or Gaussian sampling.

If some beams vanish, keep their real and imaginary perturbations and remove only nonzero phase generators. This proves a local slice result without asserting that the quotient by all user phases is smooth there. The full-support envelope and its $2K$ factorization still require their own assumptions.

### 5.5 A concrete obstruction to unconditional linear convergence

Arbitrary KKT points may be unstable. With two identical scalar channels, equal weights and fixed total power, equal power allocation is a KKT point but a strict minimum along the allocation direction.

More strongly, even a WSR maximum may be degenerate. Set $K=N_t=2$, unit noise and weights, $b=(1+P)^{-1}$,

$$
\mathbf h_1=(1,0)^{\mathsf T},\quad
\mathbf h_2=(0,\sqrt b)^{\mathsf T},\quad
\mathbf V(z)=\operatorname{diag}(\sqrt{P-z^2},z).
$$

Then

$$
f(\mathbf V(z))=\log(1+P)+\log(1-b^2z^4),
\qquad
z^+=z-2bz^3+O(z^5)
\quad\text{for both WMMSE and XMMSE}.
\tag{11c}
$$

The optimum $z=0$ has positive multiplier but zero curvature in the emerging-user direction. For small positive initialization, $z_t\sim(4bt)^{-1/2}$, the objective gap is order $t^{-2}$, and the KKT residual is order $t^{-3/2}$. These are genuinely sublinear iterates. The [full derivation](../_raw/Quotient_Rates_and_MM_Proofs.md#2-why-a-theorem-for-arbitrary-kkt-points-is-false) explains invariance of the diagonal family and the expansion of the exact multiplier for each method. This deliberately tuned example does not establish a positive probability of degeneracy under Gaussian channels.

There is also a sharp nearby limit: reduce the second channel power gain to $\kappa<b$. The single-user optimum becomes nondegenerate, yet both local factors equal $\kappa/b$, approaching one as $\kappa\uparrow b$. Therefore neither a uniform contraction margin nor a universal strict WMMSE/XMMSE gap holds across optima that include inactive users. Full-support strictness remains a separate question.

### 5.6 Quantifying the WMMSE-to-XMMSE rate improvement

At a common full-support regular maximum define $s_k=p_k^2/y_k$ and $\eta_k=[1-\log(1+s_k)/s_k]/y_k>0$. The exact envelope difference is

$$
\widehat Q_{\mathrm X}-\widehat Q_{\mathrm W}
=\sum_k w_k\eta_k(p'_k-p_k)^2.
$$

Consequently, if $\mathbf j_k^{\mathsf T}$ is the first row of (9),

$$
\boldsymbol\Delta:=\mathbf S_{\mathrm W}-\mathbf S_{\mathrm X}
=2\sum_k w_k\eta_k\mathbf j_k\mathbf j_k^{\mathsf T}\succeq\mathbf0,
\qquad\operatorname{rank}\boldsymbol\Delta\le K.
\tag{11d}
$$

Let $\alpha_{\mathrm W}=\lambda_{\min}(\mathbf H,\mathbf S_{\mathrm W})$ and $\mathbf N=\mathbf H-\alpha_{\mathrm W}\mathbf S_{\mathrm W}\succeq\mathbf0$. Then

$$
\boxed{\rho_{\mathrm W}-\rho_{\mathrm X}
=\lambda_{\min}\left(\mathbf S_{\mathrm X}^{-1/2}
[\mathbf N+\alpha_{\mathrm W}\boldsymbol\Delta]
\mathbf S_{\mathrm X}^{-1/2}\right)\ge0.}
\tag{11e}
$$

Strict improvement holds exactly when $\ker\mathbf N\cap\ker\boldsymbol\Delta=\{\mathbf0\}$: every vector in the slowest WMMSE eigenspace must be affected by the curvature reduction. This can hold even though $\boldsymbol\Delta$ is low rank. A computable lower bound is $\lambda_{\min}(\mathbf N+\alpha_{\mathrm W}\boldsymbol\Delta)/\lambda_{\max}(\mathbf S_{\mathrm X})$. See the [identity and strictness proof](../_raw/Quotient_Rates_and_MM_Proofs.md#3-exact-miso-rate-gap-certificate-at-a-common-regular-maximum).

For the checked orthogonal three-user optimum, $\rho_{\mathrm W}=0.5965934$, $\rho_{\mathrm X}=0.2114964$, the exact gap is $0.3850969$, and this lower bound is $0.1539470$. No universal positive gap follows: the criterion may fail, curvatures can become arbitrarily small, and methods may approach different solutions. Full strict H1 remains unproved.

## 6. Optimal local correction under a rank budget

### 6.1 A $2K\times2K$ eigenproblem

Where $\mathbf H_q\succ\mathbf0$, define

$$
\boxed{\mathbf C_q=\mathbf R\mathbf S_q^{-1}\mathbf R^{\mathsf T}.}
\tag{12}
$$

Its nonzero eigenvalues equal those of $\mathbf S_q^{-1/2}\mathbf D_q\mathbf S_q^{-1/2}$. Write

$$
\delta_1\ge\delta_2\ge\cdots\ge\delta_r>0,
\qquad r=\operatorname{rank}\mathbf D_q\le2K,
\quad\delta_1<1.
$$

The $\delta_i$ are scalar eigenvalues. Let $\mathbf U_m$ contain orthonormal eigenvectors for the largest $m$ eigenvalues of $\mathbf C_q$, and set

$$
\boxed{
\mathbf E_m=\mathbf R^{\mathsf T}\mathbf U_m\mathbf U_m^{\mathsf T}\mathbf R,
\qquad
\mathbf B_m=\mathbf S_q-\mathbf E_m.}
\tag{13}
$$

Since $\mathbf U_m\mathbf U_m^{\mathsf T}\preceq\mathbf I$,

$$
\mathbf0\preceq\mathbf E_m\preceq\mathbf D_q,
\qquad\mathbf H_q\preceq\mathbf B_m\preceq\mathbf S_q.
$$

The projection is placed between Gram factors. This supplies the PSD certificate, unlike the generally false assertion $\mathbf P\mathbf D_q\mathbf P\preceq\mathbf D_q$.

### 6.2 Theorem 3: optimal rank budget

At the same regular fixed point, omit terms of order three and higher and consider all corrections satisfying

$$
\mathbf B=\mathbf S_q-\mathbf E,
\quad \mathbf0\preceq\mathbf E\preceq\mathbf D_q,
\quad\operatorname{rank}\mathbf E\le m.
$$

The smallest attainable linearized spectral radius is

$$
\boxed{
\min_{\mathbf E}\rho(\mathbf I-\mathbf B^{-1}\mathbf H_q)
=\delta_{m+1},}
\tag{14}
$$

Use $\delta_{m+1}=0$ for $m\ge r$. Construction (13) attains this value.

See the [rank-budget optimality proof](proofs/Quotient_Local_Curvature_MM_Proofs.md#proof-1) for the detailed proof and retained equation numbering.


Correct the largest normalized curvature gaps, rather than the largest Euclidean curvatures or strongest users. Optimality holds locally within this PSD correction class, not over all nonconvex algorithms.

At a tied truncation eigenvalue, the selected subspace need not be unique. Differentiable-map arguments require a separated selected cluster or correction of the entire tied cluster.

### 6.3 High-accuracy local behavior

Full correction gives $\mathbf B_r=\mathbf H_q$. A bounded cubic regularizer contributes zero to the first-order update Jacobian at the fixed point. Local quadratic convergence follows under a Lipschitz Hessian, uniform positive definiteness on the quotient, sufficiently accurate subproblem solves, and eventual inactivity of the radius constraint.

Partial correction generally remains linearly convergent, with optimal factor $\delta_{m+1}$. Full correction uses at most $2K$ directions, rather than $d$.
```

返回结果: 第 78/119 段失败；已保留 77 段。原因: 流式模型输出未通过结果校验: ['protected_content_order']

## 长文本与进度

- [x] 分别翻译 16,001、17,001 单段和 32,001 字符样例，检查段落顺序、首尾内容和编号，无漏段、重复段或拼接残留。
- [x] 使用个人实际长文复测，包括中英混合、公式、URL 和代码块；确认译文质量可接受。
- [x] 界面显示已完成段数、原文处理百分比及估算实时速度；每段通过校验后即可看到译文。
- [x] 重试/细分时进度不倒退，最终成功时为 100%；总段数可能因细分增加。
- [x] 翻译中点“取消翻译”，停止继续提交分段，保留已完成译文，明确标记未完成；可以再次开始翻译。
- [x] 翻译期间不能交换内容、修改语言或关闭模型，但可查看设置和历史。
- [x] 默认上限 100,000 字符，超过上限有提示；后端自定义 `max_input_chars` 会反映在界面中。

1. 长文本出现 bug 无法完成第一项测试 (见 example 1)
2. 无法重试翻译，每次取消翻译再开始翻译进度会重新开始
3. 无法继续提交分段，会重新开始

## 历史与导航

- [x] 完整翻译后新增一条记录；取消/失败不会生成完整历史。
- [x] 重启后历史仍在；能展开完整内容、恢复到工作区、单条删除及确认后清空。
- [x] 超过 30 条时仅保留最新 30 条，不出现部分写入的记录。
- [x] 切换翻译、历史、模型、设置不丢失当前文本；关闭模型后仍可查看历史和设置。
- [x] 恢复历史不会自动启动推理，也不会在翻译中覆盖正在处理的内容。

## 毛玻璃与交互

- [x] 浅色/深色主题的侧栏、阅读面板和设置风格统一，正文对比度清晰。
- [x] 图标导航有悬停说明和键盘焦点，设置入口位于左侧。
- [x] 语言选择支持中英文搜索、方向键选择、Enter 确认、Esc 关闭；选择后正确返回工作区。
- [x] 空文本可交换语言；已有译文时交换语言及两侧文本；动画不过度干扰阅读。
- [x] 启用/关闭模型显示对应动画，结束时间跟随后端实际结果；重复点击不会启动多个请求。
- [x] 启停失败时能看到错误信息并重试；关闭成功后模型显存释放。
- [x] 900×640 最小窗口和较大窗口下，左右/上下布局均可操作。
- [x] 开启系统减少动态效果后，脉冲和过渡动画停止。

1. 设置中无法开启系统减少动态效果选项

交互还需要改善的地方有：
1. 历史记录和设置界面需要自适应当前页面的大小
2. 设置界面要求重新打造 UI 交互，开关换成胶囊形状，切换深色浅色和左右上下也做成大的圆角矩形胶囊形式，并放入图形化的太阳月亮，左右上下排版切换的图标

## 自动验证记录

- Python：43 项测试通过（包含分段无损重组、单段长文、截断细分、取消清理、请求互斥、公式顺序和输出校验）。
- 前端：5 组测试通过（历史 30 条事务淘汰；公式定界符；SSE 完成/错误/断流；离线 MathJax 字形；导航、语言搜索、取消和状态保留）。
- 版本同步、TypeScript、Vite 构建、Rust 格式检查、`cargo check`、`cargo test` 均通过。
- 已运行 `npm run build:installer`；生成的安装包、运行时资源及测试产物不提交。
- 打包后的 gateway 冒烟验证通过：健康检查、100,000 输入上限、长文分段规划以及未安装模型的明确错误。
- 本地安装包 SHA-256：`2dce4efe4e93e71a7e43d9e7cdc892cba7840d2f9b7134e9bac2e82810e9d251`。
- 前端测试使用 jsdom，无桌面自动操作；语言对话框原生顶层、焦点表现及最终视觉效果仍须人工验收。

## 实机性能记录

2026-09-16，本机 RTX 5070（12 GB），Hy-MT2-7B Q6_K，llama.cpp b10545，8,192 上下文。预热后在同一自建测试模型进程上顺序执行基线和当前实现；这是单次样例数据，不是统计基准。

| 样例 | 基线首个可见译文 | 当前首段可见 | 基线总耗时 | 当前总耗时 | 当前自动重试 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 426 字符 | 0.94 s | 0.88 s | 0.94 s | 0.88 s | 0 |
| 3,059 字符、7 段 | 7.10 s | 0.99 s | 7.10 s | 7.06 s | 0 |
| 16,001 字符 | 超出旧上限 | 0.96 s | 不支持 | 36.68 s | 0 |
| 32,001 字符 | 未运行 | 0.98 s | 不支持 | 74.19 s | 0 |
| 17,001 字符重复句单段 | 未运行 | 0.93 s | 不支持 | 1.75 s | 0 |
| 825 字符公式混合样例 | 未运行 | 0.52 s | 未运行 | 1.54 s | 0 |

主要收益是更早看到译文、长文可完成及局部重试；这些数据没有证明模型本身的 tokens/s 显著提升。重复段落仅在同一次请求中复用已校验结果；同一文档重复出现的段落仍会完整输出。重复单段样例的 1.75 秒主要来自请求内缓存，不可类推为普通长文的性能。

数据及译文在 `artifacts/validation/benchmark.json`、`benchmark-extended.json`、`benchmark-single-paragraph.json` 和同目录文本文件中（单段最终结果以最后一份 JSON 为准）。模型语义质量仍需人工检查，不能由格式校验保证绝对正确。

取消会立即停止界面请求，后端在下一次可写进度/模型输出时关闭上游连接；模型预填充阶段可能有短暂等待。失败段会自动重试/细分，最终失败后保留已完成译文；本版不提供跨应用重启的任务续传。

## 用户验收反馈

- 验收日期：
- 通过项目：
- 未通过项目及复现步骤：
- 截图/录屏（可选）：
- 是否同意推送并创建面向 master 的 PR：待用户确认。

验收确认前不推送、不创建或合并 GitHub PR。

## 第二轮修复与复验（2026-09-16）

本节记录对上述用户反馈的修改。原有勾选、问题描述和 example 1 全文均保留；以下项目仍由用户复验。

### 本轮修改

- 修正 `protected_content_order` 误判：行内公式允许跟随译文语序调整；公式内容、出现次数及展示公式/代码块顺序仍进行检查。
- 增加内存任务断点。取消或失败后点击“继续翻译”，只处理剩余分段；续传时以服务端已完成内容校准界面，避免断流造成重复拼接。“重新翻译”明确从头开始。
- 原文、语言或模型改变后不沿用旧断点。网关最多保留最近 8 个任务，闲置 1 小时后过期，退出应用后不保留未完成任务。
- 设置增加“减少动态效果”胶囊开关，立即生效并保存。系统减少动态效果设置仍自动生效，此开关不会修改 Windows 系统设置。
- 设置与历史页面使用可滚动的自适应全宽布局；主题和排版采用带太阳/月亮、左右/上下图标的胶囊选项，布尔设置采用胶囊开关。

### 复验清单

- [x] 用 example 1 再次翻译，跨过原来的第 78 段并完成 119/119 段；人工核对公式对应关系和译文语义。
- [x] 翻译若干段后取消，确认译文和进度保留；点击“继续翻译”，不从第 1 段重新开始，无重复段落。
- [x] 若某段失败，修复运行环境后点击“继续翻译”，从未完成段继续；失败任务不写入完整历史。
- [x] 点“重新翻译”从头开始；修改原文或语言后显示“开始翻译”，不会拼接旧任务内容。
- [x] 续传完成只保存一条完整历史记录，首尾完整、进度为 100%。
- [x] 设置开启“减少动态效果”后过渡和脉冲停止，重启仍保留；关闭后跟随系统偏好。
- [x] 最小窗口、最大化窗口下检查设置与历史自适应宽高，内容可以滚动，无按钮遮挡。
- [x] 浅色/深色与左右/上下胶囊选项图标清晰、选中状态明确，键盘可操作；各胶囊开关功能正确。

### 本轮验证

- Python 49 项、前端 6 组、Rust 2 项测试通过；版本同步、TypeScript、Vite 构建、Rust 格式和检查通过。
- 使用本机 RTX 5070、Hy-MT2-7B Q6_K、llama.cpp b10545 实测 example 1：22,259 字符、119 段，第 77 段后取消，从第 78 段继续至 119/119，质量检查无错误；单次总耗时 52.31 秒。
- 实测报告与译文：`artifacts/validation/round2-report.json`、`artifacts/validation/round2-translation.md`。速度是此样例单次数据，语义质量仍待人工验收。
- 全程未使用桌面自动操作；界面最终视觉效果待人工验收。继续仅保留本地提交，不推送、不创建 PR。
- 本轮重新执行 `npm run build:installer`；新安装包 SHA-256：`e4c8147e9629a04ea490c41b01a11d83ae948c2c10f25244b16ce875f5c3f157`（替代上方首轮包）。
- 新打包网关冒烟验证通过：健康检查、任务 ID、取消接口、完成任务重放，无额外推理请求。

## 第三轮复验：0.2.0-beta.2

本轮继续在 `codex/lat-ui-longtext-stability` 本地分支工作，保留此前反馈和勾选。新版安装包单独放在 `artifacts/v0.2.0-beta.2/`；安装前退出旧版 LAT，避免仍使用旧网关。未推送 GitHub。

### 改动说明

- 通用按钮、危险按钮、胶囊开关、图标选项组和设置选择框集中到 `src/components/Controls.tsx` 与 `controls.css`。开关使用 48×28 轨道和 20×20 圆点，布局居中，避免原生 checkbox 伪元素偏移。
- Hy-MT2 使用简短的指令与正文分隔结构；按 [官方任务示例](https://huggingface.co/tencent/Hy-MT2-1.8B/blob/main/README.md)调整，失败段以更短指令重试。新增中文提示词泄漏检测；可疑结果在显示和写入历史之前拦截。原文自带的指令语句不应被误当作泄漏。
- 保护 Markdown 相对链接目标，避免文档文件名被翻译；保留公式保护和断点续传机制。
- 模型运行时的模型页显示显存、利用率、功率和温度四类趋势图。支持多张 NVIDIA 显卡，指标是整卡数据，包含其他程序占用；不将显卡总占用标成 LAT 独占。缺失值显示“暂不可用”，而非伪造为 0。
- 监测只在模型看板可见时请求，页面隐藏/离开时停止。后端采样有超时及缓存，不占用翻译任务锁。刷新间隔可选 1/2/5 秒，趋势范围可选 1/2/5 分钟；趋势仅保留本次看板会话。
- 历史默认仍保留 30 条，可选 10/30/50/100/200 条；降低上限前确认，之后立即淘汰最早记录。可关闭新记录保存，已有记录继续保留。
- 历史页只保留顶部“翻译历史”标题，右上角替换为“清空历史”，与关闭模型共用危险按钮样式。展开历史时原文和译文等高、独立滚动；小窗口上下排列仍等高。

### 本轮待验收

- [x] 在浅色/深色主题及 Windows 100%/125%/150% 缩放下检查所有胶囊开关：圆点垂直居中，开关两端留白一致，键盘空格可切换。
- [x] 使用 `hy-mt2-1.8b:q8_0` 翻译 `tests/fixtures/prompt-leak-source.md`，无“仅返回翻译后的文本”等规则泄漏，无 `[源文本]`，标题、加粗及链接正常。
- [x] 1.8B 和 7B 分别翻译原来的 example 1，确认长文完成、公式完整；人工检查语义质量。
- [x] 模型启用后进入“模型”：显示四类实时图表；翻译中查看时数值和趋势会更新，取消/完成后仍显示真实负载。
- [x] 检查显卡名称、整卡显存/功率/温度，结合本机 NVIDIA 工具确认量级一致；不支持的项显示不可用。
- [x] 更改刷新间隔与趋势范围，切换页面及隐藏窗口再回来，监测可恢复；不会持续叠加请求。
- [x] 历史上限改为 50/100 后可以超过 30 条；调低上限时取消确认不会删除，确认后只保留最新指定数量；重启后设置仍保留。
- [x] 关闭“保存翻译历史”后完成新翻译不新增记录，已有记录仍可查看；重新打开后恢复保存。
- [x] 历史页只显示一个“翻译历史”标题，右上角是“清空历史”，鼠标悬停变红，取消清空确认不会丢记录。
- [x] 翻译页的“关闭模型”在右上角，翻译中禁用；历史页不再重复显示关闭模型按钮。
- [x] 展开长短差异较大的历史，原文/译文区域高度一致、分别滚动；最大化与最小窗口均可阅读和恢复记录。

### 自动验证

- Python 56 项、前端 8 组及 Rust 2 项测试通过；版本同步、TypeScript、Vite 构建、Rust 格式和检查通过。
- 前端测试覆盖设置持久化、动态容量淘汰、看板曲线/缺失值/断线和卸载停止轮询、历史顶部操作与双栏结构。
- 实测报告：`artifacts/validation/round3-report.json`；两种模型的短文、公式与完整长文译文在同目录 `round3-*.md`。真实模型输出的语义质量与桌面视觉仍由用户验收。
- 最终实机结果（RTX 5070）：1.8B Q8_0 对本轮短文用时 0.57 秒，7B Q6_K 用时 1.47 秒，均无泄漏/自动重试；公式样例均通过。22,259 字符长文均完成 119/119 段，1.8B 用时 22.70 秒（1 次安全重试），7B 用时 57.30 秒（0 次重试）。这是单次测量，不代表所有文本的性能。
- 新版安装包已构建；SHA-256：`f105673bdb111f130fb6938ba4cfafe2b502bff83dab1bf9538fbc7fba499666`，校验文件位于同目录 `SHA256SUMS.txt`。
- 打包后的 beta.2 网关通过健康检查及显卡实时采样冒烟验证；本机 RTX 5070 显存/利用率/功率/温度均成功读取，采样时间可更新。原始记录在 `artifacts/validation/round3-telemetry.json`，验证进程已正常关闭。

## 第四轮复验：0.2.0-beta.3（2026-09-19）

用户已确认 beta2 全项通过。本轮继续仅做本地提交，不推送或创建 PR。安装 beta3 前请退出旧版 LAT。

### 改动

- 历史记录收起状态固定元信息和三行摘要区域，避免中英文换行差异导致卡片高度不同；完整内容在展开后查看，保留等高双栏和独立滚动。
- 显卡刷新间隔增加 0.5 秒，设置持久化；图表横轴左端改为正数“60 秒 / 120 秒 / 300 秒”。
- 本地网关启动即开始后台采样，模型尚未启用、页面切换或窗口隐藏期间持续记录。最近 5 分钟最多 601 个采样点保存在内存中，看板按选择的范围显示；退出应用后不持久化。
- 移除看板的 GPU MONITOR 与说明行；刷新间隔、采样时间和“最近 x 分钟”放在显卡型号右侧，小窗口自动换行。
- 页面滚动区预留稳定的滚动条槽位及内容间距，文本、历史正文与语言列表也预留槽位，避免有无滚动条造成横向布局跳变。

### 待复验

- [x] 同时保存短中文译英、长英文译中记录，收起状态卡片高度一致，摘要最多三行；展开后内容完整且两侧等高。
- [x] 选择 0.5 秒刷新，重启后仍保留；显卡型号右侧显示刷新间隔、时间及“最近 x 分钟”。
- [x] 图表左下角显示“60 秒 / 120 秒 / 300 秒”，没有负号；原来的 GPU MONITOR 及整卡说明行已移除。
- [x] 启动后停留在模型选择页或翻译页一段时间，再进入看板，能看到此前积累的曲线。
- [x] 从看板切到设置/历史，或隐藏窗口，稍后返回曲线仍连续；关闭/重新启用模型也不清空趋势。
- [x] 运行超过 5 分钟后，趋势只保留所选范围内的数据；更换范围可查看本次运行已积累的最近 5 分钟。
- [x] 在设置、历史、模型页面分别触发/消除纵向滚动条，页面内容水平位置不跳动，滚动条与内容有间距；长历史和翻译正文也不紧贴滚动条。

### 自动验证

- Python 58 项、前端 8 组测试通过，包含后台独立采集、0.5 秒设置恢复、601 点时间淘汰，以及看板读取进入页面前的历史数据。
- 未使用桌面自动操作；卡片视觉等高、滚动条间距和不同缩放比例仍由用户复验。
- 版本同步、TypeScript、Vite 构建、Rust 格式检查、`cargo check` 和 2 项 Rust 测试通过；已执行 `npm run build:installer`。
- 打包网关实机测试：首次获取看板数据前已后台记录 7 点，关闭模型后保留旧点并增至 9 点；0.5 秒档位测得最近采样间隔中位数 0.512 秒。报告：`artifacts/validation/beta3-telemetry.json`。
- beta3 安装包 SHA-256：`8fbec08f06ede7db4e6fa6da5e735547d089fb0e344330c8ba195c610be0ed73`，同目录提供 `SHA256SUMS.txt`。

## 发布确认（2026-09-19）

用户已完成 beta3 全部验收，并明确授权推送 GitHub、发布 `0.2.0-beta.3` 预发布。上文各阶段“不推送/等待验收”的文字保留为历史记录，此确认取代当前发布限制。

<!-- end-preserved-source:lat-ui-longtext-checklist.md -->

</details>

<a id="archive-selection"></a>

<details>
<summary>划词翻译与 0.2.1-beta.1 / beta.2 · 历史原文</summary>

<!-- preserved-source:lat-selection-translation-checklist.md sha256:e9f83fefa2d90c1c7143fad90a7097e5b41d7a8130186def8ce5693935cc6484 -->

# LAT 0.2.1 划词翻译验收

最新复验版本：**0.2.1-beta.2 输入兼容修订构建（2026-09-30）**。安装包：`artifacts/v0.2.1-beta.2/LAT_0.2.1-beta.2_x64-setup.exe`，同目录附 `SHA256SUMS.txt`。本轮保持版本号并重新生成安装包。

状态：**beta.1 用户验收反馈已记录，beta.2 修复待复验**。原有勾选和问题描述保留；复制兜底尚未覆盖。新增复选框由用户填写，自动化测试结果不代表真实桌面交互通过。本轮经用户授权进行了输入诊断与电脑操作辅助，覆盖范围见末尾记录。

## 已完成的开发验证（2026-09-26）

| 检查 | 结果 |
| --- | --- |
| Python 回归 | 69 项通过 |
| 前端行为测试 | 15 项通过 |
| Rust 单元测试 | 11 项通过，未调用真实桌面取词或注入输入 |
| 版本、TypeScript、前端构建 | 通过 |
| Rust 格式与编译 | 通过 |
| Windows NSIS 安装包 | 构建成功，SHA-256 与同目录校验文件一致 |
| 打包网关检查 | 版本响应正确；只使用已启用模型的 JSON/SSE 请求返回 `model_not_ready`，未启动模型，测试网关已退出 |

安装包 SHA-256：`0c3e23b54a0de2e70717ddaaef6f8e93fdfaf5f0d1afb0f90108dccbca897b91`。

以上结果不代表下方真实 Chrome/Edge、剪贴板、托盘及多显示器项目已通过。

## beta.1 验收准备（历史记录）

- 本地分支：`codex/selection-translation-beta1`。
- 安装包：`artifacts/v0.2.1-beta.1/LAT_0.2.1-beta.1_x64-setup.exe`；同目录附 `SHA256SUMS.txt`。安装前真正退出旧版 LAT，避免继续连接旧网关。
- 沿用已有模型和运行时，无需为此功能重新下载模型。建议至少使用一个 1.8B 和一个 7B 模型检查短文结果。
- 首轮重点为 Chrome、Edge 的网页和可选文字 PDF；图片与扫描 PDF 不在 OCR 支持范围内。
- 所有剪贴板操作请使用测试内容；记录格式是否恢复或被安全拒绝，不要求对所有格式强制执行复制。

| 环境 | 用户填写 |
| --- | --- |
| Windows 版本 | |
| Chrome / Edge 版本 | |
| 测试模型 | |
| 显示器数量、分辨率、缩放 | |
| 安装包校验结果 | |
| 验收日期 | |

## 设置和取词入口

- [x] 从旧版升级后，现有主题、历史、模型目录和遥测设置保留；划词翻译默认关闭。
- [x] 首次启用后出现可用的划词入口，默认快捷键为 `Ctrl+Alt+T`，“关闭到托盘”自动启用且可单独关闭。
- [x] 修改快捷键后新快捷键生效、旧快捷键失效；与其他软件冲突时有明确提示，不显示虚假的启用成功状态。
- [x] 关闭划词翻译后，不再出现浮标或响应取词快捷键；重新启用后恢复。
- [x] 改动快捷键、复制兜底开关、关闭到托盘及浮窗目标语言后，真正退出并重启，设置仍保留。
- [x] 浏览器中拖选一段文字，浮标出现但不抢焦点；仅显示浮标时不调用模型，点击才翻译。
- [x] 双击单词后可以取词；使用键盘选中文本再按快捷键可以打开浮窗。
- [x] 空选区或没有可取文本时提示清楚，不把旧剪贴板内容当作本次原文。
- [x] 新选择替换旧选择；外部点击、滚动、切换应用及等待约 5 秒会隐藏浮标，不出现旧选区误触发。
- [x] LAT 自身输入区不反复触发外部取词；密码输入框不产生含密码的浮标、浮窗或历史。

## 浏览器与 PDF 兼容性

对下面每个项目分别测试英文单词、英文跨行段落、中英文混排；记录取词方式、缺字或换行问题。取词不支持时的安全提示不等于该软件兼容性通过。

- [x] Chrome 普通网页选区正确，页面仍可正常点击、滚动和输入。
- [x] Edge 普通网页选区正确，页面仍可正常点击、滚动和输入。
- [x] Chrome 网页输入框/多行文本框中选区正确，不改变原输入内容。
- [x] Edge 网页输入框/多行文本框中选区正确，不改变原输入内容。
- [x] Chrome 内置 PDF 阅读器可选文字取词正确，跨行和跨段内容没有意外丢失。
- [x] Edge 内置 PDF 阅读器可选文字取词正确，跨行和跨段内容没有意外丢失。
- [x] PDF 自带的选区工具条仍可使用，LAT 浮标位置不妨碍其常用操作。
- [x] 论文公式附近取词时，普通文字可翻译；公式预览及复制内容没有意外反斜杠损坏。
- [x] 扫描 PDF/图片没有可选文字时，不伪造译文、不翻译旧剪贴板，并能退回手动操作。
- [x] 无法暴露选区或权限更高的软件有明确的失败/手动复制提示，不会卡住 LAT；未要求提权或启动管理员进程。

| 软件 / 页面或 PDF 类型 | 取词方式与结果 | 问题与复现步骤 |
| --------------- | ------- | ------- |
| Chrome 网页       |         |         |
| Edge 网页         |         |         |
| Chrome PDF      |         |         |
| Edge PDF        |         |         |
| 其他软件（可选）        |         |         |

## 剪贴板和焦点保护

以下项目须覆盖真正触发复制兜底的场景。UIA 已成功取得文字时不应修改剪贴板；若当前测试软件一直使用 UIA，可在反馈中注明兜底尚未覆盖，不直接勾选为通过。

- [ ] 剪贴板预存普通文本，使用 UIA 取词后，原剪贴板保持不变。
- [ ] 剪贴板预存普通文本，执行复制兜底后能恢复原内容；原始选择文字及译文正确。
- [ ] 剪贴板预存带 HTML/RTF 格式的文字，兜底后格式和内容完整恢复，或在操作前明确拒绝无法安全备份的格式，不悄悄降级为纯文本。
- [ ] 剪贴板预存图片，兜底后图片完整恢复，或安全拒绝兜底；图片不丢失、不被文本覆盖。
- [ ] 剪贴板预存文件列表，兜底后文件列表完整恢复，或安全拒绝兜底；仍能正常粘贴文件。
- [ ] 目标应用不响应复制时，提示未取得选区，不以备份中的旧文本发起翻译。
- [ ] 兜底期间在其他应用执行新的复制，LAT 不恢复旧备份覆盖新内容，也不把另一窗口的新内容翻译为本次选区。
- [ ] 点击浮标前切换应用，或触发快捷键后立即切换焦点，不会向错误窗口发送复制或翻译错误窗口内容。
- [ ] 按住快捷键再松开时，不粘连 Ctrl/Alt 修饰键；后续输入和快捷键正常。
- [ ] 关闭复制兜底设置后，UIA 失败会明确提示，不再模拟复制；用户剪贴板保持不变。

## 浮窗、模型和任务隔离

- [x] 浮窗默认自动识别原文并译为中文，目标语言独立记忆；修改它不改变主窗口语言。
- [x] 原文折叠、译文复制、重试、文本/LaTeX 预览均正常；没有 prompt 或内部保护标记泄漏。
- [x] 未固定时失焦关闭；固定后切换应用仍显示；关闭操作可用。
- [x] 浅色/深色主题和减少动态效果与主窗口一致，窗口缩放后内容可读、按钮仍可操作。
- [x] 100% / 150% / 200% 缩放下，浮标和浮窗不越过当前显示器工作区；多显示器之间移动后位置仍正确。
- [x] 模型未启用时保留取词内容并提示前往启用，不自动加载或下载；在主窗口启用后可回到浮窗重试。
- [x] 主窗口长文正在翻译时触发划词，浮窗提示忙碌及重试，原任务持续执行，不被取消或排队抢占。
- [x] 浮窗正在翻译时再次划词或按快捷键，当前任务和原文不被新内容覆盖。
- [x] 关闭正在翻译的浮窗只取消它自己的任务；马上重新取词时不混入上一请求的迟到输出。
- [x] 浮窗关闭或取消后，主窗口可以继续发起翻译；正在完成取消时的短暂忙碌提示可理解且可重试。
- [x] 翻译期间手动关闭模型后出现可操作错误，不重新自动加载模型，不误报翻译成功。
- [x] 含恰好 5,000 个 Unicode 字符的选区可在浮窗发起；5,001 个字符提示转到主窗口，没有截断。
- [x] 超长选区转到主窗口后保留全文；主窗口已有草稿时先确认，取消替换会保留原草稿。

## 历史、托盘和回归

- [x] 完整成功的划词翻译只增加一条历史，标注“划词翻译”；失败、忙碌、取消不保存不完整结果。
- [x] 历史保存关闭时划词翻译不新增记录；条数上限与主窗口一致，原有普通历史仍能查看。
- [x] 开启“关闭到托盘”后关闭主窗口，划词仍可用且模型保持启用；托盘可以重新打开主窗口。
- [x] 托盘暂停划词后鼠标和快捷键入口停止，恢复后重新可用。
- [x] 托盘暂停属于当前会话；真正退出再启动后，按照设置中的划词启用状态恢复，未意外修改持久化开关。
- [x] 再次启动 LAT 不产生第二套网关/模型进程，可以回到现有主窗口。
- [x] 关闭“关闭到托盘”后关闭主窗口，应用正常退出；托盘“退出”也会真正退出。
- [x] 真正退出后，托盘图标、全局快捷键、取词监听、网关和 LAT 启动的模型进程释放，相关显存回收。
- [x] 重启后不自动显示上次未保存的选区；已保存的完整翻译历史仍可查看。
- [x] 原有主窗口短文/长文翻译、继续翻译、LaTeX 预览、模型切换和 GPU 数据趋势没有回归。

## beta.1 用户验收结果与反馈

- 结论：需修改
- 未覆盖项目：兜底尚未覆盖
- 缺陷与复现步骤：
	- 第一次测试取词按钮点击无反应
	- 后续启动划词翻译之后, 电脑鼠标操作会有明显延迟, 操作不跟手的问题, 并且划词浮标也一并消失, 快捷键依旧可以进行划词翻译
	- 取词翻译框的 R 脚与 win 11 窗口 R 脚不统一, 请直接使用系统窗口的 R 脚即可, 不需要额外添加窗口内的 R 脚
- 界面截图或其他附件（由用户提供）：无

## beta.2 修复与复验（2026-09-30）

先通过托盘“退出”真正结束旧版 LAT，再安装 beta.2；已有模型、历史和设置继续沿用。

- 鼠标监听改为消息唤醒；回调中移除同步窗口查询，窗口识别与 UIA 均在工作线程执行。
- 浮标的原生按下/抬起直接激活；网页物理点击不再重复请求，保留辅助功能激活。
- 取词等待期间发生新输入时丢弃迟到结果；快捷键请求在协调线程处理时分配编号。
- 浮窗圆角交由 Windows 绘制，移除内容区额外的外层圆角与边框。

### 待复验

- [ ] 真正退出并冷启动 LAT 后，第一次划选出现浮标，点击一次即可打开浮窗并翻译；连续划选不重复提交同一请求。
- [ ] 持续启用划词至少 15 分钟，在 Chrome/Edge 网页及 PDF 中反复点击、拖选、滚动和切换应用；鼠标跟手，浮标仍可重新出现，快捷键正常。
- [ ] 将浏览器暂时置于繁忙状态，随后重新划选；等待中的旧结果不突然弹出，鼠标与其他应用操作仍顺畅。
- [ ] 点击 LAT 主窗口或浮窗不会触发自身取词；从外部拖入浮标或从浮标拖出时不误发起翻译。
- [ ] 浅色/深色主题与 100% / 150% / 200% 缩放下，浮窗只使用系统窗口圆角，无内部重复圆角或边框，缩放与固定功能正常。
- [ ] 补测上方尚未覆盖的“剪贴板和焦点保护”项目；如继续未覆盖，请保留未勾选状态。

### 第一轮开发验证（历史记录）

| 检查 | 结果 |
| --- | --- |
| Python 回归 | 69 项通过 |
| 前端行为测试 | 16 项通过，包含物理点击不重复提交及辅助功能激活 |
| Rust 单元测试 | 16 项通过，包含首次原生点击、拖入/拖出保护、迟到取词与快捷键排队顺序 |
| 版本、TypeScript、前端构建 | 通过 |
| Rust 格式与编译 | 通过 |
| Windows NSIS 安装包 | 构建成功，SHA-256 与同目录校验文件一致 |
| 打包网关检查 | 版本响应为 beta.2；模型未启用时 JSON/SSE 返回 `model_not_ready`，未启动模型；测试网关已退出 |

第一轮安装包 SHA-256：`c1123be3ad412e3693ce3c11e7dded7d724e96020fa4425efa7a7e5d5f35400e`。原安装包及校验文件保留在本地 `artifacts/validation/selection-beta2-original-*`，当前安装路径已更新为修订构建。

检查日志与打包网关报告位于本地 `artifacts/validation/selection-beta2-*`。未启动桌面应用进行自动操作；真实鼠标响应、跨软件浮标和系统圆角仍待用户复验，复制兜底仍未覆盖。

## beta.2 修订：浮标显示与未固定拖动（2026-09-30）

用户反馈：划词后浮标未出现；浮窗不固定无法拖动。

- 浮标显示改用 Tauri 接口同步框架可见状态；显示失败时在主窗口提供错误。
- 浏览器鼠标松开后暂时返回空选区时受限重试一次；密码、接口错误或新操作均不重试或取消旧结果。
- 浮窗失焦时核对实际前台窗口及请求身份，避免拖动或内部焦点转移误关闭未固定浮窗。
- 标题文字、图标与空白区域直接发起原生拖动；按钮区域不参与拖动，固定状态不变。

### 待复验

- [ ] 网页与文本 PDF 中拖选、双击后浮标能出现；反复显示/隐藏和切换显示器后仍正常，不抢焦点。
- [ ] 划词后立刻点击或滚动时，旧浮标不迟到出现；空选区和密码控件不触发翻译。
- [ ] 未固定浮窗可从标题文字、图标和空白处拖动；拖动期间不消失、不改变固定状态，固定后仍可拖动。
- [ ] 固定、关闭和转到主窗口按钮正常；未固定时点击外部应用仍关闭浮窗，快速重新取词不会被旧失焦事件关闭。

### 修订开发验证

Python 69 项、前端 17 项、Rust 20 项测试通过；版本、类型、Rust 格式与编译、前端构建及 Windows NSIS 修订安装包构建通过，SHA-256 与校验文件一致。打包网关版本及 JSON/SSE `model_not_ready` 检查通过，未启动模型；测试网关已退出。日志位于本地 `artifacts/validation/selection-beta2-popup-*`。未主动操控用户桌面进行验收，以上项目仍待用户复验。

## beta.2 再次修订：鼠标输入兼容（2026-09-30）

用户再次反馈：所有软件划词后浮标均不出现，快捷键可用；允许提供日志或使用电脑操作辅助修复。

- 原生诊断观察到鼠标按下/抬起携带 `LLMHF_INJECTED` 标记。旧鼠标钩子直接丢弃此类事件，手势判定及浮标显示均不会执行。
- 修订后同类事件正常进入手势与 UIA 链路；原生诊断记录 `gesture=true fresh=true`，读取 7 个字符且 `bubble_eligible=true`，没有记录选中文本。
- LAT 自己发出的复制按键带有专用标记，仅排除这些自身事件；其他注入按键和鼠标点击/滚动仍参与选区失效及剪贴板保护。
- 用户通过 Esc 停止电脑操作后未继续操作桌面。诊断验证到取词及浮标显示条件，尚未安装新包验证真实浮标显示和点击。

### 本轮仍待用户复验

- [ ] 安装本轮修订包后，在此前所有软件均无浮标的同一输入环境中拖选、双击；浮标出现且点击一次可打开浮窗，快捷键继续可用。
- [ ] 后续点击、滚动和键盘输入使旧选区失效；复制兜底不会因 LAT 自己发出的复制按键被取消，也不会覆盖期间产生的新剪贴板内容。

### 开发验证

Python 69 项、前端 17 项、Rust 22 项通过；1 项原生诊断默认忽略且已单独运行。版本、类型、Rust 格式与编译、前端生产构建及 NSIS 安装包构建通过；打包网关 JSON/SSE `model_not_ready` 检查通过且测试网关已退出。原生前后日志为本地 `artifacts/validation/selection-beta2-mouse-before.log` 与 `selection-beta2-mouse-after.log`；构建与自动化日志为 `selection-beta2-input-*`。

最新安装包 SHA-256：`c0f12f3104305f05d9a33693237b712a4dc5f12345b0b829cf0490d3ee4b8d68`，与 `SHA256SUMS.txt` 一致。上一轮修订包（SHA-256 `d7294ea5955af9c4b08565dd1cc869320fe0b06afb76d09f60e84ce4af808471`）保存在本地 `artifacts/validation/selection-beta2-popup-before-input-*`。原有验收勾选保持不变。

修订安装包 SHA-256：`d7294ea5955af9c4b08565dd1cc869320fe0b06afb76d09f60e84ce4af808471`。

本轮继续本地构建与提交；复验完成并获得明确发布指令后，再推送 GitHub、创建 PR 或发布预发布版本。

<!-- end-preserved-source:lat-selection-translation-checklist.md -->

</details>

<a id="archive-inference"></a>

<details>
<summary>推理看板与 0.2.1-beta.3 · 历史原文</summary>

<!-- preserved-source:lat-inference-dashboard-checklist.md sha256:17a82fdf1126a12f4971d830c0ede643a9825578b5c5e5a3a72adce951571547 -->

# LAT 0.2.1-beta.3 推理看板与固定浮窗验收

本地安装包：`artifacts/v0.2.1-beta.3/LAT_0.2.1-beta.3_x64-setup.exe`，同目录附 `SHA256SUMS.txt`。升级前通过托盘“退出”真正结束旧 LAT；沿用已有模型、历史和设置。

以下真实桌面项目由用户复验填写。自动化和验收样例不代表真实模型性能已测得，也不更改之前的划词验收勾选。

## 推理指标

- [ ] 冷启动并进入模型页，在尚未翻译时没有伪造的 token 或速度；开始翻译后状态、首 token 延迟及调用耗时更新，结束后保留最近结果。
- [ ] 主窗口和划词浮窗的推理均进入同一看板；输入、输出、总 token 及速度能与本地 llama.cpp 的 usage/timings 对照，缺失统计明确显示未知。
- [ ] 翻译长文、触发质量重试或继续断点时，实际模型调用分别累计；已缓存段落不重复计入，已被拒绝输出的模型消耗不会消失。
- [ ] 取消、连接中断和模型错误后不持续显示“生成中”；保留已知用量，未收到的统计保持未知。网关重启后会话累计清空。
- [ ] 0.5/1/2/5 秒刷新、最近 1/2/5 分钟硬件趋势仍正常；没有 NVIDIA 数据时推理指标仍可展示，监测不会自动启用模型。

## 架构可视化

- [ ] 1.8B、7B 及不同量化版本显示各自本地 GGUF 的架构信息；切换模型后不沿用旧模型层数、参数或用量标签。
- [ ] 点选嵌入、Attention、FFN、输出模块可查看说明；层堆叠及光流随调用阶段变化，明确标为路径示意，不声称逐参数活动实测。
- [ ] 空闲、取消、断联或隐藏页面后动画停止；暂停动画和减少动态效果均有效，数值更新不受暂停动画影响。
- [ ] 明暗主题与 900/1320 像素窗口宽度下，指标、模块说明和趋势均清晰可读；键盘可以点选模块及暂停动画。

## 固定浮窗

- [ ] 固定翻译浮窗，拖到另一位置并改变大小；再次在同一或另一显示器划词，原文和译文更新，窗口位置及大小保持。
- [ ] 取消固定后再次划词，浮窗恢复跟随新选区且不越过工作区；关闭、固定、复制及拖动操作仍正常。

## 开发验证记录

Python 87 项、前端 23 项、Rust 23 项通过；1 项真实桌面原生诊断默认忽略，本轮未运行。版本、TypeScript、Rust 格式与编译、前端生产构建及 NSIS 安装包构建通过。回归覆盖真实 token 与计时、usage-only SSE、缓存 prompt、取消、异常、分段、重试、缓存复用、元数据边界，以及固定后保留几何位置并在取消固定后恢复定位。

打包网关在独立空运行目录验证新增接口、空会话和未知元数据，JSON/SSE 未启用模型保护通过，测试网关已退出。实际安装的 1.8B Q8_0 与 7B Q6_K GGUF 头部解析通过，均读取 32 层及对应维度；读取不加载权重。浏览器已检查 900 像素深色、1320 像素浅色界面样例及模块点选、暂停、减少动态效果、断联停止动画；样例性能值为合成数据。

安装包 SHA-256：`d1a1b4f9ffcdc40ea3a61ba3f31329bcdf62c6eea30deaea73e198b656e75d95`。记录与截图位于本地 `artifacts/validation/beta3-*`，均不提交 Git。上述验证未代替真实模型测速和真实桌面交互，上方验收项保持待复验；之前的划词验收勾选不变。

<!-- end-preserved-source:lat-inference-dashboard-checklist.md -->

</details>

<a id="archive-architecture"></a>

<details>
<summary>模型架构与 0.2.1-beta.4 · 历史原文</summary>

<!-- preserved-source:lat-model-architecture-checklist.md sha256:0435355942bf422f7cc8d4a79471b8422e336ae763577b56522517578af17487 -->

# LAT 0.2.1-beta.4 模型架构与看板复验

安装包：`artifacts/v0.2.1-beta.4/LAT_0.2.1-beta.4_x64-setup.exe`；同目录 `SHA256SUMS.txt`。安装前从托盘退出旧 LAT，继续沿用本地设置、模型和历史。

以下项目由用户在实际桌面复验填写。开发样例的性能数值和动画数据为合成示例，不代表实际推理测速；此前清单勾选保持不变。

## 架构入口与细节

- [ ] 左侧“模型架构”进入独立页面，模型监测页不再包含架构剖面。模型未启用时也可查看本地已安装模型，未下载时显示缺失状态，不自动加载模型。
- [ ] 总览可进入任意具体 Transformer 层，返回总览或切换层编号后内容与编号一致；第一层和最后一层都能查看。
- [ ] 书架按编号连通相邻层，点击书脊先抽出所选层再进入详情；连续点击、减少动态效果、隐藏和断联时不进入错误层或滞留动画。
- [ ] 连接、返回及外链箭头风格统一；层内主路、两条残差的起点/加法汇入节点、相邻层的输入/输出方向明确且无悬空支路。
- [ ] 放大查看 Attention、KV heads 与 KV cache，以及 FFN 的扩展、激活/门控与回投影；每层的张量表显示本地 GGUF 存储形状，不把示例纹理显示为实际权重。
- [ ] Embedding 和 Output 可以直接查看，包含查表、隐藏向量、logits 和采样的分步骤动画；词表、维度与选中本地模型一致。
- [ ] 参数矩阵和张量列表可切换；Q/K/V、FFN、归一化点选后存储轴、元素数与当前层一致。向量不乘 head 数，截断与未知数量明确，示意格子不显示为真实权重值。
- [ ] 播放、暂停、步骤切换和返回操作正确；动画只作教学讲解，不标注为运行模型的逐参数活动。应用/系统减少动态效果与隐藏、断联后的暂停生效。
- [ ] 1.8B 与 7B 切换后不沿用旧层或 head、词表、张量形状；未知元数据与旧网关状态清楚，键盘操作入口和细节控件正常。

## 看板与滚动

- [ ] 模型页“模型推理 / GPU 硬件”选项卡一次只显示所选看板；鼠标和方向键可切换，选中状态清楚；切换后最近调用及 GPU 趋势没有丢失。
- [ ] 所有界面不再出现“真实计数”；token 来源、未知与部分统计提示仍准确，推理和硬件原有设置正常。
- [ ] 900/1320 像素宽、较矮和常规高度窗口中，模型/架构页只有外侧滚动条；所有长内容可滚到末尾，不被裁切，也没有水平溢出。
- [ ] 切换回翻译后原文、译文保留；文本/LaTeX 预览和历史/设置必要的局部滚动继续正常，关闭模型与翻译冲突保护正常。

## 开发验证记录

- 前次 beta.4 的 Python 90 项、Rust 23 项与 Rust 格式/编译检查通过；1 项真实桌面鼠标诊断默认忽略。本次架构 UI 更新的全部 42 项前端测试、版本、TypeScript、前端生产与 NSIS 安装包构建通过。
- 本地 1.8B Q8_0 / 7B Q6_K 的全部 32 层、352 条张量形状读取通过，未加载权重。
- 打包网关在隔离运行目录通过版本、初始遥测、新增 GGUF 元数据、JSON/SSE `model_not_ready` 与 shutdown；未启动模型或桌面。
- 工作区界面样例核对总览与全部模块细节、GQA 点选、模型切换、关闭模型后浏览、减少动画、断联暂停，以及选项卡键盘切换；1320 × 900 / 900 × 560 的长页面可达，无内部滚动或水平溢出。性能数值为合成样例。
- 书架 8/4 列切换、实际抽书及各计算子页的端点检查通过；没有内部滚动条或水平溢出。参数卡片/张量列表与实际 1.8B、7B 维度相符。
- 安装包 13,305,254 字节；SHA-256 与同目录 `SHA256SUMS.txt` 一致。详细口径、截图与验证记录见 [beta.4 发布说明](../releases/v0.2.1-beta.4.md)。

上方勾选保留给用户在实际安装版桌面复验。

<!-- end-preserved-source:lat-model-architecture-checklist.md -->

</details>

<a id="archive-runtime"></a>

<details>
<summary>第一轮稳定性与 0.2.1-beta.5 · 历史原文</summary>

<!-- preserved-source:lat-runtime-stability-checklist.md sha256:382249459ec06850d579fa1d7ca279b605a0100b2e82921cb086724ba9757d6b -->

# LAT 0.2.1-beta.5 第一轮稳定性验收

本地分支：`codex/runtime-stability-beta5`。安装包：`artifacts/v0.2.1-beta.5/LAT_0.2.1-beta.5_x64-setup.exe`；同目录提供 `SHA256SUMS.txt`。安装前从托盘退出旧 LAT，模型目录、设置及历史继续沿用。

以下勾选交由用户在实际安装版验收。开发测试与人工验收分开记录，此前各版本清单不作修改。外部网关与第三方客户端项目可以在未使用该场景时注明“本次不适用”。

## 模型生命周期与冲突

- [ ] 冷启动应用后正常识别模型和数据目录；连续点击启用不会出现重复模型进程，状态最终进入可翻译。
- [ ] 正常关闭模型后显存释放，重新启用可用；依次使用已安装的 1.8B Q8_0 和 7B Q6_K，界面、译文返回模型与实际启用对象一致。
- [ ] 一次加载失败后界面恢复可操作；纠正失败原因后可重试，不残留错误的“已启用”状态或重复进程。可记录自然发生的失败，不要求破坏模型文件制造故障。
- [ ] 主窗口翻译长文时，切换/关闭模型、修改数据目录等冲突操作不可执行或得到明确忙碌提示；不会导致当前任务使用错误模型。任务结束或取消后这些操作恢复。
- [ ] 模型仍在加载时从托盘退出，应用能结束，自身 gateway 和 llama-server 不残留。

## 取消、断连与续译

- [ ] 使用 16,000 字符以上文本，在等待首段期间取消，不必等到模型输出译文才响应；记录取消到可再次翻译的实际耗时。
- [ ] 已完成若干段后取消，再继续翻译，原有译文不重复，分段衔接完整，最终历史只保存完整成功结果。
- [ ] 在生成途中取消后开始另一任务，旧任务的迟到输出不覆盖新任务；遇到明确忙碌提示时稍后重试可恢复。
- [ ] 主窗口翻译时触发划词，浮窗显示忙碌；关闭或取消浮窗不影响主窗口的任务。浮窗自身翻译时关闭浮窗可以终止其请求。
- [ ] 网关异常断开时，主窗口出现断联提示且原文、已显示译文保留；重新启用模型后可以重新翻译。网关重启后的内存断点过期应明确提示，不伪装为成功续译。
- [ ] 连续进行取消、重新翻译和正常完成，看板仍可刷新，任务锁不永久占用；实际 GPU 负载与显存回收没有持续异常。

## 退出与会话权限

- [ ] 关闭到托盘仍保留模型；通过托盘“退出”真正结束时，界面及时响应，随后自身 gateway 与模型进程退出。
- [ ] 如使用手动启动的外部网关：配置相同 `LAT_ADMIN_TOKEN` 后桌面可复用，退出桌面不关闭该外部网关。旧协议或不同实例占用端口时有明确错误，不误连或误关。
- [ ] 普通桌面启动无需输入密钥；主窗口翻译、划词浮窗、设置与看板均正常，不反复出现 401。
- [ ] 如使用第三方客户端：更新独立 `LAT_API_KEY` / `api_key` 后翻译正常，未提供密钥或错误密钥被拒绝，第三方密钥不能关闭模型、改变目录或关闭网关。浏览器扩展按实际 Origin 配置白名单。

## 流式接口与原功能回归

- [ ] 第三方 OpenAI 兼容流式翻译长文时，第一段通过校验后即可出现内容，无需等整篇结束；单段内仍等待校验，正文中没有 prompt 或内部标记。
- [ ] 需要用量的客户端能接收最终统计；缺少上游计数时显示未知或缺失值，不把未知当作零。取消后续译的统计可包含本任务此前实际调用。
- [ ] 原有 Markdown、LaTeX、译文清理和长文进度正常，公式、代码及链接未被本轮改动破坏。
- [ ] 划词、固定浮窗、转入主窗口、历史恢复、GPU 0.5 秒采样及模型架构页面正常；切换页面保留工作区内容。

## 开发验证记录

- Python 全量 111 项通过，包含新增生命周期、实际本机 socket 取消、鉴权和计数边界测试。
- 前端 47 项通过，包含主窗口/浮窗请求凭据、协议不兼容、迟到会话失效、断联后恢复入口和生产凭据剔除测试；TypeScript 检查通过。
- Rust 24 项通过；1 项要求真实桌面鼠标的诊断保持默认忽略。格式检查与编译检查通过。
- 版本、前端生产构建、Windows NSIS 安装包及最终打包网关隔离验证通过，安装包 SHA-256 与校验文件一致；详情见 [beta.5 发布说明](../releases/v0.2.1-beta.5.md)。
- 未操作实际桌面、未安装/启动 LAT、未加载模型测速。真实显卡取消延迟及进程清理由上述验收补齐。

## 反馈

| 项目 | 结果或复现步骤 | 模型、输入规模与耗时 |
| --- | --- | --- |
| 待用户填写 |  |  |

人工验收结论：待填写。推送 GitHub、PR 与预发布仍等待用户明确指令。

<!-- end-preserved-source:lat-runtime-stability-checklist.md -->

</details>

<a id="archive-performance"></a>

<details>
<summary>第二轮性能与 0.2.1-beta.6 · 历史原文</summary>

<!-- preserved-source:lat-performance-checklist.md sha256:682465d212bccceafa80ab8dc18c1ebe06503a88981f5e436306615957877c41 -->

# LAT 0.2.1-beta.6 第二轮性能验收

本地分支：`codex/performance-beta6`。安装包：`artifacts/v0.2.1-beta.6/LAT_0.2.1-beta.6_x64-setup.exe`，同目录提供 `SHA256SUMS.txt`。安装前从托盘退出旧 LAT，继续沿用模型、设置及历史。以下勾选交由用户在实际安装版完成，旧版清单中的验收记录不作修改。

## 分段调度与划词响应

- [ ] 使用至少 16,000 字符的长文开始主窗口翻译，中途触发一句划词；浮窗显示排队提示，当前分段完成后获得执行机会，长文随后继续，无需整篇结束后重试。
- [ ] 连续触发不同短句划词，主窗口长文仍持续完成新分段，不因高频划词长期停止；同一时刻仅有当前模型实例推理。
- [ ] 划词正在翻译时，在主窗口提交另一篇原文，可以提交并显示等待状态，不直接禁用开始按钮。
- [ ] 浮窗排队时关闭浮窗，主窗口任务继续，已关闭浮窗的内容不写入新浮窗或历史。
- [ ] 主窗口排队或已完成若干段时取消，保留已完成分段；再次继续不会重复正文，最终只保存一次完整历史。
- [ ] 等待或生成期间不能切换/关闭模型、修改模型目录等冲突操作；完成或取消之后恢复可操作。
- [ ] 如使用第三方并发 API：超过等待容量返回 `translation_busy`，不会取消已有请求；排队超时返回 `translation_queue_timeout`，已有完成分段可继续。未使用此场景可以标记不适用。
- [ ] 从托盘退出时，执行及等待任务一并结束，LAT 自有 gateway / llama-server 不残留。

## GPU 历史、采集与页面切换

- [ ] 打开软件后先停留在翻译页面至少一分钟，再进入 GPU 硬件页，能看到此前的历史趋势；不需要先打开看板才开始采集。
- [ ] 使用 0.5 秒档位时，支持 NVML 的本机能正常刷新显存、功率、温度与利用率；不支持的单项显示未知，图表不出现伪造的零值。
- [ ] 在最近 1/3/5 分钟范围之间切换，已有数据保持连续；超过五分钟后旧数据正常滚出范围，无无限增长。
- [ ] GPU 与模型推理选项卡反复切换、离开模型页再返回，当前数据及时更新，图表没有重复点或上一会话残影。
- [ ] 模型架构页的模型、层、模块、张量列表及教学动画正常；切换模型后元数据更新，不持续显示旧模型。
- [ ] 如设备自然进入 NVML 兼容回退，界面显示实际两秒或五秒周期，无频繁弹出控制台窗口；无需为测试主动修改驱动。

## 长文、公式与原功能回归

- [ ] 使用 16,000 字符以上以及接近 100,000 字符的文本，编辑、滚动、页面切换和取消保持可操作，原文字符统计正确。
- [ ] 大段含公式文本切换到 LaTeX 预览，页面显示预览范围提示，边界不会留下半个公式或乱码；小段公式中的 `\in`、`\|`、`\boldsymbol` 仍正常。
- [ ] 切回“文本”可以全选复制完整原文和译文；翻译完成的历史记录也保留全文，未受 4,000 字符预览限制。
- [ ] 翻译页隐藏后继续翻译，再返回时已完成分段和进度完整；取消后立即提交新任务，旧结果不覆盖新内容。
- [ ] 1.8B Q8_0 与 7B Q6_K（按本机已安装模型）都可正常启用及翻译，Markdown、链接、代码、公式和提示词清理无回归。
- [ ] 历史恢复、删除/清空、设置、固定划词浮窗、转入主窗口与网关断联恢复仍正常。

## 同条件性能对比

默认 `f16` KV、同一个模型、同一篇文本和相同采样设置作为比较基线。先各做一次预热，再重复三次，记录中位数；如没有 beta.5 对照，只填写当前实测，不推断提速百分比。重点区分“划词等待当前分段的时间”“首个通过校验的译文时间”和“整篇耗时”。

| 版本 / 模型 | 原文字符数 | 划词等待时间 | 首段出现时间 | 整篇耗时 | 输入 / 生成 tokens/s | 显存峰值 | 备注 |
| --- | ---: | ---: | ---: | ---: | --- | ---: | --- |
| beta.5（如有） |  |  |  |  |  |  |  |
| beta.6 默认配置 |  |  |  |  |  |  |  |

## 开发验证

Python 163 项、前端 57 项和 Rust 24 项通过，版本、TypeScript、Rust 格式/编译、前端构建与 Windows NSIS 构建通过；1 项真实桌面鼠标诊断按默认忽略。最终打包网关完成 12 组隔离检查，安装包校验一致，完整结果记录在 [beta.6 发布说明](../releases/v0.2.1-beta.6.md)。测试不会代替以上人工验收。本轮未操控桌面、未自动安装或启动 LAT、未加载模型测速；只进行了只读 GPU 采样以及隔离网关和构建验证。

## 反馈

| 项目 | 结果或复现步骤 | 模型、输入规模与实际耗时 |
| --- | --- | --- |
| 待用户填写 |  |  |

人工验收结论：待填写。推送 GitHub、PR 与预发布等待用户明确指令。

<!-- end-preserved-source:lat-performance-checklist.md -->

</details>
