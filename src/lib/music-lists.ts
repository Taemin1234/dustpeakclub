import prisma from '@/lib/prisma';
import { getLocalizedNames, localizedName } from '@/lib/music-localization';
import { parseStoredContentBlocks } from '@/lib/music-list-content';
import type { StoredMusicListContentBlock } from '@/types/music-list-content';
import type { SerializedComment } from '@/lib/comment-threads';
import type { FeedKind, ListSortOption, ListType, VisibilityScope } from "@/types";

type FeedCursor = {
  createdAt: string;
  id: string;
};

type QueryOptions = {
  type: ListType;
  sort?: ListSortOption;
  limit: number;
  cursor: FeedCursor | null;
  likesOffset?: number;
  feedUserId?: string;
  authorId?: string;
  visibility: VisibilityScope;
  featuredSectionKey?: string;
  excludeFeaturedSectionKey?: string;
};

type ResponseItem = {
  kind: FeedKind;
  id: string;
  title: string;
  story: string | null;
  visibility: 'PUBLIC' | 'PRIVATE';
  authorId: string;
  authorNickname: string | null;
  createdAt: string;
  likesCount: number;
  commentsCount: number;
  tags: string[];
  previewImages: string[];
};

type ResponsePayload = {
  items: ResponseItem[];
  nextCursor: string | null;
};

type CollectedRef = {
  kind: 'PLAYLIST' | 'ALBUM_LIST';
  refId: string;
  _cursor: FeedCursor;
};

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

function encodeCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(raw: string): FeedCursor {
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as FeedCursor;
    if (!decoded?.createdAt || !decoded?.id) {
      throw new Error('Invalid cursor shape');
    }

    const parsed = new Date(decoded.createdAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('Invalid cursor date');
    }

    return decoded;
  } catch {
    throw new Error('Invalid cursor');
  }
}

function buildAfterWhere(cursor: FeedCursor | null) {
  if (!cursor) return {};

  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [
      { createdAt: { lt: createdAt } },
      { createdAt, id: { lt: cursor.id } },
    ],
  };
}

function toItemKind(type: ListType): FeedKind | null {
  if (type === 'playlist') return 'PLAYLIST';
  if (type === 'albumlist') return 'ALBUM_LIST';
  return null;
}

export function parseListType(raw: string | null): ListType {
  if (!raw) return 'all';
  if (raw === 'all' || raw === 'playlist' || raw === 'albumlist') return raw;
  throw new Error('type must be one of all, playlist, albumlist');
}

export function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;

  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }

  return n;
}

export function parseCursor(raw: string | null): FeedCursor | null {
  if (!raw) return null;
  return decodeCursor(raw);
}

export function parseListSort(raw: string | null): ListSortOption {
  if (!raw) return 'latest';
  if (raw === 'latest' || raw === 'likes') return raw;
  throw new Error('sort must be one of latest, likes');
}

export function parseLikesCursor(raw: string | null): number {
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error('likes cursor must be a non-negative integer');
  }
  return n;
}

function encodeLikesCursor(offset: number): string {
  return String(offset);
}

export function parseVisibilityScope(raw: string | null): VisibilityScope {
  if (!raw) return 'all';
  if (raw === 'all' || raw === 'public' || raw === 'private') return raw;
  throw new Error('visibility must be one of all, public, private');
}

function compareByLikesThenRecent(a: ResponseItem, b: ResponseItem): number {
  if (b.likesCount !== a.likesCount) return b.likesCount - a.likesCount;

  const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  if (timeDiff !== 0) return timeDiff;

  return b.id.localeCompare(a.id);
}

async function applyFeaturedSectionScope(
  options: QueryOptions,
  playlistWhere: Record<string, unknown>,
  albumListWhere: Record<string, unknown>
) {
  const sectionKey = options.featuredSectionKey ?? options.excludeFeaturedSectionKey;
  if (!sectionKey) return;

  const now = new Date();
  const featuredItems = await prisma.featuredItem.findMany({
    where: {
      section: { key: sectionKey, isActive: true },
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      ],
    },
    select: { kind: true, refId: true },
  });
  const playlistIds = featuredItems.filter((item) => item.kind === 'PLAYLIST').map((item) => item.refId);
  const albumListIds = featuredItems.filter((item) => item.kind === 'ALBUM_LIST').map((item) => item.refId);

  if (options.featuredSectionKey) {
    playlistWhere.id = { in: playlistIds };
    albumListWhere.id = { in: albumListIds };
  } else {
    playlistWhere.id = { notIn: playlistIds };
    albumListWhere.id = { notIn: albumListIds };
  }
}

