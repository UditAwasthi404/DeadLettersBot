import { Button } from "@radix-ui/themes";
import * as React from "react";

export type AppButtonProps = React.ComponentProps<typeof Button>;

export function AppButton({ className, variant, size, ...props }: AppButtonProps) {
  const primary = className?.split(/\s+/).includes("primary") ?? false;
  return (
    <Button
      {...props}
      className={className}
      variant={variant ?? (primary ? "solid" : "ghost")}
      size={size ?? "2"}
    />
  );
}