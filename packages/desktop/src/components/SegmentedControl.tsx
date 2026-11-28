import { useRef, type ReactNode } from "react";

export type SegmentOption<Value extends string = string> = { value: Value; label: string; icon?: ReactNode; disabled?: boolean };
export type SegmentedControlProps<Value extends string = string> = {
  label: string;
  value: Value;
  options: readonly SegmentOption<Value>[];
  onValueChange: (value: Value) => void;
  disabled?: boolean;
  className?: string;
};
export const THEME_CHOICES = [
  { value: "light", label: "Light" }, { value: "system", label: "System" }, { value: "dark", label: "Dark" },
] as const;

export function SegmentedControl<Value extends string>({ label, value, options, onValueChange, disabled, className = "" }: SegmentedControlProps<Value>) {
  const buttons = useRef(new Map<Value, HTMLButtonElement>());
  const enabled = options.filter((option) => !option.disabled && !disabled);
  const tabValue = enabled.some((option) => option.value === value) ? value : enabled[0]?.value;
  return <div role="radiogroup" aria-label={label} className={`aos-segmented ${className}`}>
    {options.map((option) => <button key={option.value} type="button" role="radio" aria-checked={value === option.value}
      disabled={disabled || option.disabled} tabIndex={option.value === tabValue ? 0 : -1}
      ref={(element) => { if (element) buttons.current.set(option.value, element); else buttons.current.delete(option.value); }}
      className="aos-segment" onClick={() => onValueChange(option.value)}
      onKeyDown={(event) => {
        const index = enabled.findIndex((item) => item.value === option.value);
        let next: SegmentOption<Value> | undefined;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") next = enabled[(index + 1) % enabled.length];
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = enabled[(index - 1 + enabled.length) % enabled.length];
        if (event.key === "Home") next = enabled[0];
        if (event.key === "End") next = enabled[enabled.length - 1];
        if (next) { event.preventDefault(); buttons.current.get(next.value)?.focus(); onValueChange(next.value); }
      }}><span aria-hidden="true">{option.icon}</span>{option.label}</button>)}
  </div>;
}
export default SegmentedControl;
