# LAT — Local AI Translator

这是一个面向 Windows + Ollama + Hy-MT2 7B 的本地翻译网关。它不调用云端模型，专门解决两个问题：

1. 翻译网关启动时自动检测并按需启动 Ollama，退出时卸载模型并关闭由网关创建的 Ollama 进程。
2. 不把 nextai-translator 传来的整段提示词原样交给模型，而是抽取目标语言和待翻译文本，使用 Hy-MT2 的专用任务模板；返回前清理标签、思维内容和 prompt 泄漏，并对异常结果自动重试一次。

## 快速开始

在 PowerShell 中执行：

```powershell
cd D:\github-repo\LLM-Translate
Copy-Item translator.config.example.json translator.config.json
.\start-translator.ps1
```

如果 `hy-mt2-7b:q6_k` 在你的 Ollama 中使用了其他名称，把 `translator.config.json` 的 `model_name` 改成 `ollama list` 显示的准确名称。仓库中的 Ollama manifest 使用的是 `hy-mt2-7b:q6_k`；项目也会兼容尝试 `hy-mt2-7b-q6_k`。

若 Ollama 不在 PATH 中，在配置里填写：

```json
"ollama_executable": "C:/Users/<用户名>/AppData/Local/Programs/Ollama/ollama.exe"
```

示例配置中的路径为空，方便提交到 GitHub。只有本机需要覆盖默认自动发现时，才在未提交的 `translator.config.json` 中填写路径。

## nextai-translator 配置

启动网关后也可以直接打开 `http://127.0.0.1:8787/`，使用自带的本地翻译页面和模型控制按钮。

在 nextai-translator 的 OpenAI 兼容服务配置中填写：

- API URL：`http://127.0.0.1:8787/v1`
- API Key：任意非空值，例如 `local`
- Model：`hy-mt2-7b:q6_k`

网关支持 `/v1/chat/completions`、`/v1/models`，也支持 `stream: true` 的 SSE 返回。流式响应会在完整结果通过质量检查后发送，因此不会把中间的 prompt 泄漏给客户端。

## 控制 Ollama 和模型

```powershell
# 查看网关、Ollama、已加载模型
python -m local_translator status

# 只卸载模型显存，保留 Ollama 服务，适合稍后继续翻译
.\unload-translator-model.ps1

# 停止网关；如果 Ollama 是网关自动启动的，也会一起退出
.\stop-translator.ps1

# 单次命令行翻译（不需要先手动启动网关）
python -m local_translator translate --to English "你好，世界。"
```

也可以直接调用专用接口：

```powershell
$body = @{ text = '你好，世界。'; target_language = 'English' } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:8787/translate -Method Post -ContentType 'application/json' -Body $body
```

## 默认推理策略

默认使用 `top_p=0.6`、`top_k=20`、`repetition_penalty=1.05`、固定 `seed=42`、`num_ctx=8192`，并将温度保守设置为 `0.2` 以减少桌面划词翻译中的随机性。技术报告给出的 7B 推荐温度是 `0.7`；如果要复现实验建议，可把配置中的 `temperature` 改为 `0.7`。

输入中的 URL、HTML 标签、代码片段、占位符、`@mention` 和 `#hashtag` 会先替换为保护标记，返回时恢复。模型输出包含任务标签、重复内容或异常长文本时，网关会用更严格的零温度提示重试一次，仍不合格才返回错误。

## 开发与测试

本项目运行时只依赖 Python 标准库：

```powershell
python -m unittest discover -s tests -v
```

## Tauri 桌面端

桌面端前端位于 `src/`，Tauri 2 工程位于 `src-tauri/`。开发阶段可以先启动现有 Python 网关，再运行：

```powershell
npm install
python -m local_translator serve
npm run dev
```

构建 sidecar 需要 Rust host target 和 PyInstaller：

```powershell
python -m pip install pyinstaller
.\scripts\build-sidecar.ps1
npm run tauri build
```

安装包不包含 Ollama 模型；桌面端启动后通过 Ollama `/api/tags` 自动发现本机模型。Tauri 的 sidecar 只负责启动翻译网关，模型仍由本机 Ollama 管理。

### 参考资料

- [Hy-MT2 技术报告](https://arxiv.org/html/2605.22064)
- [Hy-MT2 官方推理示例与模型说明](https://github.com/Tencent-Hunyuan/Hy-MT2)
- [Ollama API：chat、keep_alive、卸载模型](https://github.com/ollama/ollama/blob/main/docs/api.md)
- [nextai-translator](https://github.com/nextai-translator/nextai-translator)

## GitHub Beta 发布准备

仓库只提交源代码、配置模板、测试和 LAT 图标，不提交本机模型与构建产物。以下内容由 `.gitignore` 排除：

- `models/ollama/` 和 `.ollama-runtime/`
- `translator.config.json`
- `node_modules/`、`dist/`、`build/`、`src-tauri/target/`
- `src-tauri/binaries/` 中生成的 sidecar 可执行文件
- `public/mathjax/` 中由安装脚本复制的 MathJax 运行时文件

上传前建议执行：

```powershell
python -m unittest discover -s tests -v
npm install
npm run build
```

Windows 安装包还需要先运行 `scripts/build-sidecar.ps1`，再运行 `npm run tauri build`。安装包不会包含 Ollama 模型，用户需要自行安装 Ollama 和模型，或使用模型下载功能分支中的下载入口。
