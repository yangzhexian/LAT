# LAT — Local AI Translator

LAT 是面向 Windows 的本地 AI 翻译桌面应用。项目基于 Tauri 2、Python 本地网关和 llama.cpp 构建，针对 Tencent Hy-MT2 翻译模型提供模型管理、格式保护和输出质量检查能力。

LAT 默认在本机完成模型推理和文本处理，不将翻译内容发送至云端。模型权重和 llama.cpp 运行时不包含在安装包中，而是在首次使用时下载到用户指定的本地数据目录。

> 当前版本：`0.2.1-beta.8`（模型架构堆叠视图验收版）
>
> 当前 Windows 版本仅支持 NVIDIA CUDA 与 GGUF 模型。安装包不包含模型权重和运行时文件。

## 功能概览

- Windows 划词翻译：选中文字后点击浮标或按自定义快捷键，在独立浮窗中使用当前本地模型翻译
- UI Automation 原生取词优先，主动触发后可使用复制兜底；支持托盘驻留、暂停划词、浮窗固定及转入主窗口
- 自动发现本机已安装并通过校验的 Hy-MT2 GGUF 模型
- 从开始界面选择参数规模和量化版本
- 使用 GPU 总显存进行环境预检并提供推荐版本
- 自动下载和管理固定版本的 Windows CUDA llama.cpp 运行时
- 支持断点续传、备用下载源、网络重试、速度显示、取消下载和 SHA-256 校验
- 支持中文、英文、日文、韩文、法文、德文、俄文等 Hy-MT2 支持语言的互译
- 支持左右或上下排版，并可交换源语言与目标语言
- 左侧导航提供翻译、历史、模型与设置；关闭模型后保留当前工作区
- 翻译历史仅保存在本机 IndexedDB，默认保留最近 30 条及最多 64 MiB 内容，可选 10/30/50/100/200 条、16/32/64/128 MiB 或关闭新记录保存；支持全文搜索、语言/模型/来源筛选、20 条分页摘要、按需展开、恢复、删除、清空及 JSON/Markdown 完整导出
- 默认支持 100,000 字符长文本，按段落及上下文预算分段，显示已完成段数与原文处理进度
- 支持取消或失败后继续剩余分段；断点由本地网关在内存保留最多 1 小时、最近 8 个任务，退出应用后不保留；重复段落复用已校验译文
- 支持明暗主题、自动字体大小、合并换行及减少动态效果设置
- LaTeX 预览支持 `$...$`、`$$...$$`、`\(...\)` 和 `\[...\]`
- 使用本地 MathJax 渲染 LaTeX，预览字体采用 Times New Roman
- 翻译过程中显示推理进度和整数 tokens/s，完成后保留最终速度、耗时和生成 token 数
- 从应用启动持续采集 NVIDIA 整卡显存、利用率、功率和温度；模型页查看趋势，支持 0.5/1/2/5 秒采样及最近 1/2/5 分钟范围，切页和隐藏窗口不断采，退出后清空
- 模型页展示推理输入/输出/总 token、生成及输入处理速度、首 token 延迟、耗时和本次网关会话的累计用量；质量重试与长文分段分别计入实际模型调用，缺失的后端数据明确显示未知
- 模型页通过“模型推理 / GPU 硬件”选项卡选择看板；模型与架构页使用外侧页面滚动，避免嵌套滚动条
- 左侧“模型架构”将重复的 Transformer 结构合并为堆叠页面，前页仅展示所选一层的完整架构，层数标记与背页表示重复层；可切换真实层编号，进入 Attention/KV heads、FFN、Embedding、Output 和参数视图，保留主路及残差连线，分步骤教学动画支持暂停和减少动态效果，不表示实际权重数值或逐参数活动
- 架构页按模型保留层、模块、张量、参数视图、教学步骤和滚动位置，切页返回后从暂停状态继续；同一窗口会话最多记忆八个模型，模型结构变化时自动回到总览
- 关闭模型时终止 LAT 管理的 llama-server 并释放显存
- 提供 OpenAI 兼容接口，可供 nextai-translator 等客户端调用

## 划词翻译

