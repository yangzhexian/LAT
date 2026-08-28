import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(root, path), "utf8");

const packageJson = JSON.parse(await read("package.json"));
const packageLock = JSON.parse(await read("package-lock.json"));
const tauriConfig = JSON.parse(await read("src-tauri/tauri.conf.json"));
const cargoToml = await read("src-tauri/Cargo.toml");
const cargoLock = await read("src-tauri/Cargo.lock");
const pythonVersion = await read("local_translator/version.py");

const cargoVersion = cargoToml.match(
  /^\[package\][\s\S]*?^version = "([^"]+)"/m,
)?.[1];
const cargoLockVersion = cargoLock.match(
  /\[\[package\]\]\r?\nname = "hy-mt2-local-translator"\r?\nversion = "([^"]+)"/,
)?.[1];
const gatewayVersion = pythonVersion.match(/__version__ = "([^"]+)"/)?.[1];
const expected = packageJson.version;

const versions = {
  "package-lock.json": packageLock.version,
  "package-lock root package": packageLock.packages?.[""]?.version,
  "src-tauri/tauri.conf.json": tauriConfig.version,
  "src-tauri/Cargo.toml": cargoVersion,
  "src-tauri/Cargo.lock": cargoLockVersion,
  "local_translator/version.py": gatewayVersion,
};

const mismatches = Object.entries(versions).filter(([, version]) => version !== expected);
if (mismatches.length) {
  for (const [source, version] of mismatches) {
    console.error(source + ": expected " + expected + ", found " + (version || "<missing>"));
  }
  process.exitCode = 1;
} else {
  console.log("Version " + expected + " is synchronized across all manifests.");
}
