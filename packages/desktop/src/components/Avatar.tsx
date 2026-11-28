import { useState } from "react";

export type AvatarProps = { name: string; src?: string; size?: "sm" | "md"; className?: string };
export function Avatar({ name, src, size = "md", className = "" }: AvatarProps) {
  const [failedSource, setFailedSource] = useState<string>();
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0] ?? "").join("").toLocaleUpperCase() || "?";
  return <span role="img" aria-label={name} className={`aos-avatar aos-avatar--${size} ${className}`}>
    {src && src !== failedSource ? <img src={src} alt="" onError={() => setFailedSource(src)} /> : <span aria-hidden="true">{initials}</span>}
  </span>;
}
export default Avatar;
