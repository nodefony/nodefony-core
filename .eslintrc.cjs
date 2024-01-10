module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint','prettier'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  rules: {
    // Ajoutez vos règles personnalisées ici
  },
};