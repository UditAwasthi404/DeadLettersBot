import { Component, type ErrorInfo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function MarkdownBody({
  content,
  onError,
}: {
  content: string;
  onError: (error: unknown) => void;
}) {
  const text = typeof content === "string" ? content : String(content ?? "");
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            rel="noreferrer noopener"
            onClick={(event) => {
              event.preventDefault();
              if (href && /^https?:\/\//i.test(href))
                void window.agentOS.openExternal(href).catch(onError);
            }}
          >
            {children}
          </a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

class MarkdownErrorBoundary extends Component<
  { content: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("assistant markdown failed", error, info.componentStack);
  }

  componentDidUpdate(prevProps: { content: string }): void {
    if (prevProps.content !== this.props.content && this.state.failed)
      this.setState({ failed: false });
  }

  render() {
    if (this.state.failed) return <pre className="markdown-fallback">{this.props.content}</pre>;
    return this.props.children;
  }
}

export function AssistantMarkdown({
  content,
  onError,
}: {
  content: string;
  onError: (error: unknown) => void;
}) {
  const text = typeof content === "string" ? content : String(content ?? "");
  return (
    <MarkdownErrorBoundary content={text}>
      <MarkdownBody content={text} onError={onError} />
    </MarkdownErrorBoundary>
  );
}

export default AssistantMarkdown;
