import { notFound } from 'next/navigation';

import { getBookForAdmin } from '@/lib/appwrite/books';
import { BookForm } from '@/components/admin/book-form';
import { formatBytes, formatDate, pluralize } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function EditBookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const book = await getBookForAdmin(id);
  if (!book) notFound();

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="display text-[2rem]">{book.title}</h1>
        <p className="text-[0.75rem] text-graphite">
          {book.format.toUpperCase()} · {formatBytes(book.fileSize)}
          {book.pageCount ? ` · ${pluralize(book.pageCount, 'page')}` : ''} · added{' '}
          {formatDate(book.$createdAt)}
        </p>
      </div>

      <p className="mt-2.5 text-[0.875rem] text-graphite">
        The file itself cannot be swapped here — upload a new book for that, so nobody
        loses the place they had in this one.
      </p>

      <div className="mt-10">
        <BookForm book={book} />
      </div>
    </div>
  );
}
