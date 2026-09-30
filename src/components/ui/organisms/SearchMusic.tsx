"use client"

import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import SearchBar from '../molecules/SearchBar';
import { Disc, Music } from 'lucide-react';

interface SearchMusicItem {
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

interface SearchMusicProps {
    searchQuery: string;
    setSearchQuery: (val: string) => void;
    searchType: 'track' | 'album';
    searchResults: SearchMusicItem[];
    setSearchResults: (results: SearchMusicItem[]) => void;
    onSelect: (item: SearchMusicItem) => void;
    onClose?: () => void;
    isLoading?: boolean;
    error?: string;
    showEmptyState?: boolean;
    insertionHint?: string;
}

export default function SearchMusic({ searchQuery, setSearchQuery, searchType, searchResults, setSearchResults, onSelect, isLoading = false, error = '', showEmptyState = false, insertionHint }: SearchMusicProps) {
    return (
        <div className="relative flex flex-col h-full w-full rounded-2xl border border-white/10 bg-[#0f0f10] p-6 shadow-2xl sm:p-8">
            <div className="mb-5 flex w-full items-center justify-between gap-4">
                <div className="min-w-0">
                    <div className="text-base font-semibold text-white">
                        {searchType === 'track' ? '곡 추가' : '앨범 추가'}
                    </div>
                    <div className="mt-1 text-xs text-white/60">
                        {insertionHint ?? '검색 후 항목을 클릭하면 리스트에 추가됩니다.'}
                    </div>
                </div>
            </div>

            <div className="w-full">
                <SearchBar
                    rounded="md"
                    variant="form"
                    placeholder={searchType === 'track' ? '어떤 곡을 추가할까요?' : '어떤 앨범을 추가할까요?'}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onClear={() => setSearchQuery('')}
                    value={searchQuery}
                    autoFocus={true}
                />
            </div>
            {/* 검색 결과 리스트 */}
            <div aria-live="polite" role={error ? 'alert' : 'status'} className="mt-3 text-sm text-gray-400">
                {error || (isLoading ? '검색 중입니다…' : showEmptyState && searchResults.length === 0
                    ? searchQuery.trim().length < 2 ? '검색어를 두 글자 이상 입력해주세요.' : '검색 결과가 없습니다. 다른 검색어를 입력해주세요.'
                    : '')}
            </div>
            <AnimatePresence>
                {searchResults.length > 0 && (
                    <motion.ul
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="mt-4 w-full min-h-0 overflow-y-auto rounded-xl border border-white/10 bg-[#151517] shadow-2xl"
                    >
                        {searchResults.map((item) => (
                            <li key={item.id}>
                              <button type="button" aria-label={`${item.name} · ${item.artist} 추가`}
                                onClick={() => {
                                    onSelect(item);
                                    setSearchQuery('');
                                    setSearchResults([]);
                                }}
                                className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-neon-point"
                            >
                                {item.albumImageUrl ? <Image src={item.albumImageUrl} width={40} height={40} className="rounded shadow-md" alt={item.name} />
                                    : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-white/5 text-gray-400">{searchType === 'track' ? <Music size={20} /> : <Disc size={20} />}</span>}
                                <div className="flex flex-col overflow-hidden">
                                    <span className="truncate text-sm font-medium text-white">{item.name}</span>
                                    <span className="truncate text-xs text-white/60">{item.artist}</span>
                                </div>
                              </button>
                            </li>
                        ))}
                    </motion.ul>
                )}
            </AnimatePresence>
        </div>
    )
}
