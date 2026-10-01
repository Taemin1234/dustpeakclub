'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Disc, LockKeyhole, LockKeyholeOpen, Music, Star, Trash2 } from 'lucide-react';
import Button from '@/components/ui/atoms/Button';
import Input from '@/components/ui/atoms/Input';
import SearchBar from '@/components/ui/molecules/SearchBar';
import TypeSelector from '@/components/ui/molecules/TypeSelector';
import RichTextEditor from '@/components/ui/organisms/RichTextEditor';
import { contentBlocksToEditorDocument, editorDocumentToContentBlocks } from '@/lib/rich-text-content';
import type { FeaturedSectionOption } from '@/lib/music-lists';
import type { MusicContentItem, MusicListContentBlock } from '@/types/music-list-content';

type SearchType = 'track' | 'album';
type Visibility = 'PUBLIC' | 'PRIVATE';
type SubmitMethod = 'POST' | 'PATCH';

export type MusicListFormItem = MusicContentItem;

export interface MusicListFormValues {
  title: string;
  visibility: Visibility;
  tags: string[];
  contentBlocks: MusicListContentBlock[];
}

interface MusicListFormProps {
  pageTitle?: string;
  submitLabel?: string;
  initialType?: SearchType;
  initialValues?: Partial<MusicListFormValues>;
  lockType?: boolean;
  submitMethod?: SubmitMethod;
  submitEndpoint?: string;
  successRedirectPath?: string;
  featuredSections?: FeaturedSectionOption[];
}

const typeOptions = [
  { value: 'track', label: '플레이리스트', icon: <Music size={16} /> },
  { value: 'album', label: '앨범리스트', icon: <Disc size={16} /> },
] as const;

const normalizeTag = (tag: string) => tag.replace(/\s+/g, '');
const createTextBlock = (id = crypto.randomUUID()): MusicListContentBlock => ({
  id,
  type: 'text',
  content: '',
});

