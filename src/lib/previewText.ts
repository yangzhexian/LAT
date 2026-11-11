export const PREVIEW_CHAR_LIMIT = 4000;
const PREVIEW_FORMULA_LIMIT = 40;

// Scan only the bounded prefix; never pass an unfinished formula to MathJax.
export function boundedPreview(value: string): { text: string; truncated: boolean } {
  let end = Math.min(value.length, PREVIEW_CHAR_LIMIT);
  if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
  let opening = -1;
  let closing = "";
  let formulas = 0;
  for (let index = 0; index < end;) {
    if (closing && index + closing.length <= end && value.startsWith(closing, index)) {
      index += closing.length;
      closing = "";
      opening = -1;
      if (++formulas >= PREVIEW_FORMULA_LIMIT) { end = index; break; }
      continue;
    }
    if (!closing) {
      const delimiter = value.startsWith("$$", index) ? "$$" : value.startsWith("\\[", index) ? "\\[" : value.startsWith("\\(", index) ? "\\(" : value[index] === "$" ? "$" : "";
      if (delimiter) {
        opening = index;
        closing = delimiter === "\\[" ? "\\]" : delimiter === "\\(" ? "\\)" : delimiter;
        index += delimiter.length;
        continue;
      }
    }
    index += value[index] === "\\" ? 2 : 1;
  }
  if (opening >= 0) end = opening;
  return { text: value.slice(0, end), truncated: end < value.length };
}
