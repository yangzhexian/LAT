import { useRef, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function Button({ className = "secondary-button", type = "button", ...props }: ComponentProps<"button">) {
  return <button type={type} className={className} {...props} />;
}

export function DangerButton(props: ComponentProps<"button">) {
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

export function Notice({ children, tone = "info", className = "" }: { children: ReactNode; tone?: "info" | "error"; className?: string }) {
  return <div className={`ui-notice ui-notice-${tone} ${className}`} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}

export function EmptyState({ title, children, action, className = "" }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return <div className={`ui-empty-state ${className}`}>
    <p className="ui-empty-title">{title}</p>
    {children && <div className="ui-empty-description">{children}</div>}
    {action && <div className="ui-empty-action">{action}</div>}
  </div>;
}

export interface TabOption<T extends string> { value: T; label: ReactNode; disabled?: boolean }

// The owning view supplies matching `${id}-${value}-panel` tab panels.
export function Tabs<T extends string>({ id, label, value, options, onChange, className = "" }: {
  id: string; label: string; value: T; options: readonly TabOption<T>[];
  onChange: (value: T) => void; className?: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
  const selected = options.findIndex((option) => option.value === value && !option.disabled);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const current = enabled.indexOf(index);
    if (current < 0 || !enabled.length) return;
    const destination = event.key === "ArrowRight" ? (current + 1) % enabled.length
      : event.key === "ArrowLeft" ? (current - 1 + enabled.length) % enabled.length
        : event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : null;
    if (destination === null) return;
    event.preventDefault();
    const target = enabled[destination];
    onChange(options[target].value);
    buttons.current[target]?.focus();
  }
  return <div className={`ui-tabs ${className}`} role="tablist" aria-label={label}>
    {options.map((option, index) => <Button key={option.value} className="ui-tab" role="tab"
      id={`${id}-${option.value}-tab`} aria-controls={`${id}-${option.value}-panel`}
      aria-selected={value === option.value} disabled={option.disabled}
      tabIndex={index === (selected >= 0 ? selected : enabled[0]) ? 0 : -1}
      ref={(button) => { buttons.current[index] = button; }}
      onClick={() => onChange(option.value)} onKeyDown={(event) => navigate(event, index)}>{option.label}</Button>)}
  </div>;
}
