import type { HTMLAttributes } from "react";
export function Kbd({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <kbd {...props} className={`aos-kbd ${className}`} />;
}
export default Kbd;
