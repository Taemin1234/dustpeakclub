import prisma from '@/lib/prisma';
import type { Prisma } from '../../generated/prisma/client';
import { createSupabaseServerClient } from '@/utils/supabase/server';
import { normalizeTextBlockContent } from '@/lib/music-list-content';
import { normalizeRichTextDocument, richTextPlainText } from '@/lib/rich-text-content';
import type { MusicListContentBlock, StoredMusicListContentBlock } from '@/types/music-list-content';

export type VisibilityValue = 'PUBLIC' | 'PRIVATE';
export type ListEntityType = 'track' | 'album' | 'artist';

export interface MusicItemPayload {
  id: string;
  name: string;
  artist: string;
  albumImageUrl: string;
  artistId?: string;
  albumId?: string;
  spotifyName?: string;
  spotifyArtistName?: string;
  spotifyAlbumName?: string;
}

export interface ListPayloadInput {
  title?: string;
  visibility?: VisibilityValue;
  type?: ListEntityType;
  contentBlocks?: MusicListContentBlock[];
  tags?: string[];
  featuredSectionIds?: string[];
}

export interface NormalizedListPayload {
  title: string;
  story: string;
  visibility: VisibilityValue;
  contentBlocks: Prisma.InputJsonValue;
  musicItems: MusicItemPayload[];
  tags: string[];
  featuredSectionIds: string[];
}

// 현재 요청의 로그인 유저 확인
export async function getAuthenticatedUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

// Supabase Auth 유저를 우리 DB User로 동기화/보장
export async function upsertDbUser(user: {
  id: string;
  email?: string | null;
}) {
  const email = user.email?.trim();
  if (!email) return;

  await prisma.user.upsert({
    where: { id: user.id },
    update: {
      email,
    },
    create: {
      id: user.id,
      email,
      avatarUrl: null,
      nickname: null,
    },
  });
}


// 태그 정리
export function cleanTags(tags: string[] | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.filter((tag) => typeof tag === 'string').map((tag) => tag.replace(/\s+/g, '')).filter(Boolean))].slice(0, 10);
}

export function cleanFeaturedSectionIds(sectionIds: string[] | undefined): string[] {
  if (!Array.isArray(sectionIds)) return [];
  return [...new Set(sectionIds.filter((sectionId) => typeof sectionId === 'string').map((sectionId) => sectionId.trim()).filter(Boolean))];
}

// 중복 곡 제거
export function uniqueMusicItems(musicItems: MusicItemPayload[]): MusicItemPayload[] {
  return Array.from(new Map(musicItems.map((item) => [item.id, item])).values());
}


// 태그 db 저장
export async function upsertTags(tags: string[]) {
  if (tags.length === 0) return [];

  await prisma.tag.createMany({
    data: tags.map((name) => ({ name })),
    skipDuplicates: true,
  });

  return prisma.tag.findMany({
    where: { name: { in: tags } },
    select: { id: true },
  });
}

