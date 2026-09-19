const FORMULA_PATTERNS = [
  /\$\$[\s\S]*?\$\$/g,
  /\\\[[\s\S]*?\\\]/g,
  /\\\([\s\S]*?\\\)/g,
  /(?<!\$)\$(?!\$)[^\n$]+?(?<!\\)\$(?!\$)/g,
];

function protectFormulas(value: string): { text: string; formulas: Map<string, string> } {
  const formulas = new Map<string, string>();
  let text = value;
  let index = 0;
  for (const pattern of FORMULA_PATTERNS) {
    text = text.replace(pattern, (formula) => {
      const token = `\uE000FORMULA${index++}\uE001`;
      formulas.set(token, formula);
      return token;
    });
  }
  return { text, formulas };
}

function restoreFormulas(value: string, formulas: Map<string, string>): string {
  let result = value;
  for (const [token, formula] of formulas) result = result.replaceAll(token, () => formula);
  return result;
}

function joinLines(lines: string[]): string {
  return lines.reduce((result, line, index) => {
    if (index === 0) return line;
    const left = result.at(-1) ?? "";
    const right = line.at(0) ?? "";
    const cjk = /[\u3400-\u9fff]/;
    return result + (cjk.test(left) || cjk.test(right) ? "" : " ") + line;
  }, "");
}

export function normalizeForTranslation(value: string, removeLineBreaks: boolean): string {
  if (!removeLineBreaks) return value;
  const protectedText = protectFormulas(value.replaceAll("\r\n", "\n"));
  const paragraphs = protectedText.text.split(/\n\s*\n/);
  const normalized = paragraphs
    .map((paragraph) => joinLines(paragraph.split("\n").map((line) => line.trim()).filter(Boolean)))
    .filter(Boolean)
    .join("\n\n");
  return restoreFormulas(normalized, protectedText.formulas);
}

export function formatBytes(value?: number): string {
  if (!value) return "未知大小";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  let size = value;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}
