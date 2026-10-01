export interface MusicContentItem {
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

export interface TextContentBlock {
  id: string;
  type: 'text';
  content: string;
  document?: RichTextDocument;
}

export interface MusicContentBlock {
  id: string;
  type: 'music';
  item: MusicContentItem;
  kind?: 'track' | 'album';
}

export type MusicListContentBlock = TextContentBlock | MusicContentBlock;

export interface StoredTextContentBlock {
  id: string;
  type: 'text';
  content: string;
  document?: RichTextDocument;
}

export interface StoredMusicContentBlock {
  id: string;
  type: 'music';
  musicId: string;
}

export type StoredMusicListContentBlock = StoredTextContentBlock | StoredMusicContentBlock;

export interface RichTextNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: RichTextNode[];
}

export interface RichTextDocument extends RichTextNode {
  type: 'doc';
  content: RichTextNode[];
}
