import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import { EXTERNAL, filesUrl, resolveLink } from './urls';

/** A Markdown file read the way it's meant to be read; links into the repo stay in Files. */
export const Markdown = memo(function Markdown({ text, ws, path }: { text: string; ws: string; path: string }) {
  const components: Components = {
    a({ href = '', children }) {
      const inside = resolveLink(path, href);

      if (inside) return <Link to={filesUrl.browse(ws, inside)}>{children}</Link>;

      return (
        <a href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noreferrer">
          {children}
        </a>
      );
    },
    img({ src, alt }) {
      return typeof src === 'string' && EXTERNAL.test(src) ? <img src={src} alt={alt ?? ''} loading="lazy" /> : <span className="md-img">{alt || src}</span>;
    },
  };

  return (
    <article className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </article>
  );
});
