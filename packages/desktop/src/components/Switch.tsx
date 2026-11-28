import { Switch as RadixSwitch } from "@radix-ui/themes";
import { forwardRef, useId, type ComponentPropsWithoutRef } from "react";

export type SwitchProps = Omit<ComponentPropsWithoutRef<typeof RadixSwitch>, "size"> & { label: string; description?: string };
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { label, description, id, className = "", ...props }, ref,
) {
  const generatedId = useId();
  const switchId = id ?? generatedId;
  return <div className="aos-switch-field">
    <RadixSwitch {...props} id={switchId} ref={ref} className={`aos-switch ${className}`}
      aria-describedby={[props["aria-describedby"], description ? `${switchId}-description` : undefined].filter(Boolean).join(" ") || undefined} />
    <div><label className="aos-field-label" htmlFor={switchId}>{label}</label>
      {description && <p className="aos-field-hint" id={`${switchId}-description`}>{description}</p>}
    </div>
  </div>;
});
export default Switch;
