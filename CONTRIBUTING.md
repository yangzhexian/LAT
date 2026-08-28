# Contributing

LAT 的提交信息使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式。

常用类型：

- feat: 新功能
- fix: 修复问题
- docs: 文档变更
- refactor: 重构
- test: 测试变更
- chore: 构建或维护变更

示例：

~~~text
feat(runtime): add managed llama.cpp runtime
fix(ui): align LAT application icon
~~~

提交前请运行：

~~~powershell
npm run check:version
npm run test:python
npm run typecheck
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
~~~