async function fetchListItemsByLikes(options: QueryOptions): Promise<ResponsePayload> {
  const playlistWhere: Record<string, unknown> = { deletedAt: null };
  const albumListWhere: Record<string, unknown> = { deletedAt: null };
  const offset = options.likesOffset ?? 0;
  const scopedAuthorId = options.authorId ?? options.feedUserId;

  if (scopedAuthorId) {
    playlistWhere.authorId = scopedAuthorId;
    albumListWhere.authorId = scopedAuthorId;
  }
  if (options.visibility === 'public') {
    playlistWhere.visibility = 'PUBLIC';
    albumListWhere.visibility = 'PUBLIC';
  }
  if (options.visibility === 'private') {
    playlistWhere.visibility = 'PRIVATE';
    albumListWhere.visibility = 'PRIVATE';
  }
  await applyFeaturedSectionScope(options, playlistWhere, albumListWhere);

  const orderBy = [
    { likes: { _count: 'desc' as const } },
    { createdAt: 'desc' as const },
    { id: 'desc' as const },
  ];

  if (options.type === 'playlist') {
    const rows = await prisma.playlist.findMany({
      where: playlistWhere,
      orderBy,
      skip: offset,
      take: options.limit + 1,
      select: {
        id: true,
        title: true,
        story: true,
        visibility: true,
        authorId: true,
        createdAt: true,
        author: { select: { nickname: true } },
        _count: { select: { likes: true, comments: { where: { deletedAt: null } } } },
        tags: { select: { tag: { select: { name: true } } } },
        tracks: {
          orderBy: { order: 'asc' },
          take: 3,
          select: { track: { select: { albumCover: true } } },
        },
      },
    });

    const hasNext = rows.length > options.limit;
    const page = hasNext ? rows.slice(0, options.limit) : rows;
    return {
      items: page.map((row) => ({
        kind: 'PLAYLIST',
        id: row.id,
        title: row.title,
        story: row.story,
        visibility: row.visibility,
        authorId: row.authorId,
        authorNickname: row.author.nickname,
        createdAt: row.createdAt.toISOString(),
        likesCount: row._count.likes,
        commentsCount: row._count.comments,
        tags: row.tags.map((tagRow) => tagRow.tag.name),
        previewImages: row.tracks
          .map((entry) => entry.track.albumCover)
          .filter((image): image is string => Boolean(image)),
      })),
      nextCursor: hasNext ? encodeLikesCursor(offset + options.limit) : null,
    };
  }

  if (options.type === 'albumlist') {
    const rows = await prisma.albumList.findMany({
      where: albumListWhere,
      orderBy,
      skip: offset,
      take: options.limit + 1,
      select: {
        id: true,
        title: true,
        story: true,
        visibility: true,
        authorId: true,
        createdAt: true,
        author: { select: { nickname: true } },
        _count: { select: { likes: true, comments: { where: { deletedAt: null } } } },
        tags: { select: { tag: { select: { name: true } } } },
        albums: {
          orderBy: { order: 'asc' },
          take: 3,
          select: { album: { select: { coverImage: true } } },
        },
      },
    });

    const hasNext = rows.length > options.limit;
    const page = hasNext ? rows.slice(0, options.limit) : rows;
    return {
      items: page.map((row) => ({
        kind: 'ALBUM_LIST',
        id: row.id,
        title: row.title,
        story: row.story,
        visibility: row.visibility,
        authorId: row.authorId,
        authorNickname: row.author.nickname,
        createdAt: row.createdAt.toISOString(),
        likesCount: row._count.likes,
        commentsCount: row._count.comments,
        tags: row.tags.map((tagRow) => tagRow.tag.name),
        previewImages: row.albums
          .map((entry) => entry.album.coverImage)
          .filter((image): image is string => Boolean(image)),
      })),
      nextCursor: hasNext ? encodeLikesCursor(offset + options.limit) : null,
    };
  }

  const mergedTake = offset + options.limit + 1;
  const [playlistRows, albumListRows] = await Promise.all([
    prisma.playlist.findMany({
      where: playlistWhere,
      orderBy,
      take: mergedTake,
      select: {
        id: true,
        title: true,
        story: true,
        visibility: true,
        authorId: true,
        createdAt: true,
        author: { select: { nickname: true } },
        _count: { select: { likes: true, comments: { where: { deletedAt: null } } } },
        tags: { select: { tag: { select: { name: true } } } },
        tracks: {
          orderBy: { order: 'asc' },
          take: 3,
          select: { track: { select: { albumCover: true } } },
        },
      },
    }),
    prisma.albumList.findMany({
      where: albumListWhere,
      orderBy,
      take: mergedTake,
      select: {
        id: true,
        title: true,
        story: true,
        visibility: true,
        authorId: true,
        createdAt: true,
        author: { select: { nickname: true } },
        _count: { select: { likes: true, comments: { where: { deletedAt: null } } } },
        tags: { select: { tag: { select: { name: true } } } },
        albums: {
          orderBy: { order: 'asc' },
          take: 3,
          select: { album: { select: { coverImage: true } } },
        },
      },
    }),
  ]);

  const merged: ResponseItem[] = [
    ...playlistRows.map((row) => ({
      kind: 'PLAYLIST' as const,
      id: row.id,
      title: row.title,
      story: row.story,
      visibility: row.visibility,
      authorId: row.authorId,
      authorNickname: row.author.nickname,
      createdAt: row.createdAt.toISOString(),
      likesCount: row._count.likes,
      commentsCount: row._count.comments,
      tags: row.tags.map((tagRow) => tagRow.tag.name),
      previewImages: row.tracks
        .map((entry) => entry.track.albumCover)
        .filter((image): image is string => Boolean(image)),
    })),
    ...albumListRows.map((row) => ({
      kind: 'ALBUM_LIST' as const,
      id: row.id,
      title: row.title,
      story: row.story,
      visibility: row.visibility,
      authorId: row.authorId,
      authorNickname: row.author.nickname,
      createdAt: row.createdAt.toISOString(),
      likesCount: row._count.likes,
      commentsCount: row._count.comments,
      tags: row.tags.map((tagRow) => tagRow.tag.name),
      previewImages: row.albums
        .map((entry) => entry.album.coverImage)
        .filter((image): image is string => Boolean(image)),
    })),
  ].sort(compareByLikesThenRecent);

  const pageWithExtra = merged.slice(offset, offset + options.limit + 1);
  const hasNext = pageWithExtra.length > options.limit;
  const page = hasNext ? pageWithExtra.slice(0, options.limit) : pageWithExtra;

  return {
    items: page,
    nextCursor: hasNext ? encodeLikesCursor(offset + options.limit) : null,
  };
}

