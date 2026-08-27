# LAT — Local AI Translator

LAT 是一个面向 Windows 的本地 AI 翻译桌面应用。它基于 Tauri 2、Python 本地网关和 llama.cpp，针对 Hy-MT2 7B 翻译模型进行提示词、公式保护和输出质量控制优化。

模型和翻译内容都留在本机，不调用云端翻译服务。

> 当前状态：0.1.1 Beta
>
> 安装包不包含模型权重和 llama.cpp。首次使用时，LAT 会在用户选择的本地目录中自动下载并校验它们。

## Features

- 无需单独安装 Ollama
- 自动安装和管理 Windows NVIDIA CUDA 版 llama.cpp
- 下载官方 Hy-MT2-7B-GGUF Q6_K 权重
- 下载前通过 nvidia-smi 检查 GPU 显存
- 显存不足时提示风险并建议更小模型
- 中文、英文、日文、韩文、法文、德文、俄文等语言互译
- 左右或上下翻译排版，并支持交换语言和内容
- 自动字体大小和合并换行设置
- 明暗主题切换
- LaTeX 文本预览，支持 $...$、$$...$$、\(...\) 和 \[...\]
- LaTeX 预览使用本地 MathJax 和 Times New Roman 风格字体
- 实时显示翻译进度、tokens/s 和生成 token 数
- 关闭模型时停止 llama-server 并释放显存
- 关闭应用或卸载应用时清理 gateway 和 llama-server 进程
- 为 nextai-translator 提供 OpenAI 兼容接口

## Architecture

~~~text
LAT Desktop (Tauri 2)
        │
        ▼
Local Python Gateway
        │
        ▼
Managed llama.cpp server ── Hy-MT2-7B-GGUF Q6_K
~~~

Python 网关负责管理 llama.cpp 生命周期、下载和校验运行时与模型、抽取翻译请求、保护 URL/代码/占位符/LaTeX 公式，并在模型输出异常时进行质量检查和安全重试。

## Requirements

- Windows 10 或更新版本
- NVIDIA GPU 和可用的 NVIDIA 驱动
- RTX 5070 推荐总显存至少为 10 GiB
- Rust stable MSVC toolchain（仅开发和构建桌面端需要）
- Node.js 18 或更新版本（仅开发和构建桌面端需要）
- Python 3.10 或更新版本（仅开发和构建桌面端需要）

用户不需要预先安装 Ollama、CUDA Toolkit 或 llama.cpp。

## Run from source

### Gateway only

~~~powershell
git clone git@github.com:yangzhexian/LAT.git
cd LAT

Copy-Item translator.config.example.json translator.config.json
python -m local_translator serve
~~~

网关默认监听 http://127.0.0.1:8787。首次使用时调用下载接口，或直接运行桌面端，在下载卡片下方展开“自定义模型路径”后安装运行时和模型。

### Tauri desktop app

~~~powershell
npm install
python -m pip install pyinstaller
.\scripts\build-sidecar.ps1
npm run tauri dev
~~~

如果只需要运行前端调试页面：

~~~powershell
npm run dev
~~~

打开应用后：

1. 可选展开“自定义模型路径”，输入或选择一个有足够空间且可写的本地目录
2. 点击“开始下载”
3. LAT 显示文件总数并下载 llama.cpp CUDA 运行时
4. LAT 下载并校验 Hy-MT2 Q6_K 权重
5. 点击启用模型进入翻译工作区

## Build Windows installer

~~~powershell
python -m pip install pyinstaller
.\scripts\build-sidecar.ps1
npm run tauri build
~~~

当前 Beta 安装包版本为 0.1.1-beta.4。生成文件位于：

~~~text
src-tauri/target/release/bundle/nsis/
~~~

构建过程会生成不纳入 Git 的 sidecar、Tauri target、前端 dist 和 MathJax 运行时文件。

## Runtime and model storage

默认目录为安装路径下的 .lat-runtime。桌面端可以在下载卡片下方自定义其他目录，例如：

~~~text
D:\Tools\LAT\data\
├─ runtime\llama.cpp\b10545\
├─ models\HY-MT2-7B-Q6_K.gguf
├─ downloads\
└─ logs\
~~~

模型文件默认来自 Tencent 官方 Hugging Face 仓库，主源不可用时会自动切换到 hf-mirror.com。两个地址都会使用同一个官方 SHA-256 校验值，运行时来自 llama.cpp Releases。下载会进行断点续传、SHA-256 校验和原子安装。ModelScope 上也存在 Unsloth 发布的 Q6_K 文件，但其 SHA-256 与 Tencent 官方文件不同，当前不会将其静默当作同一模型。

## Configuration

复制配置模板后，可以按需修改 translator.config.json：

| Key | Default | Description |
| --- | --- | --- |
| host | 127.0.0.1 | 网关监听地址 |
| port | 8787 | 网关监听端口 |
| runtime_root | 空 | llama.cpp 和模型数据目录 |
| llama_runtime_variant | cuda-13.3 | Windows CUDA 运行时变体 |
| llama_release | b10545 | 固定的 llama.cpp Release |
| model_name | hy-mt2-7b:q6_k | 模型标识 |
| temperature | 0.7 | Hy-MT2 推荐温度 |
| top_p | 0.6 | Top-p 采样参数 |
| top_k | 20 | Top-k 采样参数 |
| repetition_penalty | 1.05 | 重复惩罚 |
| num_ctx | 8192 | 上下文长度 |
| max_output_tokens | 4096 | 最大输出 token 数 |

