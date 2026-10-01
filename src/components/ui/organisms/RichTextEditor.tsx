'use client';

import { useState } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, Heading2, Heading3, List, ListOrdered, Quote, Link as LinkIcon, Unlink, Undo2, Redo2, Type } from 'lucide-react';
import { MusicCardNode } from './editor/MusicCardNode';
import MusicSearchDialog from './editor/MusicSearchDialog';
import type { SelectionBookmark } from '@tiptap/pm/state';
import type { RichTextDocument } from '@/types/music-list-content';

const editorContentClassName = [
  'min-h-[300px] p-4 text-sm leading-[1.9] text-gray-300 outline-none whitespace-pre-wrap [overflow-wrap:anywhere] sm:min-h-[360px] sm:p-6 sm:text-base',
  '[&>*+*]:mt-[1em] [&>:first-child]:mt-0',
  '[&_p]:min-h-[1.9em]',
  '[&_h2]:mt-[1.4em] [&_h2]:text-[1.5em] [&_h2]:leading-[1.5] [&_h2]:font-bold [&_h2]:text-white',
  '[&_h3]:mt-[1.2em] [&_h3]:text-[1.2em] [&_h3]:leading-[1.6] [&_h3]:font-semibold [&_h3]:text-white',
  '[&_strong]:font-bold [&_strong]:text-white [&_em]:italic',
  '[&_ul]:list-disc [&_ul]:pl-[1.6em] [&_ol]:list-decimal [&_ol]:pl-[1.6em]',
  '[&_li+li]:mt-[0.35em] [&_li_p]:m-0',
  '[&_blockquote]:border-l-[3px] [&_blockquote]:border-neon-point [&_blockquote]:px-[1em] [&_blockquote]:py-[0.35em] [&_blockquote]:text-gray-400',
  '[&_a]:text-neon-point [&_a]:underline [&_a]:underline-offset-[3px]',
  '[&_hr]:my-[1.5em] [&_hr]:border-t [&_hr]:border-white/15',
].join(' ');

interface RichTextEditorProps {
  initialContent?: RichTextDocument;
  onChange?: (document: RichTextDocument) => void;
  musicKind?: 'track' | 'album';
}

export default function RichTextEditor({ initialContent, onChange, musicKind }: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({
      heading: { levels: [2, 3] },
      codeBlock: false,
      link: { openOnClick: false, defaultProtocol: 'https', protocols: ['http', 'https'] },
    }), MusicCardNode],
    content: initialContent ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    onUpdate: ({ editor }) => onChange?.(editor.getJSON() as RichTextDocument),
    editorProps: { attributes: { class: editorContentClassName, role: 'textbox', 'aria-label': '본문 편집', 'aria-multiline': 'true' } },
  });
  if (!editor) return <div className="min-h-80 rounded-xl border border-white/10 p-5 text-gray-400">에디터를 불러오는 중입니다.</div>;
  return <ReadyEditor editor={editor} musicKind={musicKind} />;
}

