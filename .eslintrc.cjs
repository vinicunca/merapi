const { defineConfig } = require('eslint-define-config');

module.exports = defineConfig({
  extends: ['@vinicunca/eslint-config'],

  rules: {
    'sonarjs/cognitive-complexity': 'off',
    'sonarjs/prefer-single-boolean-return': 'off',

    'no-restricted-syntax': 'off',
    'no-void': 'off',
    'prefer-promise-reject-errors': 'off',
    'no-case-declarations': 'off',
  },
});
