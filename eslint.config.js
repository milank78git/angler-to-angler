import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    files: ['app/src/main/assets/**/*.js', 'web/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        Device: 'readonly',
        Android: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'max-len': ['error', { code: 160 }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[property.name=/^(innerHTML|outerHTML|insertAdjacentHTML)$/]',
          message: 'Use DOM nodes or the shared sanitized template renderer.',
        },
        {
          selector: "CallExpression[callee.object.name='document'][callee.property.name=/^write(ln)?$/]",
          message: 'Use DOM nodes.',
        },
      ],
      'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }],
    },
  },
];