function ReadyEditor({ editor, musicKind }: { editor: Editor; musicKind?: 'track' | 'album' }) {
  const [musicSearch, setMusicSearch] = useState<{ kind: 'track' | 'album'; bookmark: SelectionBookmark } | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [linkError, setLinkError] = useState('');
  const state = useEditorState({ editor, selector: ({ editor }) => ({
    bold: editor.isActive('bold'), italic: editor.isActive('italic'),
    h2: editor.isActive('heading', { level: 2 }), h3: editor.isActive('heading', { level: 3 }),
    bullet: editor.isActive('bulletList'), ordered: editor.isActive('orderedList'),
    quote: editor.isActive('blockquote'), link: editor.isActive('link'),
    undo: editor.can().undo(), redo: editor.can().redo(),
  }) });

  const buttons = [
    { label: '본문', icon: Type, run: () => editor.chain().focus().setParagraph().run() },
    { label: '소제목', icon: Heading2, active: state.h2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: '작은 소제목', icon: Heading3, active: state.h3, run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: '굵게', icon: Bold, active: state.bold, run: () => editor.chain().focus().toggleBold().run() },
    { label: '기울임', icon: Italic, active: state.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { label: '글머리 목록', icon: List, active: state.bullet, run: () => editor.chain().focus().toggleBulletList().run() },
    { label: '번호 목록', icon: ListOrdered, active: state.ordered, run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: '인용문', icon: Quote, active: state.quote, run: () => editor.chain().focus().toggleBlockquote().run() },
    { label: '링크', icon: LinkIcon, active: state.link, run: () => { setUrl(editor.getAttributes('link').href ?? ''); setLinkError(''); setLinkOpen(!linkOpen); } },
    { label: '링크 해제', icon: Unlink, disabled: !state.link, run: () => editor.chain().focus().extendMarkRange('link').unsetLink().run() },
    { label: '실행 취소', icon: Undo2, disabled: !state.undo, run: () => editor.chain().focus().undo().run() },
    { label: '다시 실행', icon: Redo2, disabled: !state.redo, run: () => editor.chain().focus().redo().run() },
  ];

  const applyLink = () => {
    const raw = url.trim();
    const href = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    try {
      const parsed = new URL(href);
      if (!raw || !['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw new Error('invalid URL');
      const chain = editor.chain().focus();
      if (editor.isActive('link')) chain.extendMarkRange('link');
      if (editor.state.selection.empty && !editor.isActive('link')) {
        chain.insertContent({ type: 'text', text: raw, marks: [{ type: 'link', attrs: { href } }] }).run();
      } else chain.setLink({ href }).run();
      setLinkOpen(false);
    } catch { setLinkError('http 또는 https 주소를 입력해주세요.'); }
  };

  return (
    <div className="rounded-xl border border-white/15 bg-black/20 focus-within:border-neon-point/60">
      <div className="sticky top-0 z-30 rounded-t-xl bg-[#121212] shadow-md shadow-black/20">
      <div role="group" aria-label="본문 서식" className="flex flex-wrap gap-1 border-b border-white/10 bg-white/[0.03] p-2">
        {buttons.map(({ label, icon: Icon, active, disabled, run }) => (
          <button key={label} type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled}
            onMouseDown={(event) => event.preventDefault()} onClick={run}
            className={`rounded-md p-2 transition-colors focus-visible:outline-2 focus-visible:outline-neon-point disabled:cursor-not-allowed disabled:opacity-30 ${active ? 'bg-neon-point/15 text-neon-point' : 'text-gray-300 hover:bg-white/10 hover:text-white'}`}>
            <Icon size={18} />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <span className="text-xs text-gray-500">음악 카드</span>
        {musicKind !== 'album' && <button type="button" onMouseDown={(event) => event.preventDefault()}
          onClick={() => setMusicSearch({ kind: 'track', bookmark: editor.state.selection.getBookmark() })}
          className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/10">곡 추가</button>}
        {musicKind !== 'track' && <button type="button" onMouseDown={(event) => event.preventDefault()}
          onClick={() => setMusicSearch({ kind: 'album', bookmark: editor.state.selection.getBookmark() })}
          className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/10">앨범 추가</button>}
      </div>
      {linkOpen && <div className="border-b border-white/10 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="editor-link" className="text-sm text-gray-300">링크 주소</label>
          <input id="editor-link" type="text" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com"
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyLink(); } if (event.key === 'Escape') { setLinkOpen(false); editor.commands.focus(); } }}
            className="min-w-0 flex-1 rounded-md border border-white/15 bg-black px-3 py-2 text-sm text-white focus:outline-neon-point" />
          <button type="button" onClick={applyLink} className="rounded-md bg-neon-point px-3 py-2 text-sm font-medium text-white">적용</button>
          <button type="button" onClick={() => { setLinkOpen(false); editor.commands.focus(); }} className="px-2 py-2 text-sm text-gray-400">취소</button>
        </div>
        {linkError && <p role="alert" className="mt-2 text-sm text-red-400">{linkError}</p>}
      </div>}
      </div>
      <EditorContent editor={editor} />
      {musicSearch && <MusicSearchDialog editor={editor} kind={musicSearch.kind} bookmark={musicSearch.bookmark} onClose={() => setMusicSearch(null)} />}
    </div>
  );
}
