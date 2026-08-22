import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

/**
 * eslint-config-next 16 ships native flat configs, so they are spread directly
 * rather than wrapped in FlatCompat (which cannot serialise them).
 */
const config = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      // Copied verbatim from pdfjs-dist at postinstall.
      'public/pdfjs/**',
      // Node scripts, not part of the app's module graph.
      'scripts/**',
    ],
  },
  {
    rules: {
      // Appwrite's SDK surfaces plenty of loosely-typed payloads; narrowing them
      // at every call site would add noise without adding safety.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
];

export default config;
