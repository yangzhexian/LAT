import { memo, useDeferredValue, useMemo } from "react";
import { LatexPreview } from "../../components/LatexPreview";
import { boundedPreview } from "../../lib/previewText";

const MemoizedLatexPreview = memo(LatexPreview);

export const BoundedLatexPreview = memo(function BoundedLatexPreview({ value }: { value: string }) {
  const deferredValue = useDeferredValue(value);
  const preview = useMemo(() => boundedPreview(deferredValue), [deferredValue]);
  return <>
    {preview.truncated && <p className="empty-hint" role="note">预览仅显示前 {preview.text.length.toLocaleString()} 个字符（最多 4,000 字符、40 个公式；未闭合公式暂不渲染）。完整内容保留在“文本”中，可全选复制。</p>}
    <MemoizedLatexPreview value={preview.text} />
  </>;
});
