'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Editor } from '@tiptap/react';
import { TextSelection, type SelectionBookmark } from '@tiptap/pm/state';
import { X } from 'lucide-react';
import ModalWrap from '@/components/ui/molecules/ModalWrap';
import SearchMusic from '@/components/ui/organisms/SearchMusic';
import type { MusicContentItem } from '@/types/music-list-content';
import { insertMusicCard, type MusicCardAttributes } from './MusicCardNode';

interface MusicSearchDialogProps {
  editor: Editor;
  kind: MusicCardAttributes['kind'];
  bookmark: SelectionBookmark;
  onClose: () => void;
}

export default function MusicSearchDialog({ editor, kind, bookmark, onClose }: MusicSearchDialogProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MusicContentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wasEditable = editor.isEditable;
    editor.setEditable(false);
    return () => {
      if (!editor.isDestroyed) {
        const selection = editor.state.selection;
        editor.setEditable(wasEditable);
        editor.commands.focus(selection instanceof TextSelection ? selection.from : null);
      }
    };
  }, [editor]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (query.trim().length < 2) return;
      setLoading(true);
      try {
        const response = await fetch(`/api/music/search?q=${encodeURIComponent(query.trim())}&type=${kind}`, { signal: controller.signal });
        if (!response.ok) throw new Error('search failed');
        const items: MusicContentItem[] = await response.json();
        if (!Array.isArray(items)) throw new Error('invalid search results');
        if (!controller.signal.aborted) setResults(items.map((item) => ({ ...item, albumImageUrl: item.albumImageUrl || '' })));
      } catch {
        if (!controller.signal.aborted) setError('검색 결과를 불러오지 못했습니다. 잠시 후 다시 검색해주세요.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, kind]);

  const changeQuery = (value: string) => {
    setQuery(value);
    setResults([]);
    setError('');
    setLoading(value.trim().length >= 2);
  };
  const restoreSelection = () => {
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc)));
  };
  const cancel = () => { restoreSelection(); onClose(); };
  const select = (item: MusicContentItem) => {
    restoreSelection();
    if (insertMusicCard(editor, item, kind)) onClose();
    else setError('이 위치에 카드를 추가할 수 없습니다. 본문에서 다른 위치를 선택해주세요.');
  };
  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    // Enter in search must not submit the enclosing post form.
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Tab') return;
    const elements = panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]');
    if (!elements?.length) return;
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <ModalWrap onClose={cancel} overlayClassName="z-80" ariaLabel={kind === 'track' ? '곡 검색' : '앨범 검색'} panelClassName="h-[85dvh] md:h-[min(75dvh,640px)]">
      <div ref={panelRef} onKeyDown={trapFocus} className="relative h-full">
        <button type="button" onClick={cancel} aria-label="음악 검색 닫기" className="absolute right-5 top-5 z-20 rounded-md p-2 text-gray-400 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-neon-point"><X size={18} /></button>
        <SearchMusic searchQuery={query} setSearchQuery={changeQuery} searchType={kind} searchResults={results} setSearchResults={setResults}
          onSelect={select} isLoading={loading} error={error} showEmptyState insertionHint="항목을 선택하면 본문에서 선택한 위치에 카드가 추가됩니다." />
      </div>
    </ModalWrap>
  );
}