export default function MusicListForm({
  pageTitle = '새 리스트 만들기',
  submitLabel = '등록하기',
  initialType = 'track',
  initialValues,
  lockType = false,
  submitMethod = 'POST',
  submitEndpoint,
  successRedirectPath = '/mypage',
  featuredSections = [],
}: MusicListFormProps) {
  const router = useRouter();

  const [searchType, setSearchType] = useState<SearchType>(initialType);
  const [contentBlocks, setContentBlocks] = useState<MusicListContentBlock[]>(
    initialValues?.contentBlocks?.length ? initialValues.contentBlocks : [createTextBlock('initial-text-block')]
  );
  const [tagInput, setTagInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [featuredSectionIds, setFeaturedSectionIds] = useState<string[]>([]);

  const [form, setForm] = useState({
    title: initialValues?.title ?? '',
    visibility: initialValues?.visibility ?? ('PUBLIC' as Visibility),
    tags: initialValues?.tags ?? [],
  });

  const endpoint = useMemo(() => {
    if (submitEndpoint) return submitEndpoint;
    return searchType === 'track' ? '/api/music/playlist' : '/api/music/albumlist';
  }, [searchType, submitEndpoint]);

  const handleTypeChange = (type: SearchType) => {
    if (lockType) return;
    setSearchType(type);
    setContentBlocks([createTextBlock()]);
  };

  const handleAddTag = () => {
    const tag = normalizeTag(tagInput);
    if (!tag) return;

    setForm((prev) => {
      if (prev.tags.includes(tag)) return prev;
      if (prev.tags.length >= 10) {
        alert('태그는 최대 10개까지 입력할 수 있습니다.');
        return prev;
      }
      return { ...prev, tags: [...prev.tags, tag] };
    });

    setTagInput('');
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    handleAddTag();
  };

  const handleRemoveTag = (indexToRemove: number) => {
    setForm((prev) => ({
      ...prev,
      tags: prev.tags.filter((_, index) => index !== indexToRemove),
    }));
  };

  const handleToggleVisibility = () => {
    setForm((prev) => ({
      ...prev,
      visibility: prev.visibility === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC',
    }));
    if (form.visibility === 'PUBLIC') {
      setFeaturedSectionIds([]);
    }
  };

  const handleToggleFeaturedSection = (sectionId: string) => {
    setFeaturedSectionIds((current) =>
      current.includes(sectionId)
        ? current.filter((currentSectionId) => currentSectionId !== sectionId)
        : [...current, sectionId]
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    const hasText = contentBlocks.some((block) => block.type === 'text' && block.content.trim());
    const hasMusic = contentBlocks.some((block) => block.type === 'music');
    if (!form.title.trim() || !hasText || !hasMusic) {
      alert('제목, 내용, 음악을 모두 입력해주세요.');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(endpoint, {
        method: submitMethod,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          type: searchType,
          contentBlocks,
          ...(featuredSections.length > 0 ? { featuredSectionIds } : {}),
        }),
      });

      const text = await response.text();
      if (!response.ok) throw new Error(text || 'request failed');

      alert(submitMethod === 'PATCH' ? '리스트가 수정되었습니다.' : '리스트가 저장되었습니다.');
      router.push(successRedirectPath);
      router.refresh();
    } catch (error) {
      console.error(error);
      alert(submitMethod === 'PATCH' ? '수정 중 오류가 발생했습니다.' : '저장 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center">
      <motion.div className="relative w-full rounded-2xl border border-gray-800 bg-[#121212] py-5 px-3 md:p-8">
        <h2 className="mb-6 font-sans text-2xl font-bold text-neon-point">{pageTitle}</h2>

        <div className="flex flex-col items-end justify-between sm:flex-row sm:items-center">
          <div className={`w-full ${lockType ? 'pointer-events-none opacity-70' : ''}`}>
            <TypeSelector
              name="searchType"
              ariaLabel="리스트 유형 선택"
              value={searchType}
              options={typeOptions}
              onChange={handleTypeChange}
              className='w-full sm:max-w-fit'
            />
          </div>

          <div className="flex mt-2 items-center justify-between gap-1.5 px-1 sm:mt-0">
            <p className="shrink-0 text-sm font-medium text-white">비밀글</p>

            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                className="sr-only"
                checked={form.visibility === 'PRIVATE'}
                onChange={handleToggleVisibility}
                aria-label="비밀글 설정"
              />

              <div
                className={`relative flex h-8 w-14 items-center rounded-full p-1 transition-colors duration-300 ${form.visibility === 'PUBLIC' ? 'bg-gray-800' : 'bg-neon-point/30'}`}
              >
                <motion.div
                  className={`flex h-6 w-6 items-center justify-center rounded-full shadow-md ${form.visibility === 'PUBLIC' ? 'bg-gray-600' : 'bg-neon-point/30'}`}
                  layout
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  initial={false}
                  animate={{ x: form.visibility === 'PUBLIC' ? 0 : 24 }}
                >
                  {form.visibility === 'PUBLIC' ? <LockKeyholeOpen size={16} /> : <LockKeyhole size={16} />}
                </motion.div>
              </div>
            </label>
          </div>
        </div>

        <form className="mt-4 space-y-4" onSubmit={handleSave}>
          <Input
            placeholder={searchType === 'track' ? '플레이리스트 제목' : '앨범리스트 제목'}
            value={form.title}
            onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
          />
          <RichTextEditor
            key={searchType}
            musicKind={searchType}
            initialContent={contentBlocksToEditorDocument(initialValues?.contentBlocks ?? [], searchType)}
            onChange={(document) => setContentBlocks(editorDocumentToContentBlocks(document))}
          />
          {submitMethod === 'POST' && featuredSections.length > 0 ? (
            <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-4">
              <div className="flex items-start gap-3">
                <Star size={18} className="mt-0.5 shrink-0 text-amber-300" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-amber-200">특별게시물 설정</p>
                  <p className="mt-1 text-xs text-gray-400">공개 게시글만 특별 섹션에 등록할 수 있습니다.</p>
                  <div className="mt-3 space-y-2">
                    {featuredSections.map((section) => (
                      <label key={section.id} className="flex cursor-pointer items-center gap-2 text-sm text-white">
                        <input
                          type="checkbox"
                          checked={featuredSectionIds.includes(section.id)}
                          onChange={() => handleToggleFeaturedSection(section.id)}
                          disabled={form.visibility !== 'PUBLIC'}
                          className="h-4 w-4 accent-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        {section.name}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-400">태그 ({form.tags.length}/10)</label>
            <div className="mt-3">
              <SearchBar
                variant="form"
                placeholder="태그를 입력해주세요"
                value={tagInput}
                onChange={(e) => setTagInput(normalizeTag(e.target.value))}
                onClear={() => setTagInput('')}
                onClick={handleAddTag}
                onKeyDown={handleTagInputKeyDown}
              />
            </div>

            <div className="mb-2 flex flex-wrap gap-2">
              <AnimatePresence>
                {form.tags.map((tag, index) => (
                  <motion.span
                    key={`${tag}-${index}`}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex items-center gap-1 rounded-full border border-neon-point/30 bg-neon-point/10 px-3 py-1 text-sm text-neon-point"
                  >
                    #{tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(index)}
                      className="cursor-pointer transition-colors hover:text-white"
                    >
                      <Trash2 size={12} className="ml-1" />
                    </button>
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => router.back()}>
                취소
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? '처리 중...' : submitLabel}
              </Button>
            </div>
          </div>
        </form>
      </motion.div>

    </div>
  );
}
