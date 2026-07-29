import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['.cache/**', 'node_modules/**'],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...js.configs.recommended,
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/services/analysis/pageAnalyzer.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        axe: 'readonly',
      },
    },
  },
];
