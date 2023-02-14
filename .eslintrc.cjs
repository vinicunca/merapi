const { defineConfig } = require('eslint-define-config');

module.exports = defineConfig({
  extends: ['@vinicunca/eslint-config'],

  globals: {
    __VERSION__: 'readonly',
  },

  rules: {
    'sonarjs/cognitive-complexity': 'off',
    // 'react/prop-types': 'off',
    // 'react/jsx-key': 'off',
    // 'react/no-unknown-property': 'off',
    'no-restricted-syntax': 'off',
    'no-void': 'off',
    'vue/one-component-per-file': 'off',
    '@typescript-eslint/no-var-requires': 'off',
  },

  overrides: [
    {
      files: ['*.spec.*'],
      rules: {
        'no-unused-expressions': 'off',
        'sonarjs/no-duplicate-string': 'off',
      },
    },
    {
      files: ['*.tsx'],
      rules: {
        '@typescript-eslint/no-redeclare': 'off',
      },
    },
  ],
});
