import { MathJax } from "better-react-mathjax";

interface LatexPreviewProps {
  value: string;
}

export function LatexPreview({ value }: LatexPreviewProps) {
  return (
    <div className="latex-preview" aria-label="LaTeX 预览">
      {value ? <MathJax dynamic>{value}</MathJax> : <span className="empty-hint">暂无内容</span>}
    </div>
  );
}
