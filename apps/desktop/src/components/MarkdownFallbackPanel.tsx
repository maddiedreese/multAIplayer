import { Copy, X } from "lucide-react";

export function MarkdownFallbackPanel({
  title,
  markdown,
  onRetryCopy,
  onDismiss
}: {
  title: string;
  markdown: string;
  onRetryCopy: () => void;
  onDismiss: () => void;
}) {
  return (
    <section className="markdown-fallback">
      <div>
        <strong>{title} Markdown ready</strong>
        <span>Copying was blocked, so the generated Markdown is available here.</span>
      </div>
      <textarea readOnly value={markdown} aria-label={`${title} Markdown fallback`} />
      <div className="markdown-fallback-actions">
        <button onClick={onRetryCopy}>
          <Copy size={14} /> Retry copy
        </button>
        <button onClick={onDismiss}>
          <X size={14} /> Dismiss
        </button>
      </div>
    </section>
  );
}
