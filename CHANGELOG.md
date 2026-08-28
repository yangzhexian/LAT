# Changelog

本文件记录 LAT 的用户可见变更。版本采用语义化版本，并在 Beta 阶段使用预发布后缀。

## Unreleased

## 0.1.1-beta.6 - 2026-08-28

### Added

- 内置管理 Windows NVIDIA CUDA 版 llama.cpp，无需预装 Ollama。
- 首次启动可下载、断点续传并校验官方 Hy-MT2-7B Q6_K 模型。
- 下载前检查 NVIDIA GPU 总显存，并在配置不足时提示风险。
- 新增下载取消、备用镜像、文件级进度与完成校验。
- 新增 Windows CI、版本一致性检查、安装包校验和与 Beta 发布流程。

### Changed

- 将 Python 网关拆分为模型清单、下载器、HTTP 客户端和进程管理模块。
- 将前端拆分为模型安装、翻译工作区、设置和持久化设置模块。
- sidecar 使用独立构建目录，不再与 Vite 的 dist 目录混用。
- 安装和卸载默认保留模型数据，并允许用户明确选择清理。

### Fixed

- 下载完成事件现在只在全部文件校验通过后发送。
- 主下载源失败时会切换到校验值一致的备用镜像。
- 翻译完成后保留 tokens/s、耗时和生成 token 数。
- 修复关闭应用、更新或卸载时 gateway 与 llama-server 进程残留。
- 支持 Ctrl+Enter 启动翻译，并兼容 CRLF 格式的 SSE 数据。

### Removed

- 删除 Ollama Modelfile、Ollama 运行时忽略规则及无效配置字段。
- 删除未使用的前端管理 API、旧样式和冗余启动脚本。

## 0.1.1-beta.1 - 2026-08-19

- 首个公开 Beta 安装包。
