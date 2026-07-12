// Config ESLint (flat, ESM) — même philosophie que le framework : NON-INTRUSIVE.
// Les garde-fous sont VISIBLES dans l'éditeur (warn) mais ne bloquent que le vrai
// danger (variables mortes). Le STYLE est délégué à Prettier ; eslint-config-prettier
// neutralise les règles de style conflictuelles (pas de doublon eslint/prettier).
//
// NB outillage : eslint a besoin de l'API JS de TypeScript → devDep `typescript@6`.
// Le TYPECHECK de l'app, lui, passe par tsgo (`npm run typecheck`, port Go de tsc,
// beaucoup plus rapide). Deux outils, deux rôles — voir README § Qualité.
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettierConfig from "eslint-config-prettier";

export default [
  { ignores: ["node_modules/**", "dist/**", "var/**", "*.log"] },
  ...tsPlugin.configs["flat/recommended"],
  prettierConfig,
  {
    files: ["**/*.ts", "**/*.mts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2024, sourceType: "module" },
    },
    rules: {
      // Bloquant utile : le code mort part avant le commit.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // Standards framework en WARN — le zéro `any` est l'objectif, pas un mur.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      // Les logs applicatifs passent par this.log() (syslog structuré), pas console.
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // Tests et fichiers de config : on relâche.
    files: ["tests/**/*.ts", "*.config.{ts,mjs}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },
];