1. 在设置中开启“划词翻译”，在主窗口启用一个已安装的模型。
2. 在 Chrome/Edge 网页或可选文本 PDF 中选中文字，点击附近的 LAT 浮标；也可按默认 `Ctrl+Alt+T`。快捷键可在设置中录制，冲突时保留原配置并显示错误。
3. 浮窗默认自动检测原文并译为中文，可切换并记忆目标语言、复制译文、查看 LaTeX、固定窗口或转入主窗口。
4. 首次启用时同时开启“关闭到托盘”；关闭主窗口会继续保留模型。使用托盘菜单“退出”可结束网关与模型并释放显存。托盘也可暂停划词监听。

划选本身只显示图标，主动触发后才运行本地翻译。UIA 取词失败时，启用“允许复制兜底”可以在主动操作后模拟一次复制；剪贴板格式无法安全保护、无选区或目标不支持时请手动复制并粘贴到浮窗。不会持续监听剪贴板。扫描 PDF/图片需要 OCR，不在本版范围内；管理员权限软件与自绘控件的取词能力受系统及目标程序限制。

浮窗最多直接翻译 5,000 个 Unicode 字符，更长内容可完整转入主窗口。主窗口内容替换前会确认。模型未启用时不会自动加载；主窗口正翻译长文时，浮窗显示排队位置，在通过校验的分段之间获得执行机会。关闭浮窗仅取消它自己的请求。完整成功结果遵守现有历史开关和容量设置，标记为“划词翻译”。

固定浮窗后再次划词会更新原文和译文，并保留你调整后的窗口位置与尺寸；取消固定后恢复跟随新选区定位。

本版将模型架构总览改为单层堆叠视图，详见 [beta.8 发布说明](docs/releases/v0.2.1-beta.8.md) 和 [模型架构浏览设计](docs/design/model-architecture.md)。历史检索、导航记忆与通用控件沿用 [第三轮设计](docs/design/history-navigation-round3.md)。所有版本继续共用一份 [统一验收清单](docs/acceptance/lat-acceptance-checklist.md)，旧勾选、原文样例与反馈保存在该文件的历史附录中。此前的 [运行时设计](docs/design/runtime-stability.md)、[第二轮性能设计](docs/design/performance-round2.md) 和 [推理看板数据口径](docs/design/inference-dashboard.md) 继续适用。

主窗口的 LaTeX 预览最多排版前 4,000 个 UTF-16 字符、40 个完整公式，遇到未闭合公式时在其前停止，并显示范围提示；“文本”视图、复制及历史始终保留全文。GPU 历史从网关启动持续采集，原生 NVML 不可用时自动使用较低频率的兼容采集，并显示实际周期。

beta.1 的用户验收记录已保留；beta.2 修复浮标首次点击、鼠标延迟与浮窗圆角，对应待复验项已并入 [统一验收清单](docs/acceptance/lat-acceptance-checklist.md)。划词兼容性反馈可查阅该清单中的历史附录，实现方式比较见 [技术设计](docs/design/selection-translation.md)。

历史容量以完整记录 JSON 的 UTF-8 字节数计算，包含原文、提交文本、译文和元数据，不等于 WebView 实际磁盘占用。达到任一上限会按时间删除最旧完整记录；单条超过容量时保留原库并提示保存失败。普通分页只读取短摘要，搜索关键词时按候选逐条扫描全文，导出时读取符合筛选条件的完整记录。升级时在同一事务中为旧记录建立摘要，失败会回滚；首次打开不自动裁剪既有超限记录，下一次成功保存或主动调整上限时再应用双上限，超限页面会提示先导出。失败保存队列只保留在当前窗口内存，关闭软件前应完成重试或另行复制需要保留的译文。

## 模型选择与推荐

LAT 当前支持 Tencent 官方 GGUF 仓库中的 Hy-MT2-1.8B 和 Hy-MT2-7B 变体。开始界面会读取 GPU 总显存，并按照模型文件、llama.cpp 缓冲区和常用翻译上下文预留保守余量。检测使用总显存，不使用当前空闲显存，因此不会因为其他程序短时占用显存而改变推荐结果。

