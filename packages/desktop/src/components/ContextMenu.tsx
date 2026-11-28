import { ContextMenu as RadixContextMenu } from "@radix-ui/themes";
import type { ReactElement } from "react";
import type { MenuItem } from "./Menu.tsx";
import { Kbd } from "./Kbd.tsx";

export type ContextMenuProps = { children: ReactElement; items: readonly MenuItem[]; label?: string };
export function ContextMenu({ children, items, label = "Actions" }: ContextMenuProps) {
  return <RadixContextMenu.Root>
    <RadixContextMenu.Trigger>{children}</RadixContextMenu.Trigger>
    <RadixContextMenu.Content aria-label={label} className="aos-menu">
      {items.map((item) => <RadixContextMenu.Group key={item.id}>
        {item.separatorBefore && <RadixContextMenu.Separator className="aos-menu-separator" />}
        <RadixContextMenu.Item className={`aos-menu-item${item.danger ? " aos-menu-item--danger" : ""}`} disabled={item.disabled} onSelect={item.onSelect}>
          {item.icon && <span aria-hidden="true" className="aos-menu-icon">{item.icon}</span>}{item.label}{item.shortcut && <Kbd>{item.shortcut}</Kbd>}
        </RadixContextMenu.Item>
      </RadixContextMenu.Group>)}
    </RadixContextMenu.Content>
  </RadixContextMenu.Root>;
}
export default ContextMenu;
