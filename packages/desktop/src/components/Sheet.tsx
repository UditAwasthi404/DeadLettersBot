import { Dialog, type DialogProps } from "./Dialog.tsx";

export type SheetProps = DialogProps & { side?: "left" | "right" };
export function Sheet({ side = "right", className = "", ...props }: SheetProps) {
  return <Dialog {...props} className={`aos-sheet aos-sheet--${side} ${className}`} />;
}
export default Sheet;
