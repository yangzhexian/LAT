import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function Button({ className = "secondary-button", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={className} {...props} />;
}

export function DangerButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <Button {...props} className={"secondary-button danger-button " + (props.className || "")} />;
}

export function Switch({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="setting-toggle"><span>{label}{hint && <small>{hint}</small>}</span>
    <span className="switch-control"><input aria-label={label} role="switch" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="switch-track" aria-hidden="true"><span /></span></span>
  </label>;
}

export function OptionGroup<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string; icon: IconName }[]; onChange: (value: T) => void }) {
  return <div className="preference-options" role="group" aria-label={label}>{options.map((option) =>
    <Button key={option.value} className="preference-pill" aria-pressed={value === option.value} onClick={() => onChange(option.value)}><Icon name={option.icon} /><span>{option.label}</span></Button>)}</div>;
}

export function SelectField({ label, hint, value, onChange, children }: { label: string; hint?: string; value: number; onChange: (value: number) => void; children: ReactNode }) {
  return <label className="setting-select"><span>{label}{hint && <small>{hint}</small>}</span><select value={value} onChange={(event) => onChange(Number(event.target.value))}>{children}</select></label>;
}
