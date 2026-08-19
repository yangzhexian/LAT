# LAT — Local AI Translator

LAT 是一个面向 Windows 的本地 AI 翻译桌面应用。它基于 Tauri 2、Python 本地网关和 Ollama，针对 Hy-MT2 7B 翻译模型进行提示词、公式保护和输出质量控制优化。

模型和翻译内容都留在本机，不调用云端翻译服务。

> **当前状态：0.1.1 Beta**
>
> Beta 版本正在快速迭代，界面、配置和模型下载流程可能发生变化。安装包不包含 Ollama 或任何模型文件。

## Features

- 本地 Ollama 模型自动发现和启用
- hy-mt2-7b:q6_k 下载入口和实时下载进度
- 下载前通过 nvidia-smi 检查 GPU 显存
- 显存不足时提示风险并建议更小量化模型
- 中文、英文、日文、韩文、法文、德文、俄文等语言互译
- 左右或上下翻译排版，并支持交换语言和内容
- 自动字体大小和合并换行设置
- 明暗主题切换
- LaTeX 文本预览，支持 $...$、$$...$$、\(...\) 和 \[...\]
- LaTeX 预览使用本地 MathJax 和 Times New Roman 风格字体
- 实时显示翻译进度、tokens/s 和生成 token 数
- 关闭模型时释放显存
- 关闭应用或卸载应用时清理 hy-mt2-gateway.exe 后台进程
- 为 nextai-translator 提供 OpenAI 兼容接口

## Architecture

~~~text
LAT Desktop (Tauri 2)
        │
        ▼
Local Python Gateway
        │
        ▼
Ollama ── Hy-MT2 7B
~~~

Python 网关负责管理 Ollama 生命周期、抽取翻译请求、保护 URL/代码/占位符/LaTeX 公式，并在模型输出异常时进行质量检查和安全重试。

## Developer preview

稳定基线位于 master 分支。模型下载功能位于：

~~~text
feature/model-download-preflight
~~~

该分支的开始界面支持下载 hy-mt2-7b:q6_k。下载前会检测 GPU 环境；RTX 5070 等显存满足建议值的设备可以直接继续，显存不足或当前占用过高时会显示警告和替代模型建议。

## Requirements

- Windows 10 或更新版本
- [Ollama](https://ollama.com/)
- Rust stable MSVC toolchain（仅开发和构建桌面端需要）
- Node.js 18 或更新版本（仅开发和构建桌面端需要）
- Python 3.10 或更新版本
- NVIDIA GPU 用户建议安装 nvidia-smi，用于下载前显存预检

## Run from source

### Gateway only

~~~powershell
git clone git@github.com:yangzhexian/LAT.git
cd LAT

Copy-Item translator.config.example.json translator.config.json
python -m local_translator serve
~~~

网关默认监听 http://127.0.0.1:8787，Ollama 默认地址为 http://127.0.0.1:11434。

如果 Ollama 不在 PATH 中，可以在未提交的 translator.config.json 中设置：

~~~json
{
  "ollama_executable": "C:/Users/<用户名>/AppData/Local/Programs/Ollama/ollama.exe",
  "model_name": "hy-mt2-7b:q6_k"
}
~~~

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

### Beta model download branch

~~~powershell
git switch feature/model-download-preflight
npm install
python -m pip install pyinstaller
.\scripts\build-sidecar.ps1
npm run tauri dev
~~~

打开应用后，在开始界面点击“检测环境并下载”。下载完成后 LAT 会自动加载模型并进入翻译工作区。

## Build Windows installer

~~~powershell
python -m pip install pyinstaller
.\scripts\build-sidecar.ps1
npm run tauri build
~~~

当前 Beta 安装包版本为 0.1.1-beta.1。生成文件位于：

~~~text
src-tauri/target/release/bundle/nsis/
~~~

构建过程会生成不纳入 Git 的 sidecar、Tauri target、前端 dist 和 MathJax 运行时文件。

## Configuration

复制配置模板后，可以按需修改 translator.config.json：

| Key | Default | Description |
| --- | --- | --- |
| host | 127.0.0.1 | 网关监听地址 |
| port | 8787 | 网关监听端口 |
| ollama_url | http://127.0.0.1:11434 | Ollama API 地址 |
| model_name | hy-mt2-7b:q6_k | 默认模型名称 |
| keep_alive | 10m | 模型保持加载时间 |
| temperature | 0.2 | 默认推理温度 |
| top_p | 0.6 | Top-p 采样参数 |
| top_k | 20 | Top-k 采样参数 |
| num_ctx | 8192 | 上下文长度 |
| max_output_tokens | 4096 | 最大输出 token 数 |

环境变量可以覆盖配置文件，例如：

~~~powershell
$env:OLLAMA_TRANSLATOR_MODEL = "hy-mt2-7b:q6_k"
$env:LLM_TRANSLATOR_PORT = "8787"
~~~

## nextai-translator compatibility

启动网关后，在 nextai-translator 的 OpenAI 兼容服务中填写：

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
- POST /admin/download
- POST /admin/load
- POST /admin/unload

## Command line controls

~~~powershell
# 查看网关、Ollama 和模型状态
python -m local_translator status

# 卸载模型但保留 Ollama 服务
.\unload-translator-model.ps1

# 停止网关
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
local_translator/       Python 网关、Ollama 客户端和翻译质量策略
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

- models/ollama/
- .ollama-runtime/
- translator.config.json
- node_modules/、dist/、build/
- src-tauri/target/
- src-tauri/binaries/*.exe
- public/mathjax/ 中生成的 MathJax 文件

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

~~~text
feat(model): add Ollama model download preflight
fix(uninstall): stop gateway sidecar before removal
docs(readme): document beta setup
~~~

更多提交约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## Troubleshooting

### Ollama 未运行

确认 Ollama 已安装并运行，或让网关自动启动 Ollama。也可以在 translator.config.json 中配置 ollama_executable。

### 找不到模型

执行：

~~~powershell
ollama list
~~~

然后将准确的模型名称写入 model_name。LAT 同时兼容 hy-mt2-7b:q6_k 和 hy-mt2-7b-q6_k。

### 模型下载前显存警告

这是 Beta 版本的保护性检查，不会上传任何硬件信息。关闭占用 GPU 的程序、卸载其他 Ollama 模型，或选择更小的 Q4/Q5 量化模型后再重试。

### 卸载后仍有 gateway 进程

使用最新 Beta 安装包。NSIS 卸载器会在删除文件前终止 hy-mt2-gateway.exe 进程树；如果旧版本仍在运行，先关闭 LAT 或重新启动 Windows 后再卸载。

## References

- [Hy-MT2 技术报告](https://arxiv.org/html/2605.22064)
- [Hy-MT2 官方模型说明](https://github.com/Tencent-Hunyuan/Hy-MT2)
- [Ollama API](https://github.com/ollama/ollama/blob/main/docs/api.md)
- [nextai-translator](https://github.com/nextai-translator/nextai-translator)
- [Tauri 2](https://tauri.app/)

## License

LAT 当前尚未选择开源许可证。正式对外发布前，请在仓库中加入 LICENSE 文件并明确授权范围。
