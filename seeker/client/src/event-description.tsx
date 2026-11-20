import { useEffect, useRef } from 'react';

const allowed = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div', 'a']);
const discarded = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'form', 'noscript']);

export function Description({ html, sourceUrl }: { html: string; sourceUrl: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const parsed = new DOMParser().parseFromString(html || '', 'text/html');
    const fragment = document.createDocumentFragment();

    function copy(node: Node, parent: Node) {
      if (node.nodeType === Node.TEXT_NODE) {
        parent.appendChild(document.createTextNode(node.textContent || ''));
        return;
      }
      if (!(node instanceof Element) || discarded.has(node.localName)) return;

      let target = parent;
      if (node.localName === 'a') {
        try {
          const href = node.getAttribute('href');
          if (href) {
            const url = new URL(href, sourceUrl);
            if (['http:', 'https:'].includes(url.protocol)) {
              const link = document.createElement('a');
              link.href = url.href;
              link.target = '_blank';
              link.rel = 'noopener noreferrer';
              target = parent.appendChild(link);
            }
          }
        } catch {
          // Keep the link text when the URL is invalid.
        }
      } else if (allowed.has(node.localName)) {
        target = parent.appendChild(document.createElement(node.localName));
      }
      node.childNodes.forEach(child => copy(child, target));
    }

    parsed.body.childNodes.forEach(child => copy(child, fragment));
    root.replaceChildren(fragment);
    if (!root.textContent?.trim()) root.textContent = 'No description available.';
  }, [html, sourceUrl]);

  return <div className="event-description" ref={ref} />;
}