export async function fetchListItems(options: QueryOptions): Promise<ResponsePayload> {
  const sort = options.sort ?? 'latest';
  if (sort === 'likes') {
    return fetchListItemsByLikes(options);
  }

  const kind = toItemKind(options.type);
  const baseFeedWhere: Record<string, unknown> = {};

  if (options.feedUserId) {
    baseFeedWhere.userId = options.feedUserId;
  }
  if (kind) {
    baseFeedWhere.kind = kind;
  }

  const visibilityPlaylist: Record<string, unknown> = {};
  const visibilityAlbumList: Record<string, unknown> = {};

  if (options.authorId) {
    visibilityPlaylist.authorId = options.authorId;
    visibilityAlbumList.authorId = options.authorId;
  }

  if (options.visibility === 'public') {
    visibilityPlaylist.visibility = 'PUBLIC';
    visibilityAlbumList.visibility = 'PUBLIC';
  }
  if (options.visibility === 'private') {
    visibilityPlaylist.visibility = 'PRIVATE';
    visibilityAlbumList.visibility = 'PRIVATE';
  }
  await applyFeaturedSectionScope(options, visibilityPlaylist, visibilityAlbumList);

  const collectedRefs: CollectedRef[] = [];
  let scanCursor = options.cursor;

  for (let i = 0; i < 50 && collectedRefs.length < options.limit + 1; i += 1) {
    const needed = options.limit + 1 - collectedRefs.length;
    const take = Math.min(100, Math.max(options.limit + 1, needed * 3));

    const feedRows = await prisma.listFeed.findMany({
      where: { ...baseFeedWhere, ...buildAfterWhere(scanCursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: {
        id: true,
        kind: true,
        refId: true,
        createdAt: true,
        userId: true,
      },
    });

    if (feedRows.length === 0) break;

    const lastRow = feedRows[feedRows.length - 1];
    scanCursor = { createdAt: lastRow.createdAt.toISOString(), id: lastRow.id };

    const playlistIds = [...new Set(feedRows.filter((row) => row.kind === 'PLAYLIST').map((row) => row.refId))];
    const albumListIds = [...new Set(feedRows.filter((row) => row.kind === 'ALBUM_LIST').map((row) => row.refId))];

    const [playlists, albumLists] = await Promise.all([
      playlistIds.length
        ? prisma.playlist.findMany({
          where: {
            id: { in: playlistIds },
            deletedAt: null,
            ...visibilityPlaylist,
          },
          select: {
            id: true,
          },
        })
        : [],
      albumListIds.length
        ? prisma.albumList.findMany({
          where: {
            id: { in: albumListIds },
            deletedAt: null,
            ...visibilityAlbumList,
          },
          select: {
            id: true,
          },
        })
        : [],
    ]);

    const playlistIdSet = new Set(playlists.map((playlist) => playlist.id));
    const albumListIdSet = new Set(albumLists.map((albumList) => albumList.id));

    for (const row of feedRows) {
      if (row.kind === 'PLAYLIST' && playlistIdSet.has(row.refId)) {
        collectedRefs.push({
          kind: 'PLAYLIST',
          refId: row.refId,
          _cursor: { createdAt: row.createdAt.toISOString(), id: row.id },
        });
      }

      if (row.kind === 'ALBUM_LIST' && albumListIdSet.has(row.refId)) {
        collectedRefs.push({
          kind: 'ALBUM_LIST',
          refId: row.refId,
          _cursor: { createdAt: row.createdAt.toISOString(), id: row.id },
        });
      }

      if (collectedRefs.length >= options.limit + 1) {
        break;
      }
    }

    if (feedRows.length < take) break;
  }

  const hasNext = collectedRefs.length > options.limit;
  const pageRefs = hasNext ? collectedRefs.slice(0, options.limit) : collectedRefs;
  const pagePlaylistIds = [...new Set(pageRefs.filter((item) => item.kind === 'PLAYLIST').map((item) => item.refId))];
  const pageAlbumListIds = [...new Set(pageRefs.filter((item) => item.kind === 'ALBUM_LIST').map((item) => item.refId))];

  const [playlists, albumLists] = await Promise.all([
    pagePlaylistIds.length
      ? prisma.playlist.findMany({
        where: {
          id: { in: pagePlaylistIds },
          deletedAt: null,
          ...visibilityPlaylist,
        },
        select: {
          id: true,
          title: true,
          story: true,
          visibility: true,
          authorId: true,
          createdAt: true,
          author: { select: { nickname: true } },
          _count: { select: { likes: true, comments: { where: { deletedAt: null } } } },
          tags: { select: { tag: { select: { name: true } } } },
          tracks: {
            orderBy: { order: 'asc' },
            take: 3,
            select: { track: { select: { albumCover: true } } },
          },
        },
      })
      : [],
    pageAlbumListIds.length
      ? prisma.albumList.findMany({
        where: {
          id: { in: pageAlbumListIds },
          deletedAt: null,
          ...visibilityAlbumList,
        },
        select: {
          id: true,
          title: true,
          story: true,
          visibility: true,
          authorId: true,
          createdAt: true,
          author: { select: { nickname: true } },
          _count: { select: { likes: true, comments: { where: { deletedAt: null } } } },
          tags: { select: { tag: { select: { name: true } } } },
          albums: {
            orderBy: { order: 'asc' },
            take: 3,
            select: { album: { select: { coverImage: true } } },
          },
        },
      })
      : [],
  ]);

  const playlistMap = new Map(playlists.map((playlist) => [playlist.id, playlist]));
  const albumListMap = new Map(albumLists.map((albumList) => [albumList.id, albumList]));
  const rendered: Array<{ item: ResponseItem; cursor: FeedCursor }> = [];

  for (const ref of pageRefs) {
    if (ref.kind === 'PLAYLIST') {
      const playlist = playlistMap.get(ref.refId);
      if (!playlist) continue;

      rendered.push({
        item: {
          kind: 'PLAYLIST',
          id: playlist.id,
          title: playlist.title,
          story: playlist.story,
          visibility: playlist.visibility,
          authorId: playlist.authorId,
          authorNickname: playlist.author.nickname,
          createdAt: playlist.createdAt.toISOString(),
          likesCount: playlist._count.likes,
          commentsCount: playlist._count.comments,
          tags: playlist.tags.map((tagRow) => tagRow.tag.name),
          previewImages: playlist.tracks
            .map((entry) => entry.track.albumCover)
            .filter((image): image is string => Boolean(image)),
        },
        cursor: ref._cursor,
      });
      continue;
    }

    const albumList = albumListMap.get(ref.refId);
    if (!albumList) continue;

    rendered.push({
      item: {
        kind: 'ALBUM_LIST',
        id: albumList.id,
        title: albumList.title,
        story: albumList.story,
        visibility: albumList.visibility,
        authorId: albumList.authorId,
        authorNickname: albumList.author.nickname,
        createdAt: albumList.createdAt.toISOString(),
        likesCount: albumList._count.likes,
        commentsCount: albumList._count.comments,
        tags: albumList.tags.map((tagRow) => tagRow.tag.name),
        previewImages: albumList.albums
          .map((entry) => entry.album.coverImage)
          .filter((image): image is string => Boolean(image)),
      },
      cursor: ref._cursor,
    });
  }

  const nextCursor = hasNext && rendered.length > 0 ? encodeCursor(rendered[rendered.length - 1].cursor) : null;

  return {
    items: rendered.map((row) => row.item),
    nextCursor,
  };
}

export type FeaturedSectionOption = {
  id: string;
  key: string;
  name: string;
};

type DetailOptions = {
  canViewPrivate?: boolean;
};

export type PlaylistDetail = {
  kind: 'PLAYLIST';
  id: string;
  title: string;
  story: string;
  contentBlocks: StoredMusicListContentBlock[];
  visibility: 'PUBLIC' | 'PRIVATE';
  viewCount: number;
  author: {
    id: string;
    nickname: string | null;
    nicknameSlug: string | null;
    avatarUrl: string | null;
  };
  createdAt: string;
  updatedAt: string;
  tags: string[];
  likesCount: number;
  commentsCount: number;
  bookmarksCount: number;
  viewerHasLiked: boolean;
  viewerHasBookmarked: boolean;
  featuredSectionIds: string[];
  comments: SerializedComment[];
  musicItems: Array<{
    id: string;
    order: number;
    title: string;
    artist: string;
    albumImageUrl: string;
    artistId: string | null;
    spotifyName: string;
    spotifyArtistName: string;
  }>;
};

export type AlbumListDetail = {
  kind: 'ALBUM_LIST';
  id: string;
  title: string;
  story: string;
  contentBlocks: StoredMusicListContentBlock[];
  visibility: 'PUBLIC' | 'PRIVATE';
  viewCount: number;
  author: {
    id: string;
    nickname: string | null;
    nicknameSlug: string | null;
    avatarUrl: string | null;
  };
  createdAt: string;
  updatedAt: string;
  tags: string[];
  likesCount: number;
  commentsCount: number;
  bookmarksCount: number;
  viewerHasLiked: boolean;
  viewerHasBookmarked: boolean;
  featuredSectionIds: string[];
  comments: SerializedComment[];
  musicItems: Array<{
    id: string;
    order: number;
    title: string;
    artist: string;
    albumImageUrl: string;
    artistId: string | null;
    spotifyName: string;
    spotifyArtistName: string;
  }>;
};

type ListMetadata = {
  title: string;
  story: string;
  authorNickname: string | null;
  imageUrl: string | null;
};

export async function fetchPlaylistMetadata(id: string): Promise<ListMetadata | null> {
  const playlist = await prisma.playlist.findFirst({
    where: {
      id,
      deletedAt: null,
      visibility: 'PUBLIC',
    },
    select: {
      title: true,
      story: true,
      author: {
        select: {
          nickname: true,
        },
      },
      tracks: {
        orderBy: { order: 'asc' },
        take: 1,
        select: {
          track: {
            select: {
              albumCover: true,
            },
          },
        },
      },
    },
  });

  if (!playlist) return null;

  return {
    title: playlist.title,
    story: playlist.story,
    authorNickname: playlist.author.nickname,
    imageUrl: playlist.tracks[0]?.track.albumCover ?? null,
  };
}

export async function fetchAlbumListMetadata(id: string): Promise<ListMetadata | null> {
  const albumList = await prisma.albumList.findFirst({
    where: {
      id,
      deletedAt: null,
      visibility: 'PUBLIC',
    },
    select: {
      title: true,
      story: true,
      author: {
        select: {
          nickname: true,
        },
      },
      albums: {
        orderBy: { order: 'asc' },
        take: 1,
        select: {
          album: {
            select: {
              coverImage: true,
            },
          },
        },
      },
    },
  });

  if (!albumList) return null;

  return {
    title: albumList.title,
    story: albumList.story,
    authorNickname: albumList.author.nickname,
    imageUrl: albumList.albums[0]?.album.coverImage ?? null,
  };
}

export async function fetchFeaturedSections(): Promise<FeaturedSectionOption[]> {
  return prisma.featuredSection.findMany({
    where: { isActive: true },
    orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      key: true,
      name: true,
    },
  });
}

export async function fetchPlaylistDetail(
  id: string,
  viewerUserId?: string,
  options: DetailOptions = {}
): Promise<PlaylistDetail | null> {
  const playlist = await prisma.playlist.findFirst({
    where: {
      id,
      deletedAt: null,
      ...(options.canViewPrivate
        ? {}
        : viewerUserId
        ? {
          OR: [{ visibility: 'PUBLIC' }, { authorId: viewerUserId }],
        }
        : { visibility: 'PUBLIC' }),
    },
    select: {
      id: true,
      title: true,
      story: true,
      contentBlocks: true,
      visibility: true,
      viewCount: true,
      authorId: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          bookmarks: true,
          comments: {
            where: { deletedAt: null },
          },
          likes: true,
        },
      },
      author: {
        select: {
          id: true,
          nickname: true,
          nicknameSlug: true,
          avatarUrl: true,
        },
      },
      likes: viewerUserId
        ? {
          where: { userId: viewerUserId },
          select: { userId: true },
          take: 1,
        }
        : false,
      bookmarks: viewerUserId
        ? {
          where: { userId: viewerUserId },
          select: { userId: true },
          take: 1,
        }
        : false,
      tags: {
        select: {
          tag: {
            select: {
              name: true,
            },
          },
        },
      },
      tracks: {
        orderBy: { order: 'asc' },
        select: {
          order: true,
          track: {
            select: {
              spotifyId: true,
              title: true,
              artist: true,
              artistSpotifyId: true,
              albumCover: true,
            },
          },
        },
      },
    },
  });

  if (!playlist) return null;
  const [featuredSettings, localizedNames] = await Promise.all([
    prisma.featuredItem.findMany({
      where: {
        kind: 'PLAYLIST',
        refId: playlist.id,
        isActive: true,
      },
      select: { sectionId: true },
    }),
    getLocalizedNames(
      playlist.tracks.flatMap((entry) => [
        { type: 'TRACK_TITLE' as const, spotifyId: entry.track.spotifyId, canonical: entry.track.title },
        { type: 'ARTIST_NAME' as const, spotifyId: entry.track.artistSpotifyId, canonical: entry.track.artist },
      ])
    ),
  ]);

  return {
    kind: 'PLAYLIST',
    id: playlist.id,
    title: playlist.title,
    story: playlist.story,
    contentBlocks: parseStoredContentBlocks(playlist.contentBlocks, {
      story: playlist.story,
      musicIds: playlist.tracks.map((entry) => entry.track.spotifyId),
    }),
    visibility: playlist.visibility,
    viewCount: playlist.viewCount,
    author: {
      id: playlist.author.id,
      nickname: playlist.author.nickname,
      nicknameSlug: playlist.author.nicknameSlug,
      avatarUrl: playlist.author.avatarUrl,
    },
    createdAt: playlist.createdAt.toISOString(),
    updatedAt: playlist.updatedAt.toISOString(),
    tags: playlist.tags.map((tagRow) => tagRow.tag.name),
    likesCount: playlist._count.likes,
    commentsCount: playlist._count.comments,
    bookmarksCount: playlist._count.bookmarks,
    viewerHasLiked: viewerUserId ? (playlist.likes?.length ?? 0) > 0 : false,
    viewerHasBookmarked: viewerUserId ? (playlist.bookmarks?.length ?? 0) > 0 : false,
    featuredSectionIds: featuredSettings.map((setting) => setting.sectionId),
    comments: [],
    musicItems: playlist.tracks.map((entry) => ({
      id: entry.track.spotifyId,
      order: entry.order,
      title: localizedName(localizedNames, 'TRACK_TITLE', entry.track.spotifyId, entry.track.title),
      artist: localizedName(localizedNames, 'ARTIST_NAME', entry.track.artistSpotifyId, entry.track.artist),
      albumImageUrl: entry.track.albumCover,
      artistId: entry.track.artistSpotifyId,
      spotifyName: entry.track.title,
      spotifyArtistName: entry.track.artist,
    })),
  };
}

