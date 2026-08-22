import Link from 'next/link';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * Buttons are rectangles with hairline borders. No radius, no gradient, no
 * shadow — the book objects are the only things in this app allowed to look
 * three-dimensional, and a button competing with them would flatten the whole
 * idea. Emphasis comes from fill, not from shape.
 */

type Variant = 'ink' | 'outline' | 'quiet' | 'ribbon';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  ink: 'ink-fill border border-ink hover:bg-ink-soft',
  outline: 'border border-rule text-ink hover:border-ink hover:ink-fill',
  quiet: 'border border-transparent text-graphite hover:text-ink hover:bg-wash',
  ribbon: 'border border-ribbon bg-ribbon text-paper hover:bg-[#a50f1a]',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[0.75rem]',
  md: 'h-10 px-4 text-[0.8125rem]',
  lg: 'h-12 px-6 text-[0.875rem]',
};

const BASE =
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium tracking-[0.01em] transition-colors duration-200 disabled:pointer-events-none disabled:opacity-40';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'outline', size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      {...props}
    />
  );
});

export function ButtonLink({
  className,
  variant = 'outline',
  size = 'md',
  href,
  ...props
}: React.ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return (
    <Link href={href} className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props} />
  );
}

/** Square icon button. Used across the reader chrome and admin tables. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
    variant?: Variant;
    active?: boolean;
    size?: 'sm' | 'md';
  }
>(function IconButton(
  { className, label, variant = 'quiet', active = false, size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={cn(
        'relative inline-grid place-items-center transition-colors duration-200 disabled:pointer-events-none disabled:opacity-35',
        // See globals.css: on a touch screen the pressable area grows to 44px
        // around the icon while the drawn box stays this size.
        'touch-target',
        size === 'sm' ? 'size-8' : 'size-10',
        active ? 'ink-fill border border-ink' : VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
});
