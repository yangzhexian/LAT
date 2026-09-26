import { useRef, useState } from "react";
import { Button } from "./Controls";

export function ShortcutField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  return <div className="shortcut-setting">
    <label className="setting-select"><span>翻译快捷键<small>使用 Ctrl / Alt 与字母、数字或功能键组合</small></span>
      <input ref={input} aria-label="翻译快捷键" readOnly value={recording ? "请按组合键…" : value}
        onBlur={() => setRecording(false)} onKeyDown={(event) => {
          if (!recording) return;
          event.preventDefault(); event.stopPropagation();
          if (event.key === "Escape") { setRecording(false); return; }
          const key = /^(Key[A-Z]|Digit[0-9])$/.test(event.code) ? event.code.replace(/^(Key|Digit)/, "") : /^F([1-9]|1[0-9]|2[0-4])$/.test(event.key) ? event.key : "";
          if (!key) return;
          if (!event.ctrlKey && !event.altKey) { setError("请同时按住 Ctrl 或 Alt"); return; }
          onChange([event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", key].filter(Boolean).join("+"));
          setError(""); setRecording(false);
        }} />
    </label>
    <div className="shortcut-actions"><Button onClick={() => { setRecording(true); setError(""); input.current?.focus(); }}>录制快捷键</Button>
      <Button onClick={() => { onChange("Ctrl+Alt+T"); setError(""); }}>恢复默认</Button></div>
    {(recording || error) && <p className="settings-note" role="status">{error || "按 Esc 取消录制"}</p>}
  </div>;
}