export async function fetchAlbumListDetail(
  id: string,
  viewerUserId?: string,
  options: DetailOptions = {}
): Promise<AlbumListDetail | null> {
  const albumList = await prisma.albumList.findFirst({
    where: {
      id,
      deletedAt: null,
      ...(options.canViewPrivate
        ? {}
        : viewerUserId
        ? {
          OR: [{ visibility: 'PUBLIC' }, { authorId: viewerUserId }],
        }
        : { visibility: 'PUBLIC' }),
    },
    select: {
      id: true,
      title: true,
      story: true,
      contentBlocks: true,
      visibility: true,
      viewCount: true,
      authorId: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          bookmarks: true,
          comments: {
            where: { deletedAt: null },
          },
          likes: true,
        },
      },
      author: {
        select: {
          id: true,
          nickname: true,
          nicknameSlug: true,
          avatarUrl: true,
        },
      },
      likes: viewerUserId
        ? {
          where: { userId: viewerUserId },
          select: { userId: true },
          take: 1,
        }
        : false,
      bookmarks: viewerUserId
        ? {
          where: { userId: viewerUserId },
          select: { userId: true },
          take: 1,
        }
        : false,
      tags: {
        select: {
          tag: {
            select: {
              name: true,
            },
          },
        },
      },
      albums: {
        orderBy: { order: 'asc' },
        select: {
          order: true,
          album: {
            select: {
              spotifyId: true,
              title: true,
              artist: true,
              artistSpotifyId: true,
              coverImage: true,
            },
          },
        },
      },
    },
  });

  if (!albumList) return null;
  const [featuredSettings, localizedNames] = await Promise.all([
    prisma.featuredItem.findMany({
      where: {
        kind: 'ALBUM_LIST',
        refId: albumList.id,
        isActive: true,
      },
      select: { sectionId: true },
    }),
    getLocalizedNames(
      albumList.albums.flatMap((entry) => [
        { type: 'ALBUM_TITLE' as const, spotifyId: entry.album.spotifyId, canonical: entry.album.title },
        { type: 'ARTIST_NAME' as const, spotifyId: entry.album.artistSpotifyId, canonical: entry.album.artist },
      ])
    ),
  ]);

  return {
    kind: 'ALBUM_LIST',
    id: albumList.id,
    title: albumList.title,
    story: albumList.story,
    contentBlocks: parseStoredContentBlocks(albumList.contentBlocks, {
      story: albumList.story,
      musicIds: albumList.albums.map((entry) => entry.album.spotifyId),
    }),
    visibility: albumList.visibility,
    viewCount: albumList.viewCount,
    author: {
      id: albumList.author.id,
      nickname: albumList.author.nickname,
      nicknameSlug: albumList.author.nicknameSlug,
      avatarUrl: albumList.author.avatarUrl,
    },
    createdAt: albumList.createdAt.toISOString(),
    updatedAt: albumList.updatedAt.toISOString(),
    tags: albumList.tags.map((tagRow) => tagRow.tag.name),
    likesCount: albumList._count.likes,
    commentsCount: albumList._count.comments,
    bookmarksCount: albumList._count.bookmarks,
    viewerHasLiked: viewerUserId ? (albumList.likes?.length ?? 0) > 0 : false,
    viewerHasBookmarked: viewerUserId ? (albumList.bookmarks?.length ?? 0) > 0 : false,
    featuredSectionIds: featuredSettings.map((setting) => setting.sectionId),
    comments: [],
    musicItems: albumList.albums.map((entry) => ({
      id: entry.album.spotifyId,
      order: entry.order,
      title: localizedName(localizedNames, 'ALBUM_TITLE', entry.album.spotifyId, entry.album.title),
      artist: localizedName(localizedNames, 'ARTIST_NAME', entry.album.artistSpotifyId, entry.album.artist),
      albumImageUrl: entry.album.coverImage,
      artistId: entry.album.artistSpotifyId,
      spotifyName: entry.album.title,
      spotifyArtistName: entry.album.artist,
    })),
  };
}

