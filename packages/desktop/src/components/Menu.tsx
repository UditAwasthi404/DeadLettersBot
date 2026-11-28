import { DropdownMenu } from "@radix-ui/themes";
import type { ReactElement, ReactNode } from "react";
import { Kbd } from "./Kbd.tsx";

export type MenuItem = { id: string; label: string; icon?: ReactNode; shortcut?: string; disabled?: boolean; danger?: boolean; separatorBefore?: boolean; onSelect: () => void };
export type MenuProps = { trigger: ReactElement; items: readonly MenuItem[]; label?: string; open?: boolean; onOpenChange?: (open: boolean) => void };
export function Menu({ trigger, items, label, open, onOpenChange }: MenuProps) {
  return <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
    <DropdownMenu.Trigger>{trigger}</DropdownMenu.Trigger>
    <DropdownMenu.Content className="aos-menu" aria-label={label}>
      {label && <DropdownMenu.Label className="aos-menu-label">{label}</DropdownMenu.Label>}
      {items.map((item) => <DropdownMenu.Group key={item.id}>
        {item.separatorBefore && <DropdownMenu.Separator className="aos-menu-separator" />}
        <DropdownMenu.Item className={`aos-menu-item${item.danger ? " aos-menu-item--danger" : ""}`} disabled={item.disabled} onSelect={item.onSelect}>
          {item.icon && <span aria-hidden="true" className="aos-menu-icon">{item.icon}</span>}{item.label}{item.shortcut && <Kbd>{item.shortcut}</Kbd>}
        </DropdownMenu.Item>
      </DropdownMenu.Group>)}
    </DropdownMenu.Content>
  </DropdownMenu.Root>;
}
export default Menu;
