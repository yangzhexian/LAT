# Release process

LAT 的发布版本必须在 package.json、package-lock.json、Tauri、Cargo 和 Python 网关中保持一致。

## Prepare

1. 更新版本号和 CHANGELOG.md。
2. 将对应版本的发布说明放入 docs/releases。
3. 安装锁定依赖并运行全部检查。

~~~powershell
npm ci
python -m pip install -r requirements-build.txt
npm run check:version
npm run test:python
npm run typecheck
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
~~~

## Build

~~~powershell
npm run build:installer
~~~

脚本会构建 PyInstaller sidecar 和 Tauri NSIS 安装包，并把安装包与 SHA256SUMS.txt 放到 artifacts/v版本号。

## Publish

1. 审查安装包名称、文件大小和 SHA-256。
2. 使用 Conventional Commits 提交发布准备变更。
3. 推送提交并创建带 v 前缀的版本标签。
4. 在 GitHub 创建 prerelease，粘贴对应发布说明并上传 artifacts 目录中的两个文件。
5. 在干净的 Windows 环境完成首次安装、模型下载、翻译、升级和卸载冒烟测试后再公开草稿。

正式开源发布前仍需由仓库所有者选择并添加 LICENSE；不要在未确认授权范围时自动添加许可证。