// body 요청 검증 / 데이터 정규화
export function validateAndNormalizeListPayload(
  body: ListPayloadInput,
  options: { expectedType: ListEntityType; requireType: boolean }
): { data?: NormalizedListPayload; error?: string } {
  if (!body || typeof body !== 'object') return { error: 'invalid payload' };
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return { error: 'title is required' };
  }
  if (!Array.isArray(body.contentBlocks)) {
    return { error: 'contentBlocks is required' };
  }
  if (body.contentBlocks.length > 500) return { error: '본문 블록은 500개 이하로 작성해주세요.' };
  if (JSON.stringify(body.contentBlocks).length > 1000000) return { error: '본문 데이터 크기가 너무 큽니다.' };

  const usedIds = new Set<string>();
  const usedMusicIds = new Set<string>();
  const normalizedBlocks: StoredMusicListContentBlock[] = [];
  const musicItems: MusicItemPayload[] = [];
  let contentError: string | undefined;

  body.contentBlocks.forEach((block, index) => {
    if (!block || typeof block !== 'object') { contentError = 'invalid content block'; return; }
    const requestedId = typeof block.id === 'string' ? block.id.trim().slice(0, 100) : '';
    let id = requestedId || `content-block-${index}`;
    if (usedIds.has(id)) id = `${id}-${index}`;
    usedIds.add(id);

    if (block.type === 'text') {
      if (block.document !== undefined) {
        try {
          const document = normalizeRichTextDocument(block.document);
          const content = normalizeTextBlockContent(richTextPlainText(document));
          normalizedBlocks.push({ id, type: 'text', content, document });
        } catch (error) { contentError = error instanceof Error ? error.message : 'invalid rich text'; }
        return;
      }
      if (typeof block.content !== 'string') { contentError = 'invalid text block'; return; }
      const content = typeof block.content === 'string' ? normalizeTextBlockContent(block.content) : '';
      if (content.trim()) normalizedBlocks.push({ id, type: 'text', content });
      return;
    }

    if (block.type === 'music' && block.item) {
      if (block.kind !== undefined && block.kind !== options.expectedType) {
        contentError = options.expectedType === 'track' ? '플레이리스트에는 곡만 추가할 수 있습니다.' : '앨범리스트에는 앨범만 추가할 수 있습니다.';
        return;
      }
      const item = block.item;
      if (
        typeof item.id === 'string' && item.id.trim()
        && typeof item.name === 'string' && item.name.trim()
        && typeof item.artist === 'string' && item.artist.trim()
        && typeof item.albumImageUrl === 'string'
      ) {
        const normalizedItem = {
          id: item.id.trim(),
          name: typeof item.spotifyName === 'string' && item.spotifyName.trim() || item.name.trim(),
          artist: typeof item.spotifyArtistName === 'string' && item.spotifyArtistName.trim() || item.artist.trim(),
          albumImageUrl: item.albumImageUrl.trim(),
          artistId: typeof item.artistId === 'string' ? item.artistId.trim() || undefined : undefined,
          albumId: typeof item.albumId === 'string' ? item.albumId.trim() || undefined : undefined,
          spotifyName: typeof item.spotifyName === 'string' && item.spotifyName.trim() || item.name.trim(),
          spotifyArtistName: typeof item.spotifyArtistName === 'string' && item.spotifyArtistName.trim() || item.artist.trim(),
          spotifyAlbumName: typeof item.spotifyAlbumName === 'string' ? item.spotifyAlbumName.trim() || undefined : undefined,
        };
        normalizedBlocks.push({ id, type: 'music', musicId: normalizedItem.id });
        if (!usedMusicIds.has(normalizedItem.id)) musicItems.push(normalizedItem);
        usedMusicIds.add(normalizedItem.id);
      } else contentError = 'invalid music card';
      return;
    }
    contentError = 'invalid content block';
  });
  if (contentError) return { error: contentError };

  const story = normalizedBlocks
    .filter((block): block is Extract<StoredMusicListContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.content.trim())
    .join('\n\n');
  const uniqueItems = uniqueMusicItems(musicItems);
  if (story.length > 100000) return { error: '본문은 100,000자 이하로 작성해주세요.' };

  if (!story) return { error: 'at least one text block is required' };
  if (uniqueItems.length === 0) return { error: 'at least one music block is required' };

  if (options.requireType) {
    if (body.type !== options.expectedType) {
      return { error: `${options.expectedType} type is required` };
    }
  } else if (body.type && body.type !== options.expectedType) {
    return { error: `type must be ${options.expectedType}` };
  }

  if (body.visibility !== 'PUBLIC' && body.visibility !== 'PRIVATE') {
    return { error: 'invalid visibility' };
  }

  return {
    data: {
      title,
      story,
      visibility: body.visibility,
      contentBlocks: normalizedBlocks as unknown as Prisma.InputJsonValue,
      musicItems: uniqueItems,
      tags: cleanTags(body.tags),
      featuredSectionIds: cleanFeaturedSectionIds(body.featuredSectionIds),
    },
  };
}
