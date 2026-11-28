import { Children, isValidElement, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock.tsx";

export type MarkdownProps = { content: string; onError?: (error: unknown) => void; className?: string };
export function safeExternalUrl(href: string | undefined): string | undefined {
  if (!href || !/^https?:\/\//i.test(href) || /[\u0000-\u0020\u007f]/.test(href)) return undefined;
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function Markdown({ content, onError, className = "" }: MarkdownProps) {
  const [linkError, setLinkError] = useState(false);
  return <div className={`aos-markdown ${className}`}>
    <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} urlTransform={(url) => safeExternalUrl(url) ?? ""} components={{
      a: ({ href, children }) => {
        const url = safeExternalUrl(href);
        return url ? <a href={url} rel="noopener noreferrer" onClick={async (event) => {
          event.preventDefault();
          try {
            if (!window.agentOS?.openExternal) throw new Error("External links require AgentOS.");
            await window.agentOS.openExternal(url); setLinkError(false);
          } catch (error) { setLinkError(true); onError?.(error); }
        }}>{children}</a> : <span>{children}</span>;
      },
      img: ({ alt }) => <span className="aos-field-hint">{alt ? `[Image: ${alt}]` : "[Image]"}</span>,
      pre: ({ children }) => {
        const child = Children.toArray(children)[0];
        if (!isValidElement<{ children?: ReactNode; className?: string }>(child)) return <pre>{children}</pre>;
        const language = /language-([\w+-]+)/.exec(child.props.className ?? "")?.[1] ?? "text";
        const code = Children.toArray(child.props.children).join("").replace(/\n$/, "");
        return <CodeBlock code={code} language={language} />;
      },
    }}>{content}</ReactMarkdown>
    {linkError && <p role="alert" className="aos-field-error">Could not open the external link.</p>}
  </div>;
}
export default Markdown;
