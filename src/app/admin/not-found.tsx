import { ArrowRight } from 'lucide-react';

import { ButtonLink } from '@/components/ui/button';

/**
 * Renders inside the admin layout, so the librarian keeps the nav and the
 * signed-in-as line. A mistyped record id belongs here rather than on the
 * public 404, which would drop them out of the admin entirely.
 */
export default function AdminNotFound() {
  return (
    <div>
      <p className="label">404</p>
      <h1 className="display mt-4 text-[2rem]">Nothing at this address.</h1>
      <p className="mt-3 max-w-md text-[0.875rem] text-graphite">
        The record was deleted, or the id in the URL does not match one. The catalogue
        listing has every book that does exist.
      </p>

      <ButtonLink href="/admin/books" variant="ink" size="md" className="mt-7">
        All books
        <ArrowRight className="size-4" strokeWidth={1.5} />
      </ButtonLink>
    </div>
  );
}
