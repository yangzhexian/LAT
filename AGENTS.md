# Repository Guidelines

## Project Structure & Architecture

LAT is a Windows desktop translator built with a React/Vite UI, a Python local gateway, Tauri 2, and a managed llama.cpp sidecar.

- `src/` contains the TypeScript/React UI. Feature code is under `src/features/`, shared API/settings/language helpers are in `src/lib/`, and reusable UI components are in `src/components/`.
- `local_translator/` contains the Python gateway, model/runtime management, downloader, prompt handling, quality checks, and CLI. `gateway_entry.py` is the packaging entry point.
- `src-tauri/` contains the Rust/Tauri shell, capabilities, installer configuration, and sidecar integration. Build and process-control helpers live in `scripts/`.
- `tests/` contains Python tests; `docs/` contains release documentation. Keep generated output (`dist/`, `build/`, `artifacts/`, `.lat-runtime/`, `models/`, and `*.gguf`) out of commits.

## Build, Test, and Development Commands

Use PowerShell from the repository root:

- `npm ci` installs the locked frontend dependencies.
- `Copy-Item translator.config.example.json translator.config.json` creates local configuration, then `python -m local_translator serve` starts the gateway at `127.0.0.1:8787`.
- `python -m pip install -r requirements-build.txt; .\scripts\build-sidecar.ps1; npm run tauri dev` builds the Python sidecar and starts the desktop app. `npm run dev` runs only the Vite UI.
- `npm run build` runs MathJax preparation, TypeScript checks, and the Vite production build. `npm run build:installer` creates the Windows NSIS installer.
- Every new version must run `npm run build:installer`; the installer and `SHA256SUMS.txt` are written to `artifacts/v<version>`. Keep these generated artifacts out of commits.

## Coding Style & Testing Guidelines

Match nearby TypeScript/React and Python formatting; use `PascalCase` for components, `camelCase` for TypeScript values/functions, and `snake_case` for Python names. Format Rust with `rustfmt`. Add focused tests beside the behavior they cover; Python test modules use `tests/test_*.py`. Before a PR, run `npm run check:version`, `npm run test:python`, `npm run typecheck`, `npm run build`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, `cargo check --manifest-path src-tauri/Cargo.toml`, and `cargo test --manifest-path src-tauri/Cargo.toml`.

## Commits and Pull Requests

Use Conventional Commits with a scope, matching recent history: `feat(model): add ...`, `fix(metrics): align ...`, `docs(readme): ...`, or `chore(release): ...`. Keep changes focused. PRs should explain behavior and configuration changes, link related issues when applicable, include screenshots for UI changes, and report the checks run.

After each completed modification, create a Conventional Commit for the change unless the user explicitly asks not to commit. Keep the commit focused and use a concise, descriptive subject.

## Configuration and Security

Keep `translator.config.json` local and never commit credentials or machine-specific paths. Model weights, runtime binaries, logs, installers, and generated MathJax files are local build/runtime data. Preserve the local-first behavior: translation content and model processing should remain on the user machine unless the design explicitly changes.
