import React, { type ReactNode } from 'react';
import { normalizeRichTextDocument } from '@/lib/rich-text-content';
import type { RichTextNode, StoredTextContentBlock } from '@/types/music-list-content';

function renderNode(node: RichTextNode, key: number): ReactNode {
  const children = node.content?.map(renderNode);
  switch (node.type) {
    case 'text': {
      let text: ReactNode = node.text;
      for (const [index, mark] of (node.marks ?? []).entries()) {
        switch (mark.type) {
          case 'bold': text = <strong key={index} className="font-bold text-white">{text}</strong>; break;
          case 'italic': text = <em key={index} className="italic">{text}</em>; break;
          case 'strike': text = <s key={index} className="line-through">{text}</s>; break;
          case 'underline': text = <u key={index} className="underline underline-offset-2">{text}</u>; break;
          case 'code': text = <code key={index} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.9em]">{text}</code>; break;
          case 'link': text = <a key={index} href={mark.attrs?.href as string} target="_blank" rel="noopener noreferrer" className="text-neon-point underline underline-offset-3 hover:text-neon-point/80 focus-visible:outline-2 focus-visible:outline-neon-point">{text}</a>; break;
        }
      }
      return <React.Fragment key={key}>{text}</React.Fragment>;
    }
    case 'hardBreak': return <br key={key} />;
    case 'paragraph': return <p key={key} className="min-h-[1.75em]">{children}</p>;
    case 'heading': return node.attrs?.level === 2
      ? <h2 key={key} className="text-[1.5em] leading-normal font-bold text-white">{children}</h2>
      : <h3 key={key} className="text-[1.2em] leading-relaxed font-semibold text-white">{children}</h3>;
    case 'bulletList': return <ul key={key} className="list-disc space-y-1 pl-[1.6em]">{children}</ul>;
    case 'orderedList': return <ol key={key} start={node.attrs?.start as number} className="list-decimal space-y-1 pl-[1.6em]">{children}</ol>;
    case 'listItem': return <li key={key} className="space-y-2">{children}</li>;
    case 'blockquote': return <blockquote key={key} className="space-y-3 border-l-[3px] border-neon-point px-[1em] py-[0.35em] text-gray-400">{children}</blockquote>;
    case 'horizontalRule': return <hr key={key} className="border-t border-white/15" />;
    default: return null;
  }
}

export default function RichTextContent({ block }: { block: StoredTextContentBlock }) {
  let document: ReturnType<typeof normalizeRichTextDocument> | undefined;
  if (block.document) {
    try {
      document = normalizeRichTextDocument(block.document);
    } catch { /* Invalid saved documents fall back to their original plain text. */ }
  }
  if (document) {
    return <div data-text-content="" className="space-y-4 whitespace-pre-wrap text-sm leading-7 text-gray-300 [overflow-wrap:anywhere] sm:text-base sm:leading-8">{document.content.map(renderNode)}</div>;
  }
  return <p data-text-content="" className="whitespace-pre-wrap text-sm leading-7 text-gray-300 [overflow-wrap:anywhere] sm:text-base sm:leading-8">{block.content}</p>;
}
