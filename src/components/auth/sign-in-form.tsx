'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Two ways in, and they are not equals.
 *
 * Google is the reader's path and gets the whole button. Email and password is
 * the administrator's path — there is no reader sign-up — so it hides behind a
 * disclosure rather than sitting there inviting people to look for a register
 * link that does not exist.
 */
export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [staffOpen, setStaffOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitStaff(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/staff', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? 'That sign-in did not work.');
        return;
      }

      // An admin goes to the desk; anyone else goes where they were headed.
      router.push(data.isAdmin ? data.next : next);
      // The header renders from a server component, so it needs a refresh to
      // pick up the new session.
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {/* A link, not a fetch: this is a full-page redirect to Google. */}
      <a
        href={`/api/auth/google?next=${encodeURIComponent(next)}`}
        className="flex h-12 w-full items-center justify-center gap-3 border border-ink bg-ink px-5 text-[0.875rem] font-medium text-paper transition-colors hover:bg-ink-soft"
      >
        <GoogleMark />
        Continue with Google
      </a>

      <div className="mt-8 border-t border-rule pt-5">
        {!staffOpen ? (
          <button
            type="button"
            onClick={() => setStaffOpen(true)}
            className="link-rule text-[0.75rem] text-graphite hover:text-ink"
          >
            Email sign-in
          </button>
        ) : (
          <form onSubmit={submitStaff} className="space-y-4">

            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="username"
              required
            />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              required
            />

            {error && (
              <p role="alert" className="border-l-2 border-ribbon pl-3 text-[0.75rem] text-ink-soft">
                {error}
              </p>
            )}

            <Button type="submit" variant="ink" size="md" disabled={busy} className="w-full">
              {busy && <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />}
              {busy ? 'Signing in' : 'Sign in'}
            </Button>

            <button
              type="button"
              onClick={() => setStaffOpen(false)}
              className="link-rule text-[0.75rem] text-graphite hover:text-ink"
            >
              Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
  required,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="label mb-2 block">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        className="h-10 w-full border border-rule bg-transparent px-3 text-[0.875rem] outline-none transition-colors focus:border-ink"
      />
    </label>
  );
}

/** Google's mark, inline so there is no third-party request on the sign-in page. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden="true">
      <path
        fill="#FFFFFF"
        d="M12.24 10.29v3.7h5.2a4.53 4.53 0 0 1-1.96 2.98l-.01.09 2.85 2.2.2.02c1.81-1.67 2.85-4.13 2.85-7.06 0-.68-.06-1.34-.17-1.97z"
      />
      <path
        fill="#FFFFFF"
        d="M12.24 21c2.61 0 4.8-.86 6.4-2.34l-3.05-2.36c-.82.57-1.9.97-3.35.97a5.53 5.53 0 0 1-5.23-3.82l-.09.01-2.94 2.28-.03.09A11.02 11.02 0 0 0 12.24 21"
        opacity="0.75"
      />
      <path
        fill="#FFFFFF"
        d="M7.01 13.45a5.45 5.45 0 0 1 0-3.5l-.01-.1-2.97-2.3-.1.04a11 11 0 0 0 0 8.22l3.08-2.36"
        opacity="0.55"
      />
      <path
        fill="#FFFFFF"
        d="M12.24 6.13c1.62 0 2.72.7 3.34 1.29l2.44-2.38C16.52 3.62 14.85 3 12.24 3A11.02 11.02 0 0 0 3.93 7.59l3.07 2.36a5.55 5.55 0 0 1 5.24-3.82"
        opacity="0.9"
      />
    </svg>
  );
}
