import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/* Renders LLM answers (bold, bullets, tables) that the API passes through as Markdown. */
export default function Markdown({ children }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children || ''}</ReactMarkdown>
    </div>
  );
}
