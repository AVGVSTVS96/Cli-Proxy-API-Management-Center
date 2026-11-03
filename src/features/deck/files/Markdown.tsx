import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import { filesUrl } from './urls';

const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;

/** A link's target inside the repo, relative to the file it's written in; null when it leaves the repo. */
export function resolveLink(from: string, href: string): string | null {
  if (!href || href.startsWith('#') || EXTERNAL.test(href) || href.startsWith('//')) return null;
  const [target] = href.split(/[?#]/);
  const base = href.startsWith('/') ? [] : from.split('/').slice(0, -1);
  const parts = [...base];

  for (const part of decodeURIComponent(target).split('/')) {
    if (!part || part === '.') continue;

    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }

  return parts.join('/') || null;
}

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
