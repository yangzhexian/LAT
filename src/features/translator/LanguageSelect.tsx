import { LANGUAGES } from "../../lib/languages";

interface LanguageSelectProps {
  value: string;
  onChange: (value: string) => void;
}

export function LanguageSelect({ value, onChange }: LanguageSelectProps) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {LANGUAGES.map((language) => (
        <option key={language.code} value={language.code}>
          {language.label} · {language.name}
        </option>
      ))}
    </select>
  );
}
