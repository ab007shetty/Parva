import { ArrowRight } from 'lucide-react';

import { APP_NAME } from '@/lib/config';
import { ButtonLink } from '@/components/ui/button';

/**
 * An empty shelf is an invitation to act, not an apology. Two different
 * audiences land here, so each gets the next step that is actually theirs:
 * the admin gets the upload desk, a reader gets an honest "nothing yet".
 */
export function EmptyLibrary({ isAdmin }: { isAdmin: boolean }) {
  return (
    <section className="px-[var(--page-gutter)] py-24 sm:py-32">
      <p className="label">{APP_NAME}</p>
      <div className="shelf-rule mt-4" />

      <h1 className="display mt-10 max-w-3xl text-[clamp(2.5rem,7vw,5rem)]">
        {isAdmin ? 'The shelf is empty. Put the first book on it.' : 'Nothing is on the shelf yet.'}
      </h1>

      <p className="prose-read mt-6 max-w-lg">
        {isAdmin
          ? 'Upload a PDF or EPUB and it appears here the moment you publish it. Covers, titles and authors are read out of the file, so most books need nothing but a drop.'
          : 'Books added by the librarian show up here straight away — and open without an account when they do.'}
      </p>

      {isAdmin && (
        <div className="mt-10">
          <ButtonLink href="/admin/books/new" variant="ink" size="lg">
            Add a book
            <ArrowRight className="size-4" strokeWidth={1.5} />
          </ButtonLink>
        </div>
      )}
    </section>
  );
}
