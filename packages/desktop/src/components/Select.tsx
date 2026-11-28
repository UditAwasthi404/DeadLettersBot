import { Select as RadixSelect } from "@radix-ui/themes";
import { useId } from "react";

export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectProps = {
  label: string;
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  size?: "sm" | "md";
  className?: string;
};
export function Select({ label, options, placeholder = "Choose…", size = "md", className = "", ...props }: SelectProps) {
  const id = useId();
  return <div className={`aos-field ${className}`}>
    <label className="aos-field-label" htmlFor={id}>{label}</label>
    <RadixSelect.Root {...props}>
      <RadixSelect.Trigger id={id} aria-label={label} placeholder={placeholder} className={`aos-select aos-control--${size}`} />
      <RadixSelect.Content className="aos-select-content" position="popper">
        {options.map((option) => <RadixSelect.Item key={option.value} value={option.value} disabled={option.disabled} className="aos-menu-item">{option.label}</RadixSelect.Item>)}
      </RadixSelect.Content>
    </RadixSelect.Root>
  </div>;
}
export default Select;