环境变量可以覆盖配置文件：

~~~powershell
$env:LAT_RUNTIME_ROOT = "D:\Tools\LAT\data"
$env:LAT_LLAMA_RUNTIME_VARIANT = "cuda-13.3"
$env:LLM_TRANSLATOR_PORT = "8787"
~~~

## nextai-translator compatibility

启动网关并完成模型安装后，在 nextai-translator 的 OpenAI 兼容服务中填写：

~~~text
API URL: http://127.0.0.1:8787/v1
API Key: local
Model: hy-mt2-7b:q6_k
~~~

支持的接口包括：

- GET /v1/models
- POST /v1/chat/completions
- POST /translate
- POST /translate/stream
- GET /admin/status
- GET /admin/environment
- GET /admin/runtime/status
- POST /admin/directory
- POST /admin/download
- POST /admin/download/cancel
- POST /admin/load
- POST /admin/unload

## Command line controls

~~~powershell
# 查看网关、llama.cpp 和模型状态
python -m local_translator status

# 关闭模型并释放显存
.\unload-translator-model.ps1

# 停止网关和模型进程
.\stop-translator.ps1

# 执行一次本地翻译
python -m local_translator translate --to English "你好，世界。"
~~~

## Tests

项目使用 Python 标准库测试网关、提示词解析、输出质量检查、SSE 流式翻译、模型下载进度和 GPU 环境预检：

~~~powershell
python -m unittest discover -s tests -v
npm run typecheck
npm run build
~~~

## Repository layout

~~~text
local_translator/       Python 网关、llama.cpp 客户端和翻译质量策略
src/                    Tauri 前端和翻译工作区
src-tauri/              Tauri 2 Rust 工程、图标和 NSIS hooks
scripts/                sidecar 和 MathJax 构建脚本
tests/                  Python 自动化测试
public/                 前端静态资源和 LAT 图标
translator.config.example.json
                        可提交的配置模板
~~~

## Repository hygiene

仓库提交源代码、测试、构建脚本、配置模板和图标，不提交本机环境：

- .lat-runtime/
- models/
- *.gguf
- *.zip
- translator.config.json
- node_modules/、dist/、build/
- src-tauri/target/
- src-tauri/binaries/*.exe
- public/mathjax/ 中生成的 MathJax 文件

提交信息遵循 Conventional Commits：

~~~text
feat(runtime): add managed llama.cpp runtime
feat(model): download official Hy-MT2 GGUF weights
fix(branding): make LAT icon T white
docs(readme): document Ollama-free setup
~~~

更多提交约定见 CONTRIBUTING.md。

## Troubleshooting

### llama.cpp 运行时安装失败

确认目标目录可写并至少有约 8 GB 临时空间。LAT 会校验官方压缩包 SHA-256，校验失败时会删除未完成文件并允许重新下载。

### 下载进度为 runtime · downloading 0.0%

旧版本的运行时压缩包没有声明预估大小，前端因此只能显示 0.0%。新版本会从响应头读取运行时文件总大小并显示当前文件/总文件数量、百分比和 MiB/s。下载过程会保留 `.part` 文件，遇到 WinError 10061、超时或连接中断时会自动断点重连并最多重试 5 次。

下载卡片中的“终止下载”会通知网关停止当前任务并保留 `.part` 文件；如果应用需要立即退出，也可以直接关闭窗口，Tauri 会先请求网关停止，再结束 sidecar。下次启动时可以重新点击下载，已完成的临时文件会继续复用。模型下载完成后还必须收到“全部文件下载并校验完成”事件，并通过运行时和模型 SHA-256 校验，LAT 才会启动模型。主下载源连接失败时会自动切换到 hf-mirror.com。
### GPU 显存警告

Hy-MT2-7B Q6_K 权重约 6.16 GB，LAT 预检使用 GPU 总显存而不是当前可用显存。总显存低于 10 GiB 时建议改用更小的 Hy-MT2 模型。

### 模型启动失败

查看所选数据目录下的 logs/translator.log。首版只支持 Windows NVIDIA CUDA，且使用包含 Hy-MT2 所需 STQ kernel 支持的 llama.cpp Release。

### 卸载后仍有后台进程

使用最新 Beta 安装包。LAT 关闭模型、退出应用和卸载前都会停止 gateway 及其管理的 llama-server 进程。若旧版本进程仍在运行，请先关闭旧版 LAT 后再卸载。

## References

- Hy-MT2 技术报告：https://arxiv.org/html/2605.22064
- Hy-MT2 官方仓库：https://github.com/Tencent-Hunyuan/Hy-MT2
- Hy-MT2-7B-GGUF：https://huggingface.co/tencent/Hy-MT2-7B-GGUF
- llama.cpp：https://github.com/ggml-org/llama.cpp
- nextai-translator：https://github.com/nextai-translator/nextai-translator
- Tauri 2：https://tauri.app/

## License

LAT 当前尚未选择开源许可证。正式对外发布前，请在仓库中加入 LICENSE 文件并明确授权范围。