////////////////////////////////////////
// 조회수 카운터
// 본인 조회수는 카운트하지 않음
// 24시간에 1번 적용
// 비로그인 유저면 deviceId로 조회수 카운트
type RegisterListViewOptions = {
  kind: 'playlist' | 'albumlist';
  id: string;
  authorId: string;
  viewerUserId?: string;
  deviceId?: string;
};

// 조회수 쿨다운(24시간)
const VIEW_COUNT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export async function registerListView({
  kind,
  id,
  authorId,
  viewerUserId,
  deviceId,
}: RegisterListViewOptions): Promise<void> {
  // 카운트 안하는 상황
  // 본인 조회수는 카운트 안함
  if (viewerUserId && viewerUserId === authorId) return;
  // 로그인을 하지 않았고 deviceId도 없으면 카운트 안함
  if (!viewerUserId && !deviceId) return;

  // 현재 시간에서 24시간 전
  // 저장된 최근 조회 시간보다 threshold가 최신이면 조회수 증가
  const threshold = new Date(Date.now() - VIEW_COUNT_COOLDOWN_MS);

  // 플레이리스트 경우
  if (kind === 'playlist') {
    // 로그인 유저인 경우
    if (viewerUserId) {
      await prisma.$transaction(async (tx) => {
        // 해당 유저가 이미 조회를 한 적이 있는지 확인
        const existing = await tx.playlistViewEvent.findUnique({
          where: { playlistId_userId: { playlistId: id, userId: viewerUserId } },
          select: { lastCountedAt: true },
        });

        // 조회를 한 적이 없으면 조회수 증가
        if (!existing) {
          await tx.playlistViewEvent.create({
            data: { playlistId: id, userId: viewerUserId, lastCountedAt: new Date() },
          });
          await tx.playlist.update({ where: { id }, data: { viewCount: { increment: 1 } } });
          return;
        }

        // 조회를 한 적이 있고 최근 조회 시간이 threshold 이전이면 조회수 증가
        if (existing.lastCountedAt <= threshold) {
          await tx.playlistViewEvent.update({
            where: { playlistId_userId: { playlistId: id, userId: viewerUserId } },
            data: { lastCountedAt: new Date() },
          });
          await tx.playlist.update({ where: { id }, data: { viewCount: { increment: 1 } } });
        }
      });
      return;
    }

    if (!deviceId) return;

    await prisma.$transaction(async (tx) => {
      const existing = await tx.playlistViewEvent.findUnique({
        where: { playlistId_deviceId: { playlistId: id, deviceId } },
        select: { lastCountedAt: true },
      });

      if (!existing) {
        await tx.playlistViewEvent.create({
          data: { playlistId: id, deviceId, lastCountedAt: new Date() },
        });
        await tx.playlist.update({ where: { id }, data: { viewCount: { increment: 1 } } });
        return;
      }

      if (existing.lastCountedAt <= threshold) {
        await tx.playlistViewEvent.update({
          where: { playlistId_deviceId: { playlistId: id, deviceId } },
          data: { lastCountedAt: new Date() },
        });
        await tx.playlist.update({ where: { id }, data: { viewCount: { increment: 1 } } });
      }
    });
    return;
  }

  // 앨범리스트 경우
  if (viewerUserId) {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.albumListViewEvent.findUnique({
        where: { albumListId_userId: { albumListId: id, userId: viewerUserId } },
        select: { lastCountedAt: true },
      });

      if (!existing) {
        await tx.albumListViewEvent.create({
          data: { albumListId: id, userId: viewerUserId, lastCountedAt: new Date() },
        });
        await tx.albumList.update({ where: { id }, data: { viewCount: { increment: 1 } } });
        return;
      }

      if (existing.lastCountedAt <= threshold) {
        await tx.albumListViewEvent.update({
          where: { albumListId_userId: { albumListId: id, userId: viewerUserId } },
          data: { lastCountedAt: new Date() },
        });
        await tx.albumList.update({ where: { id }, data: { viewCount: { increment: 1 } } });
      }
    });
    return;
  }

  if (!deviceId) return;

  await prisma.$transaction(async (tx) => {
    const existing = await tx.albumListViewEvent.findUnique({
      where: { albumListId_deviceId: { albumListId: id, deviceId } },
      select: { lastCountedAt: true },
    });

    if (!existing) {
      await tx.albumListViewEvent.create({
        data: { albumListId: id, deviceId, lastCountedAt: new Date() },
      });
      await tx.albumList.update({ where: { id }, data: { viewCount: { increment: 1 } } });
      return;
    }

    if (existing.lastCountedAt <= threshold) {
      await tx.albumListViewEvent.update({
        where: { albumListId_deviceId: { albumListId: id, deviceId } },
        data: { lastCountedAt: new Date() },
      });
      await tx.albumList.update({ where: { id }, data: { viewCount: { increment: 1 } } });
    }
  });
}
