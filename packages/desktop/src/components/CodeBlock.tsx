import { Check, Copy, WrapText } from "lucide-react";
import { useState } from "react";
import { IconButton } from "./IconButton.tsx";

export type CodeBlockProps = { code: string; language?: string; defaultWrap?: boolean; onCopyError?: (error: unknown) => void; className?: string };
export function CodeBlock({ code, language = "text", defaultWrap = false, onCopyError, className = "" }: CodeBlockProps) {
  const [wrap, setWrap] = useState(defaultWrap);
  const [copiedCode, setCopiedCode] = useState<string>();
  const [copyError, setCopyError] = useState(false);
  const copied = copiedCode === code;
  return <div className={`aos-code-block ${className}`}>
    <div className="aos-code-toolbar"><span>{language}</span><div className="aos-inline">
      <IconButton size="sm" label={wrap ? "Disable code wrapping" : "Wrap code"} aria-pressed={wrap} onClick={() => setWrap(!wrap)}><WrapText /></IconButton>
      <IconButton size="sm" label={copied ? "Copy code again" : "Copy code"} onClick={async () => {
        try { await navigator.clipboard.writeText(code); setCopiedCode(code); setCopyError(false); }
        catch (error) { setCopyError(true); onCopyError?.(error); }
      }}>{copied ? <Check /> : <Copy />}</IconButton>
    </div></div>
    <pre tabIndex={0} aria-label={`${language} code`} className={wrap ? "aos-code--wrap" : ""}><code>{code}</code></pre>
    <span className={copyError ? "aos-field-error" : "aos-sr-only"} role="status">{copyError ? "Could not copy code. Select the code and copy it manually." : copied ? "Code copied" : ""}</span>
  </div>;
}
export default CodeBlock;
