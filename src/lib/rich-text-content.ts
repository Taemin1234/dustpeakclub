import type { MusicListContentBlock, RichTextDocument, RichTextNode } from '@/types/music-list-content';

const inlineTypes = new Set(['text', 'hardBreak']);
const blockTypes = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'horizontalRule']);
const simpleMarks = new Set(['bold', 'italic', 'strike', 'underline', 'code']);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('잘못된 본문 형식입니다.');
  return value as Record<string, unknown>;
}

export function normalizeRichTextDocument(value: unknown): RichTextDocument {
  let count = 0;
  let characters = 0;
  const read = (value: unknown, parent: string, depth: number): RichTextNode => {
    if (++count > 2000 || depth > 12) throw new Error('본문의 블록 수 또는 중첩 깊이가 너무 큽니다.');
    const raw = object(value);
    const type = typeof raw.type === 'string' ? raw.type : '';
    const allowed = parent === 'root' ? type === 'doc'
      : parent === 'paragraph' || parent === 'heading' ? inlineTypes.has(type)
      : parent === 'bulletList' || parent === 'orderedList' ? type === 'listItem'
      : blockTypes.has(type);
    if (!allowed) throw new Error('지원하지 않는 본문 블록입니다.');
    const node: RichTextNode = { type };
    const attrs = raw.attrs === undefined ? {} : object(raw.attrs);
    if (type === 'heading') {
      if (attrs.level !== 2 && attrs.level !== 3) throw new Error('소제목 단계가 올바르지 않습니다.');
      node.attrs = { level: attrs.level };
    }
    if (type === 'orderedList') {
      const start = attrs.start ?? 1;
      if (!Number.isInteger(start) || (start as number) < 1 || (start as number) > 100000) throw new Error('목록 시작 번호가 올바르지 않습니다.');
      node.attrs = { start };
    }
    if (type === 'text') {
      if (typeof raw.text !== 'string' || !raw.text) throw new Error('본문 텍스트가 올바르지 않습니다.');
      characters += raw.text.length;
      if (characters > 100000) throw new Error('본문은 100,000자 이하로 작성해주세요.');
      node.text = raw.text;
    }
    if (raw.marks !== undefined) {
      if (!inlineTypes.has(type) || !Array.isArray(raw.marks) || raw.marks.length > 6) throw new Error('본문 서식이 올바르지 않습니다.');
      const used = new Set<string>();
      node.marks = raw.marks.map((value) => {
        const mark = object(value);
        if (typeof mark.type !== 'string' || used.has(mark.type)) throw new Error('본문 서식이 올바르지 않습니다.');
        used.add(mark.type);
        if (simpleMarks.has(mark.type)) return { type: mark.type };
        if (mark.type !== 'link') throw new Error('지원하지 않는 본문 서식입니다.');
        const linkAttrs = object(mark.attrs);
        if (typeof linkAttrs.href !== 'string' || linkAttrs.href.length > 2000) throw new Error('링크 주소가 올바르지 않습니다.');
        let href: string;
        try {
          const url = new URL(linkAttrs.href);
          if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error();
          href = url.href;
        } catch { throw new Error('http 또는 https 링크만 사용할 수 있습니다.'); }
        return { type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer' } };
      });
    }
    if (raw.content !== undefined && !Array.isArray(raw.content)) throw new Error('본문 블록 배열이 올바르지 않습니다.');
    if (inlineTypes.has(type) || type === 'horizontalRule') {
      if (Array.isArray(raw.content) && raw.content.length) throw new Error('본문 블록 구조가 올바르지 않습니다.');
    } else {
      node.content = (raw.content as unknown[] | undefined ?? []).map((child) => read(child, type, depth + 1));
      if (['bulletList', 'orderedList', 'blockquote', 'listItem'].includes(type) && !node.content.length) throw new Error('빈 목록 또는 인용문은 저장할 수 없습니다.');
      if (type === 'listItem' && node.content[0]?.type !== 'paragraph') throw new Error('목록 항목은 문단으로 시작해야 합니다.');
    }
    return node;
  };
  return read(value, 'root', 0) as RichTextDocument;
}

export function richTextPlainText(node: RichTextNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'musicCard') return '';
  const separator = ['paragraph', 'heading'].includes(node.type) ? '' : '\n';
  return (node.content ?? []).map(richTextPlainText).join(separator);
}

export function contentBlocksToEditorDocument(blocks: MusicListContentBlock[], kind: 'track' | 'album'): RichTextDocument {
  const content = blocks.flatMap<RichTextNode>((block) => {
    if (block.type === 'music') return [{ type: 'musicCard', attrs: { ...block.item, blockId: block.id, kind: block.kind ?? kind } }];
    if (block.document) return block.document.content;
    return block.content.replace(/\r\n?/g, '\n').split('\n').map((text) => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }));
  });
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

export function editorDocumentToContentBlocks(document: RichTextDocument): MusicListContentBlock[] {
  const blocks: MusicListContentBlock[] = [];
  let text: RichTextNode[] = [];
  const flush = () => {
    if (!text.length) return;
    const document: RichTextDocument = { type: 'doc', content: text };
    blocks.push({ id: `text-${blocks.length}`, type: 'text', content: richTextPlainText(document), document });
    text = [];
  };
  for (const node of document.content) {
    if (node.type !== 'musicCard') { text.push(node); continue; }
    flush();
    const attrs = node.attrs ?? {};
    const string = (key: string) => typeof attrs[key] === 'string' ? attrs[key] as string : '';
    blocks.push({
      id: string('blockId') || `music-${blocks.length}`, type: 'music', kind: attrs.kind === 'album' ? 'album' : 'track',
      item: { id: string('id'), name: string('name'), artist: string('artist'), albumImageUrl: string('albumImageUrl'),
        artistId: string('artistId') || undefined, albumId: string('albumId') || undefined,
        spotifyName: string('spotifyName') || undefined, spotifyArtistName: string('spotifyArtistName') || undefined, spotifyAlbumName: string('spotifyAlbumName') || undefined },
    });
  }
  flush();
  return blocks;
}