| 模型 | 文件大小 | 建议总显存 | 适用场景 |
| --- | ---: | ---: | --- |
| Hy-MT2 1.8B · 1.25-bit | 0.43 GiB | 2 GiB | 极低资源和快速试用 |
| Hy-MT2 1.8B · 2-bit | 0.56 GiB | 2 GiB | 低资源设备 |
| Hy-MT2 1.8B · Q4_K_M | 1.06 GiB | 4 GiB | 轻量部署和常规翻译 |
| Hy-MT2 1.8B · Q6_K | 1.37 GiB | 4 GiB | 轻量部署下的质量优先选择 |
| Hy-MT2 1.8B · Q8_0 | 1.78 GiB | 5 GiB | 1.8B 高精度量化 |
| Hy-MT2 7B · Q4_K_M | 4.31 GiB | 8 GiB | 7B 质量与显存的平衡 |
| Hy-MT2 7B · Q6_K | 5.74 GiB | 10 GiB | 12 GiB 级显卡的默认推荐 |
| Hy-MT2 7B · Q8_0 | 7.43 GiB | 13 GiB | 16 GiB 及以上显卡的高精度选择 |

显存满足多个版本时，LAT 推荐其中质量排序最高的版本。以 12 GiB 总显存为例，默认推荐 Hy-MT2-7B Q6_K；Q8_0 会显示为超过保守建议值，但用户仍可在确认风险后继续下载。若检测不到 NVIDIA GPU，LAT 会显示提示并默认建议选择较小的 1.8B 版本。

报告第二版的量化实验显示，Hy-MT2-7B Q4_K_M 在 FLORES-200 的三个方向得分为 `88.96 / 91.46 / 86.90`，IFMTBench 得分为 `75.11`；Hy-MT2-1.8B Q4_K_M 对应为 `82.22 / 85.87 / 77.19` 和 `63.47`。报告没有单独给出 Q6_K 和 Q8_0 的 benchmark，因此 LAT 将它们作为同一参数规模下的高精度部署选项，不将推断结果冒充为官方 benchmark。

