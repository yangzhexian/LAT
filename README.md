# LAT — Local AI Translator

LAT 是面向 Windows 的本地 AI 翻译桌面应用。项目基于 Tauri 2、Python 本地网关和 llama.cpp 构建，针对 Tencent Hy-MT2 翻译模型提供模型管理、格式保护和输出质量检查能力。

LAT 默认在本机完成模型推理和文本处理，不将翻译内容发送至云端。模型权重和 llama.cpp 运行时不包含在安装包中，而是在首次使用时下载到用户指定的本地数据目录。

> 当前版本：`0.2.0-beta.2`
>
> 当前 Windows 版本仅支持 NVIDIA CUDA 与 GGUF 模型。安装包不包含模型权重和运行时文件。

## 功能概览

- 自动发现本机已安装并通过校验的 Hy-MT2 GGUF 模型
- 从开始界面选择参数规模和量化版本
- 使用 GPU 总显存进行环境预检并提供推荐版本
- 自动下载和管理固定版本的 Windows CUDA llama.cpp 运行时
- 支持断点续传、备用下载源、网络重试、速度显示、取消下载和 SHA-256 校验
- 支持中文、英文、日文、韩文、法文、德文、俄文等 Hy-MT2 支持语言的互译
- 支持左右或上下排版，并可交换源语言与目标语言
- 左侧导航提供翻译、历史、模型与设置；关闭模型后保留当前工作区
- 翻译历史仅保存在本机 IndexedDB，默认保留最近 30 条，可选 10/30/50/100/200 条或关闭新记录保存，支持恢复、删除和清空
- 默认支持 100,000 字符长文本，按段落及上下文预算分段，显示已完成段数与原文处理进度
- 支持取消或失败后继续剩余分段；断点由本地网关在内存保留最多 1 小时、最近 8 个任务，退出应用后不保留；重复段落复用已校验译文
- 支持明暗主题、自动字体大小、合并换行及减少动态效果设置
- LaTeX 预览支持 `$...$`、`$$...$$`、`\(...\)` 和 `\[...\]`
- 使用本地 MathJax 渲染 LaTeX，预览字体采用 Times New Roman
- 翻译过程中显示推理进度和整数 tokens/s，完成后保留最终速度、耗时和生成 token 数
- 模型运行后可查看显存、利用率、功率和温度趋势图；显示 NVIDIA 整卡指标，支持刷新间隔与时间范围设置
- 关闭模型时终止 LAT 管理的 llama-server 并释放显存
- 提供 OpenAI 兼容接口，可供 nextai-translator 等客户端调用

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
python -m local_translator serve
```

网关默认监听 `http://127.0.0.1:8787`。

### 运行 Tauri 开发版本

```powershell
npm install
python -m pip install -r requirements-build.txt
.\scripts\build-sidecar.ps1
npm run tauri dev
```

仅调试前端时可以运行：

```powershell
npm run dev
```

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
| `max_output_tokens` | `4096` | 每段最大输出 token 数 |
| `max_input_chars` | `100000` | 整篇输入字符上限，可用 `LLM_TRANSLATOR_MAX_INPUT_CHARS` 覆盖 |

环境变量优先级高于配置文件：

```powershell
$env:LAT_MODEL = "hy-mt2-7b:q6_k"
$env:LAT_RUNTIME_ROOT = "D:\Tools\LAT\data"
$env:LAT_LLAMA_RUNTIME_VARIANT = "cuda-13.3"
$env:LLM_TRANSLATOR_PORT = "8787"
```

## OpenAI 兼容接口

启动网关并完成模型安装后，在 nextai-translator 的 OpenAI 兼容服务中填写：

```text
API URL: http://127.0.0.1:8787/v1
API Key: local
Model: hy-mt2-7b:q6_k
```

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

`POST /translate/stream` 保留原请求字段，新增 `plan`、`segment_complete` 事件。
`completed_chars / total_chars` 表示已经通过校验的原文比例，`completed_chunks / total_chunks` 表示分段进度；运行时细分可能增加总段数，原文比例不回退。
`segment_complete.translation` 只包含本段译文；`complete.translation` 包含整篇译文。客户端仅收到 `complete` 后才应视为成功。
实时速度是估算值，最终指标使用模型计数和包含重试的总耗时。关闭 SSE 连接会清理上游推理连接；预填充阶段的取消可能等待下一次模型输出。
`GET /admin/status` 新增 `max_input_chars`。现有 `/translate` 和 OpenAI 兼容响应结构保持兼容，共用分段引擎。

历史保存在当前 WebView 的 `lat.history` 数据库中，不随模型目录迁移，也不进行云同步。开发浏览器和安装版使用各自的本地存储。

前端逻辑回归测试：`npm run test:frontend`。

本轮本地验收说明和人工检查项见 [毛玻璃与长文本验收清单](docs/acceptance/lat-ui-longtext-checklist.md)。
