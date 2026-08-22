#!/usr/bin/env node
/**
 * Creates an administrator, or promotes an existing account to one.
 *
 *   npm run make-admin -- you@example.com "Your Name"
 *   npm run make-admin -- you@example.com "Your Name" --password "secret123"
 *   npm run make-admin -- you@example.com --demote
 *
 * There is no sign-up form anywhere in Parva, and this is why: reader accounts
 * are created implicitly by Google, and administrators are made here, on a
 * machine that already holds the API key. Nobody can grant themselves the admin
 * label through the app.
 *
 * If the email already belongs to an account (including one created by signing
 * in with Google), that account is promoted rather than duplicated — which is
 * the usual path: sign in with Google once, then run this.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { Client, ID, Query, Users } from 'node-appwrite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_LABEL = 'admin';

/** A value already in the real environment wins over the file. */
function loadEnv() {
  let contents;
  try {
    contents = readFileSync(resolve(root, '.env'), 'utf8');
  } catch {
    // No .env. The environment may already carry what we need.
    return;
  }

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, '');
  }
}

loadEnv();

const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const API_KEY = process.env.APPWRITE_API_KEY;

if (!ENDPOINT || !PROJECT_ID || !API_KEY) {
  console.error('\n  Missing Appwrite configuration. See SETUP.md.\n');
  process.exit(1);
}

/* ── Arguments ──────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
const positional = argv.filter((arg) => !arg.startsWith('--'));

const passwordIndex = argv.indexOf('--password');
const explicitPassword = passwordIndex > -1 ? argv[passwordIndex + 1] : null;

// A value consumed by --password is not a positional argument.
const words = positional.filter((arg) => arg !== explicitPassword);

const email = words[0];
const name = words[1] ?? email?.split('@')[0];
const demote = flags.has('--demote');

if (!email || !email.includes('@')) {
  console.error(`
  Usage:
    npm run make-admin -- you@example.com "Your Name"
    npm run make-admin -- you@example.com "Your Name" --password "at-least-8-chars"
    npm run make-admin -- you@example.com --demote

  The usual path is to sign in with Google first, then run the first form —
  it promotes the account that already exists.
`);
  process.exit(1);
}

const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID).setKey(API_KEY);
const users = new Users(client);

async function findByEmail(address) {
  const result = await users.list({
    queries: [Query.equal('email', address.toLowerCase()), Query.limit(1)],
  });
  return result.users[0] ?? null;
}

async function main() {
  const existing = await findByEmail(email);

  /* ── Demote ───────────────────────────────────────────────────── */

  if (demote) {
    if (!existing) {
      console.error(`\n  No account for ${email}.\n`);
      process.exit(1);
    }
    const labels = (existing.labels ?? []).filter((label) => label !== ADMIN_LABEL);
    await users.updateLabels({ userId: existing.$id, labels });
    console.log(`\n  ${email} is no longer an administrator.\n`);
    return;
  }

  /* ── Promote an existing account ──────────────────────────────── */

  if (existing) {
    if ((existing.labels ?? []).includes(ADMIN_LABEL)) {
      console.log(`\n  ${email} is already an administrator. Nothing to do.\n`);
      return;
    }

    const labels = [...new Set([...(existing.labels ?? []), ADMIN_LABEL])];
    await users.updateLabels({ userId: existing.$id, labels });

    console.log(`
  ${email} is now an administrator.

  Sign out and back in for the change to take effect, then open /admin.
`);
    return;
  }

  /* ── Create a new admin account ───────────────────────────────── */

  // A generated password is stronger than one typed under pressure, and it is
  // only needed if this admin signs in by email rather than Google.
  const password = explicitPassword ?? randomBytes(12).toString('base64url');

  if (explicitPassword && explicitPassword.length < 8) {
    console.error('\n  Appwrite requires a password of at least 8 characters.\n');
    process.exit(1);
  }

  const created = await users.create({
    userId: ID.unique(),
    email: email.toLowerCase(),
    password,
    name,
  });

  await users.updateLabels({ userId: created.$id, labels: [ADMIN_LABEL] });

  console.log(`
  Administrator created.

    Email     ${email}
    Name      ${name}
    Password  ${password}
${explicitPassword ? '' : '\n  That password was generated. Save it now — it is not stored anywhere else.'}

  Sign in at /sign-in using "Administrator sign-in", or with Google if this
  address is a Google account.
`);
}

main().catch((error) => {
  console.error('\n  Could not do that.\n');
  if (error?.code === 401) {
    console.error('  Appwrite rejected the API key. It needs the `users.*` scopes.');
  } else if (error?.code === 409) {
    console.error('  That email is already taken by another account.');
  } else {
    console.error(`  ${error?.message ?? error}`);
  }
  console.error('');
  process.exit(1);
});
