import { LatexPreview } from "../../components/LatexPreview";
import { LanguageSelect } from "./LanguageSelect";

interface TextPaneProps {
  title: string;
  language: string;
  value: string;
  preview: boolean;
  fontSize: number;
  readOnly?: boolean;
  onLanguageChange: (value: string) => void;
  onChange?: (value: string) => void;
  onPreviewChange: (value: boolean) => void;
  onSubmit?: () => void;
}

export function TextPane({
  title,
  language,
  value,
  preview,
  fontSize,
  readOnly,
  onLanguageChange,
  onChange,
  onPreviewChange,
  onSubmit,
}: TextPaneProps) {
  return (
    <section className="text-pane">
      <header className="pane-header">
        <div>
          <span className="pane-title">{title}</span>
          <LanguageSelect value={language} onChange={onLanguageChange} />
        </div>
        <div className="pane-actions">
          <button
            type="button"
            className={"mini-button " + (!preview ? "active" : "")}
            onClick={() => onPreviewChange(false)}
          >
            文本
          </button>
          <button
            type="button"
            className={"mini-button " + (preview ? "active" : "")}
            onClick={() => onPreviewChange(true)}
          >
            LaTeX 预览
          </button>
        </div>
      </header>
      {preview ? (
        <LatexPreview value={value} />
      ) : (
        <textarea
          className="text-editor"
          style={{ fontSize }}
          value={value}
          readOnly={readOnly}
          onChange={(event) => onChange?.(event.target.value)}
          onKeyDown={(event) => {
            if (!readOnly && onSubmit && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder={readOnly ? "译文会显示在这里" : "输入或粘贴需要翻译的文本"}
          spellCheck={false}
        />
      )}
    </section>
  );
}
