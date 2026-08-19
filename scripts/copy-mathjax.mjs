import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/mathjax/es5/tex-chtml.js");
const destination = resolve(root, "public/mathjax/tex-chtml.js");
const fontSource = resolve(root, "node_modules/mathjax/es5/output/chtml/fonts/woff-v2");
const fontDestination = resolve(root, "public/mathjax/output/chtml/fonts/woff-v2");

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
await mkdir(fontDestination, { recursive: true });
for (const file of await readdir(fontSource)) {
  if (file.endsWith(".woff")) await copyFile(resolve(fontSource, file), resolve(fontDestination, file));
}
console.log(`Copied MathJax bundle and local fonts to ${destination}`);
