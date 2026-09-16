import { useId, useRef, useState } from "react";
import { LANGUAGES } from "../../lib/languages";
import { Icon } from "../../components/Icon";

interface LanguageSelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function LanguageSelect({ value, onChange, disabled }: LanguageSelectProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const id = useId();
  const selected = LANGUAGES.find((language) => language.code === value);
  const languages = LANGUAGES.filter((language) => `${language.label} ${language.name} ${language.code}`.toLowerCase().includes(query.trim().toLowerCase()));
  function choose(code: string) { onChange(code); dialog.current?.close(); }
  return <>
    <button type="button" className="language-trigger" disabled={disabled} aria-haspopup="dialog" onClick={() => {
      setQuery(""); setCursor(Math.max(0, LANGUAGES.findIndex((language) => language.code === value)));
      dialog.current?.showModal(); search.current?.focus();
    }}>
      <span>{selected?.label || value}<small>{selected?.name}</small></span><Icon name="chevron" />
    </button>
    <dialog ref={dialog} className="language-dialog" aria-labelledby={id + "-title"} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="language-dialog-body">
        <header className="settings-header"><div><p className="settings-kicker">LANGUAGE</p><h2 id={id + "-title"}>选择语言</h2></div>
          <button type="button" className="icon-button" aria-label="关闭语言选择" onClick={() => dialog.current?.close()}><Icon name="close" /></button></header>
        <input ref={search} className="language-search" placeholder="搜索语言 · Search languages" aria-label="搜索语言" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls={id + "-list"} aria-activedescendant={languages[cursor] ? id + "-" + languages[cursor].code : undefined}
          value={query} onChange={(event) => { setQuery(event.target.value); setCursor(0); }} onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); const next = Math.max(0, Math.min(languages.length - 1, cursor + (event.key === "ArrowDown" ? 1 : -1))); setCursor(next);
              document.getElementById(id + "-" + languages[next]?.code)?.scrollIntoView({ block: "nearest" });
            }
            if (event.key === "Enter" && languages[cursor]) { event.preventDefault(); choose(languages[cursor].code); }
          }} />
        <div className="language-options" role="listbox" id={id + "-list"} aria-label="可选语言">
          {languages.map((language, index) => <button key={language.code} id={id + "-" + language.code} type="button" role="option" aria-selected={language.code === value} className={"language-option " + (index === cursor ? "highlighted" : "")} onClick={() => choose(language.code)}>
            <span>{language.label}<small>{language.name}</small></span>{language.code === value && <Icon name="check" />}
          </button>)}
        </div>
        {!languages.length && <p className="empty-hint">未找到匹配语言</p>}
        <p className="settings-note">↑ ↓ 选择 · Enter 确认 · Esc 关闭</p>
      </div>
    </dialog>
  </>;
}
