import type { StoredMusicListContentBlock } from '@/types/music-list-content';
import { normalizeRichTextDocument, richTextPlainText } from '@/lib/rich-text-content';

const MAX_CONSECUTIVE_LINE_BREAKS = 5;

export function normalizeTextBlockContent(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\n{6,}/g, '\n'.repeat(MAX_CONSECUTIVE_LINE_BREAKS))
    .replace(/^[^\S\n]+/, '')
    .replace(/[^\S\n]+$/, '');
}

export function parseStoredContentBlocks(value: unknown, fallback?: { story: string; musicIds: string[] }): StoredMusicListContentBlock[] {
  const legacyBlocks = (): StoredMusicListContentBlock[] => fallback ? [
    ...(fallback.story ? [{ id: 'legacy-story', type: 'text' as const, content: fallback.story }] : []),
    ...fallback.musicIds.map((musicId, index) => ({ id: `legacy-music-${index}`, type: 'music' as const, musicId })),
  ] : [];
  if (!Array.isArray(value)) return legacyBlocks();

  const blocks = value.flatMap<StoredMusicListContentBlock>((block, index) => {
    if (!block || typeof block !== 'object') return [];
    const candidate = block as Record<string, unknown>;
    const id = typeof candidate.id === 'string' && candidate.id.trim()
      ? candidate.id
      : `content-block-${index}`;

    if (candidate.type === 'text' && typeof candidate.content === 'string') {
      if (candidate.document !== undefined) {
        try {
          const document = normalizeRichTextDocument(candidate.document);
          return [{ id, type: 'text', content: richTextPlainText(document), document }];
        } catch { /* Preserve the plain text fallback for older or damaged documents. */ }
      }
      return [{ id, type: 'text', content: candidate.content }];
    }
    if (candidate.type === 'music' && typeof candidate.musicId === 'string' && candidate.musicId.trim()) {
      return [{ id, type: 'music', musicId: candidate.musicId }];
    }
    return [];
  });
  return blocks.length ? blocks : legacyBlocks();
}
