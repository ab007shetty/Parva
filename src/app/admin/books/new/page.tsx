import { BookForm } from '@/components/admin/book-form';

export default function NewBookPage() {
  return (
    <div>
      <h1 className="display text-[2rem]">Add a book</h1>
      <p className="mt-2.5 max-w-lg text-[0.875rem] text-graphite">
        Drop the file first — its title, author and cover are read straight out of it,
        so most books are one action away from the shelf.
      </p>

      <div className="mt-10">
        <BookForm />
      </div>
    </div>
  );
}