模型来源为 [Tencent 官方 Hugging Face 集合](https://huggingface.co/collections/tencent/hy-mt2)。当前每个模型都配置了官方 SHA-256，默认使用 `hf-mirror.com`，镜像不可用时再尝试官方 Hugging Face 源，备用源必须通过相同校验才能安装。

## 系统要求

运行已构建的 Windows 安装包：

- Windows 10 或更高版本
- NVIDIA GPU 与可用的 NVIDIA 驱动
- 建议至少 10 GiB GPU 总显存以使用 Hy-MT2-7B Q6_K
- 首次下载需要稳定的网络连接和足够的磁盘空间
- 模型权重和运行时不随安装包分发

从源代码开发或构建桌面端：

- Rust stable MSVC toolchain
- Node.js 22.13+ 或 24+（构建及前端测试）
- Python 3.10 或更高版本
- Windows SDK 与 Visual Studio C++ 构建工具

用户不需要预先安装 Ollama、CUDA Toolkit 或系统级 llama.cpp。LAT 会管理自身使用的 llama.cpp CUDA 运行时。

## 从源代码运行

### 运行本地网关

```powershell
git clone git@github.com:yangzhexian/LAT.git
Set-Location LAT

Copy-Item translator.config.example.json translator.config.json
$env:LAT_ADMIN_TOKEN = python -c "import secrets; print(secrets.token_urlsafe(32))"
python -m local_translator serve
```

网关默认监听 `http://127.0.0.1:8787`。从 beta.5 开始，手动启动必须设置 `LAT_ADMIN_TOKEN` 或本地配置的 `admin_token`；管理命令使用同一密钥。桌面版自动创建仅在本次运行有效的管理密钥，无需手动填写。`GET /health` 公开返回版本、协议版本和实例标识，其他数据及管理接口要求 Bearer 密钥。

### 运行 Tauri 开发版本

```powershell
npm install
python -m pip install -r requirements-build.txt
.\scripts\build-sidecar.ps1
npm run tauri dev
```

仅调试前端时，在已配置同一管理密钥的终端运行；先另行启动上述网关：

```powershell
$env:VITE_GATEWAY_TOKEN = $env:LAT_ADMIN_TOKEN
npm run dev
```

`VITE_GATEWAY_TOKEN` 仅用于本机 Vite 开发，不应写入提交或分发构建。Tauri 主窗口和划词浮窗从原生层获取会话，不把管理密钥写入本地存储。若主动复用手动启动的网关，应从配置了相同 `LAT_ADMIN_TOKEN` 的终端启动 Tauri；推荐使用上述随机生成的密钥。复用网关不归桌面进程所有，退出桌面不会关闭它。

### 首次使用流程

1. 启动 LAT 并等待网关完成初始化。
2. 在开始界面选择需要下载的 Hy-MT2 参数规模和量化版本。
3. 检查 GPU 总显存检测结果和推荐版本。
4. 可选展开“自定义模型路径”，输入或选择其他本地目录。
5. 点击“开始下载”，等待 llama.cpp 运行时和模型文件完成校验。
6. 在已安装模型列表中选择模型并点击“启用模型”。

## 构建 Windows 安装包

```powershell
python -m pip install -r requirements-build.txt
npm run build:installer
```

构建脚本会执行版本检查、构建 Python sidecar、构建前端和 Tauri NSIS 安装包，并在 `artifacts/v<version>/` 中生成安装包及 `SHA256SUMS.txt`。

本地构建生成的 sidecar、Tauri target、前端 dist、MathJax 运行时、模型权重和安装包均不应提交到 Git。

## 数据目录

默认数据目录为安装路径下的 `.lat-runtime`。也可以在开始界面展开“自定义模型路径”并选择其他目录：

```text
.lat-runtime/
├─ runtime/llama.cpp/b10545/
├─ models/
│  ├─ Hy-MT2-1.8B-Q4_K_M.gguf
│  └─ HY-MT2-7B-Q6_K.gguf
├─ downloads/
└─ logs/translator.log
```

应用关闭模型、退出应用或执行卸载时，会先停止由 LAT 管理的 gateway 和 llama-server。卸载流程会询问是否删除模型、llama.cpp 运行时、下载缓存和日志，默认保留用户数据。

## 配置

复制 `translator.config.example.json` 后，可以按需修改 `translator.config.json`：

| Key | 默认值 | 说明 |
| --- | --- | --- |
| `host` | `127.0.0.1` | 网关监听地址 |
| `port` | `8787` | 网关监听端口 |
| `model_name` | `hy-mt2-7b:q6_k` | 当前模型标识 |
| `runtime_root` | 空 | 运行时、模型和日志根目录 |
| `llama_runtime_variant` | `cuda-13.3` | Windows CUDA 运行时变体 |
| `llama_release` | `b10545` | 固定的 llama.cpp release |
| `temperature` | `0.7` | Hy-MT2 推荐温度 |
| `top_p` | `0.6` | Top-p 采样参数 |
| `top_k` | `20` | Top-k 采样参数 |
| `repetition_penalty` | `1.05` | 重复惩罚 |
| `num_ctx` | `8192` | 上下文长度 |
| `batch_size` / `ubatch_size` | `2048` / `512` | 输入逻辑批次与物理微批次；`LAT_BATCH_SIZE` / `LAT_UBATCH_SIZE` |
| `flash_attention` | `auto` | `auto`、`on` 或 `off`；`LAT_FLASH_ATTENTION` |
| `kv_cache_type` | `f16` | `f16` 或可选 `q8_0`，更改后重启模型；`LAT_KV_CACHE_TYPE` |
| `cache_prompt` | `true` | 复用模型输入公共前缀缓存；`LAT_CACHE_PROMPT` |
| `max_pending_translations` | `8` | 一个执行任务之外的等待名额，范围 1–32；`LAT_MAX_PENDING_TRANSLATIONS` |
| `queue_wait_timeout_seconds` | `120` | 每次等待推理机会的时限，超时保留已完成分段；`LAT_QUEUE_WAIT_TIMEOUT` |
| `max_output_tokens` | `4096` | 每段最大输出 token 数 |
| `max_input_chars` | `100000` | 整篇输入字符上限，可用 `LLM_TRANSLATOR_MAX_INPUT_CHARS` 覆盖 |
| `admin_token` | 空 | 手动网关管理密钥，可用 `LAT_ADMIN_TOKEN` 覆盖；桌面版自动设置 |
| `api_key` | 空 | 第三方翻译密钥，可用 `LAT_API_KEY` 覆盖；空值不允许第三方密钥访问 |
| `allowed_origins` | `[]` | 额外允许的明确 Origin，例如实际扩展的 `chrome-extension://<id>`；不支持通配符 |
| `connect_timeout_seconds` | `3` | 单次模型 HTTP 连接时限；`LAT_CONNECT_TIMEOUT` |
| `first_response_timeout_seconds` | `120` | 单次模型调用等待首条 SSE 数据的时限；`LAT_FIRST_RESPONSE_TIMEOUT` |
| `stream_idle_timeout_seconds` | `30` | 已开始响应后连续无数据的时限；`LAT_STREAM_IDLE_TIMEOUT` |
| `request_timeout_seconds` | `600` | 单次模型调用总时限，包含连接与等待；`LLM_TRANSLATOR_TIMEOUT` |

环境变量优先级高于配置文件：

```powershell
$env:LAT_MODEL = "hy-mt2-7b:q6_k"
$env:LAT_RUNTIME_ROOT = "D:\Tools\LAT\data"
$env:LAT_LLAMA_RUNTIME_VARIANT = "cuda-13.3"
$env:LLM_TRANSLATOR_PORT = "8787"
```

## OpenAI 兼容接口

启动网关前设置独立的 `LAT_API_KEY`，或在本地 `translator.config.json` 中配置 `api_key`，再完成模型安装。第三方密钥支持翻译、模型列表和取消自己创建的任务，不能修改数据目录、下载、卸载模型或关闭网关。在 nextai-translator 的 OpenAI 兼容服务中填写：

```text
API URL: http://127.0.0.1:8787/v1
API Key: 与 LAT_API_KEY / api_key 相同的值
Model: hy-mt2-7b:q6_k
```

旧版任意填写 `local` 的方式不再可用。带有 Origin 的客户端还需使用内置本地来源或配置 `allowed_origins`；没有 Origin 的本地客户端仍需 Bearer 密钥。管理密钥与第三方密钥应使用不同的随机值。

`stream: true` 在每段通过质量与格式校验后增量发送该段译文；不会把尚未校验的模型 token 或提示词直接送给客户端。`stream_options: {"include_usage": true}` 请求最终用量，计数包括实际分段、重试及同一任务的续译调用，重复段缓存不增加调用用量。计数缺失时，非流式响应省略 `usage`，流式最终用量为 `null`，不会用零冒充测量结果。

主要接口：

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /translate`
- `POST /translate/stream`
- `GET /admin/status`
- `GET /admin/environment?model=<model-id>`
- `GET /admin/runtime/status`
- `POST /admin/directory`
- `POST /admin/download`
- `POST /admin/download/cancel`
- `POST /admin/load`
- `POST /admin/unload`

## 命令行控制

```powershell
# 查看网关、llama.cpp 和模型状态
python -m local_translator status

# 关闭模型并释放显存
.\scripts\unload-translator-model.ps1

# 停止网关和模型进程
.\scripts\stop-translator.ps1

# 执行一次本地翻译
python -m local_translator translate --to English "你好，世界。"
```

## 测试与质量检查

```powershell
python -m unittest discover -s tests -v
npm run check:version
npm run typecheck
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

测试覆盖网关路由、提示词解析、格式和 LaTeX 保护、输出质量检查、SSE 流式翻译、下载器断点续传、网络重试、模型完整性确认以及 GPU 总显存推荐逻辑。

## 项目结构

```text
local_translator/       Python 网关、下载器、客户端和运行时管理
src/features/           模型安装与翻译工作区
src/lib/                API、设置、语言和文本处理工具
src-tauri/              Tauri 2 Rust 工程、sidecar 和安装配置
scripts/                sidecar、安装包、版本检查和控制脚本
tests/                  Python 自动化测试
public/                 前端静态资源和 LAT 图标
docs/releases/          GitHub Release 说明
translator.config.example.json
                        可提交的配置模板
```

## Git 提交约定

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```text
feat(model): add hardware-aware Hy-MT2 variants
fix(ui): align dark theme scrollbars
fix(runtime): stop managed process during uninstall
docs(readme): document model selection
```

不要提交以下本机或构建生成内容：

- `.lat-runtime/`
- `translator.config.json`
- `*.gguf`、`*.zip`
- `node_modules/`、`dist/`、`build/`
- `src-tauri/target/`
- `src-tauri/binaries/*.exe`
- `public/mathjax/` 中生成的 MathJax 文件
- `artifacts/` 中的安装包和校验文件

## 故障排查

### 下载停留在 0.0%

新版本会读取响应头中的文件大小，并显示当前文件序号、总文件数和 MiB/s。网络中断时下载器会保留 `.part` 文件并自动重试；重新连接后会尝试使用 HTTP Range 从断点继续。主源失败后会切换到备用镜像。

“终止下载”会请求网关停止当前任务并保留已下载的临时数据。若需要关闭应用，先点击“终止下载”，等待状态变为已取消，再关闭窗口。应用退出时也会尝试终止网关和 llama-server。

### 模型启动失败

确认所选数据目录可写并具有足够磁盘空间，确认 NVIDIA 驱动可用，并查看 `logs/translator.log`。如果选定模型的总显存建议值高于 GPU 总显存，优先改用更小的参数规模或更低量化版本。

### 翻译内容包含 prompt 或结果被截断

LAT 会使用 Hy-MT2 官方翻译指令模板，并对 URL、代码占位符和 LaTeX 公式进行保护。若输出仍包含指令文本，网关会执行质量检查并在允许时安全重试。长文档由网关自动分段；超出模型预算的失败段最多细分两层。取消或失败的部分结果不会写入完整翻译历史。

## 参考资料

- [Hy-MT2 Technical Report v2](https://arxiv.org/html/2605.22064v2)
- [Hy-MT2 官方 GitHub 仓库](https://github.com/Tencent-Hunyuan/Hy-MT2)
- [Hy-MT2 官方 GGUF 模型集合](https://huggingface.co/collections/tencent/hy-mt2)
- [Hy-MT2-7B-GGUF](https://huggingface.co/tencent/Hy-MT2-7B-GGUF)
- [llama.cpp](https://github.com/ggml-org/llama.cpp)
- [nextai-translator](https://github.com/nextai-translator/nextai-translator)
- [Tauri 2](https://tauri.app/)

## License

LAT 以 MIT 许可证发布，详见 [LICENSE](LICENSE)。

## 长文本事件接口

`POST /translate/stream` 和 `POST /translate` 可附加 `require_ready: true`，要求仅使用已启用模型，模型未就绪时返回 `model_not_ready`；省略时保留既有行为。JSON 错误对象增加 `error.code`，SSE 错误事件增加 `code`，可用于区分 `translation_busy`、`model_not_ready` 与其他失败，原状态码和消息字段保留。

`POST /translate/stream` 保留原请求字段，新增 `plan`、`segment_complete` 事件。`completed_chars / total_chars` 表示已经通过校验的原文比例，`completed_chunks / total_chunks` 表示分段进度；运行时细分可能增加总段数，原文比例不回退。`segment_complete.translation` 只包含本段译文；`complete.translation` 包含整篇译文。客户端仅收到 `complete` 后才应视为成功。

实时速度是估算值，最终指标使用模型计数和包含重试的总耗时。关闭 SSE 或普通 JSON 翻译连接都会取消对应任务并关闭上游模型连接；等待响应头或首条输出期间也可取消，无需等待下一条 token。连接、首响应、流空闲和单次调用总时限分别受控，实际显存回收与取消延迟需在本机模型上验收。

`GET /admin/status` 返回 `max_input_chars`、`lifecycle`、`lifecycle_error` 和 `runtime_instance_id`。翻译中不允许加载、切换或卸载模型以及修改数据目录，管理冲突返回 HTTP 409 / `model_busy`。`/translate` 和 OpenAI 兼容接口共用分段引擎，均需要上述鉴权；客户端须与协议版本 2 的网关配套。

历史保存在当前 WebView 的 `lat.history` 数据库中，不随模型目录迁移，也不进行云同步。开发浏览器和安装版使用各自的本地存储。

前端逻辑回归测试：`npm run test:frontend`。

人工检查统一使用 [LAT 验收清单](docs/acceptance/lat-acceptance-checklist.md)。其中当前版本项目由用户填写，历史附录原样保留此前六份清单的勾选与反馈；开发自动测试不代替人工验收。
