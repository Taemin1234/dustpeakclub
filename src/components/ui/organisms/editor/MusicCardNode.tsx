'use client';

import Image from 'next/image';
import { ArrowDown, ArrowUp, Disc, GripVertical, Music, TextCursorInput, Trash2 } from 'lucide-react';
import { Node, NodeViewWrapper, ReactNodeViewRenderer, mergeAttributes, useEditorState, type Editor, type NodeViewProps } from '@tiptap/react';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { MusicContentItem } from '@/types/music-list-content';

export interface MusicCardAttributes extends MusicContentItem {
  kind: 'track' | 'album';
  blockId: string;
}

export function insertMusicCard(editor: Editor, item: MusicContentItem, kind: MusicCardAttributes['kind']) {
  // Keep cards at document level even when the cursor is inside a list or quote.
  const selection = editor.state.selection;
  const { $from } = selection;
  const position = $from.depth > 1 ? $from.after(1)
    : selection instanceof NodeSelection ? selection.to : selection.from;
  return editor.chain().focus().insertContentAt(position, [
    { type: 'musicCard', attrs: { ...item, kind, blockId: crypto.randomUUID() } },
    { type: 'paragraph' },
  ]).run();
}

export const MusicCardNode = Node.create({
  name: 'musicCard',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  isolating: true,
  addAttributes() {
    return Object.fromEntries([
      'blockId', 'kind', 'id', 'name', 'artist', 'albumImageUrl',
      'artistId', 'albumId', 'spotifyName', 'spotifyArtistName', 'spotifyAlbumName',
    ].map((name) => [name, {
      default: name === 'kind' ? 'track' : '',
      parseHTML: (element: HTMLElement) => element.getAttribute(`data-${name.toLowerCase()}`),
      renderHTML: (attributes: Record<string, unknown>) => ({ [`data-${name.toLowerCase()}`]: attributes[name] }),
    }]));
  },
  parseHTML() { return [{ tag: 'div[data-music-card]' }]; },
  renderHTML({ HTMLAttributes, node }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-music-card': '' }),
      ['span', {}, node.attrs.name], ['span', {}, ` — ${node.attrs.artist}`],
    ];
  },
  addNodeView() { return ReactNodeViewRenderer(MusicCardView); },
});

function MusicCardView({ editor, node, selected, getPos, deleteNode }: NodeViewProps) {
  const item = node.attrs as MusicCardAttributes;
  const Icon = item.kind === 'album' ? Disc : Music;
  const position = () => {
    try { return getPos(); } catch { return undefined; }
  };
  const movement = useEditorState({ editor, selector: ({ editor }) => {
    const pos = position();
    if (pos === undefined) return { up: false, down: false };
    const $pos = editor.state.doc.resolve(pos);
    return { up: $pos.depth === 0 && !!$pos.nodeBefore, down: $pos.depth === 0 && !!editor.state.doc.resolve(pos + node.nodeSize).nodeAfter };
  } });

  const move = (direction: 'up' | 'down') => {
    const pos = position();
    if (pos === undefined) return;
    const { doc, tr } = editor.state;
    const $pos = doc.resolve(pos);
    if ($pos.depth !== 0) return;
    const current = doc.nodeAt(pos);
    if (!current) return;
    const neighbor = direction === 'up' ? $pos.nodeBefore : doc.resolve(pos + current.nodeSize).nodeAfter;
    if (!neighbor) return;
    const start = direction === 'up' ? pos - neighbor.nodeSize : pos;
    const replacement = direction === 'up' ? [current, neighbor] : [neighbor, current];
    tr.replaceWith(start, start + neighbor.nodeSize + current.nodeSize, replacement);
    tr.setSelection(NodeSelection.create(tr.doc, direction === 'up' ? start : start + neighbor.nodeSize));
    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();
  };

  const writeBeside = (side: 'before' | 'after') => {
    const pos = position();
    if (pos === undefined) return;
    const { tr, schema } = editor.state;
    const boundary = side === 'before' ? pos : pos + node.nodeSize;
    const $boundary = tr.doc.resolve(boundary);
    const neighbor = side === 'before' ? $boundary.nodeBefore : $boundary.nodeAfter;
    if (neighbor?.type.name === 'paragraph') {
      const cursor = side === 'before' ? boundary - 1 : boundary + 1;
      editor.chain().focus().setTextSelection(cursor).run();
      return;
    }
    tr.insert(boundary, schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, boundary + 1));
    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();
  };

  const actions = [
    { label: '위로 이동', icon: ArrowUp, disabled: !movement.up, run: () => move('up') },
    { label: '아래로 이동', icon: ArrowDown, disabled: !movement.down, run: () => move('down') },
    { label: '카드 위에 글쓰기', icon: TextCursorInput, run: () => writeBeside('before') },
    { label: '카드 아래에 글쓰기', icon: TextCursorInput, run: () => writeBeside('after') },
    { label: '카드 삭제', icon: Trash2, run: () => { deleteNode(); editor.commands.focus(); } },
  ];

  return (
    <NodeViewWrapper contentEditable={false} data-music-card="" data-card-kind={item.kind}
      className={`my-4 rounded-xl border bg-white/[0.03] p-3 text-sm leading-normal ${selected ? 'border-neon-point ring-1 ring-neon-point/30' : 'border-white/15'}`}>
      <div className="flex items-center gap-3">
        <span data-drag-handle title="드래그하여 카드 이동" className="cursor-grab touch-none text-gray-500 active:cursor-grabbing"><GripVertical size={18} /></span>
        <button type="button" aria-label={`${item.name} 카드 선택`} onClick={() => { const pos = position(); if (pos !== undefined) editor.chain().focus().setNodeSelection(pos).run(); }}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-neon-point">
          {item.albumImageUrl ? <Image src={item.albumImageUrl} alt={item.name} width={56} height={56} draggable={false} unoptimized className="h-14 w-14 shrink-0 rounded-lg object-cover" />
            : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-white/5 text-gray-400"><Icon size={24} /></span>}
          <span className="min-w-0">
            <span className="mb-1 flex items-center gap-1 text-xs text-gray-500"><Icon size={12} />{item.kind === 'album' ? '앨범' : '곡'}</span>
            <span className="block truncate font-semibold text-white">{item.name}</span>
            <span className="mt-1 block truncate text-xs text-gray-400">{item.artist}</span>
          </span>
        </button>
      </div>
      <div role="group" aria-label={`${item.name} 카드 도구`} className="mt-3 flex flex-wrap gap-1 border-t border-white/10 pt-2">
        {actions.map(({ label, icon: ActionIcon, disabled, run }) => (
          <button key={label} type="button" title={label} aria-label={`${item.name} ${label}`} disabled={disabled}
            onMouseDown={(event) => event.preventDefault()} onClick={run}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-gray-400 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-neon-point disabled:cursor-not-allowed disabled:opacity-30">
            <ActionIcon size={14} />{label}
          </button>
        ))}
      </div>
    </NodeViewWrapper>
  );
}
