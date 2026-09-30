import Link from 'next/link';
import RichTextEditor from '@/components/ui/organisms/RichTextEditor';

export default function EditorPreviewPage() {
  return (
    <section className="mx-auto w-full max-w-3xl rounded-2xl border border-gray-800 bg-[#121212] p-4 sm:p-8">
      <Link href="/createList" className="text-sm text-gray-400 hover:text-white">← 리스트 작성으로 돌아가기</Link>
      <h1 className="mt-5 text-2xl font-bold text-white">본문 에디터 미리보기</h1>
      <p className="mb-5 mt-2 text-sm leading-6 text-gray-400">커서가 있는 위치에 곡 또는 앨범 카드가 추가됩니다.</p>
      <RichTextEditor />
      <p className="mt-3 text-xs text-gray-500">문장을 선택해 서식을 적용할 수 있습니다. Ctrl/Cmd + Z로 실행을 취소합니다.</p>
    </section>
  );
}
