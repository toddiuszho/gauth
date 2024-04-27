module.exports = {
  root: true,
  extends: ['./node_modules/gts'],
  plugins: ['node', 'prettier'],
  ignorePatterns: ['**/build/**/*', '**/node_modules/**'],
  overrides: [
    {
      files: ['*.ts'],
      parser: '@typescript-eslint/parser',
      extends: ['plugin:@typescript-eslint/recommended'],
      parserOptions: {
        project: ['tsconfig.json', 'e2e/tsconfig.json'],
        createDefaultProgram: true,
        tsconfigRootDir: __dirname,
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'warn',
        'no-console': 'off',
        'no-underscore-dangle': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/dot-notation': 'off',
        'prefer-arrow/prefer-arrow-functions': 'off',
        '@typescript-eslint/member-ordering': 'off',
        '@typescript-eslint/no-empty-interface': 'warn',
        '@typescript-eslint/ban-ts-comment': 'warn',
        // 'arrow-body-style': ['warn', 'never'],
        '@typescript-eslint/explicit-module-boundary-types': 'off', // Consider requiring return types
        '@typescript-eslint/ban-types': ['error', {extendDefaults: true, types: {object: false}}], // turn off linting for object type
      },
    },
  ],
}
