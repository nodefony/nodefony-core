// Config ESLint RACINE (flat, ESM) — couvre tout le monorepo.
// Philosophie : NON-INTRUSIVE. Les règles « dures » (any, console, node:)
// sont en `warn` → visibles dans l'éditeur, mais ne bloquent jamais un commit.
// Seul le `pre-push` (typecheck) peut bloquer, et il est bypassable (--no-verify).
// Prettier gère le style ; eslint-config-prettier désactive les règles de style
// conflictuelles (pas de prettier-as-eslint-error = pas de bruit).
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettierConfig from "eslint-config-prettier";

// Modules natifs Node : on veut le préfixe `node:` (règle projet). En `warn`.
const NODE_BUILTINS = [
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "crypto",
  "dns",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "querystring",
  "readline",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
];

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/.coverage/**",
      "**/bin/**",
      ".ai/**",
      "**/*.generated.*",
      "src/**/frontend/dist/**",
      "src/nodefony/src/service/babel/**",
    ],
  },
  ...tsPlugin.configs["flat/recommended"],
  prettierConfig,
  {
    files: ["**/*.ts", "**/*.mts", "**/*.cts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    rules: {
      // Bloquant utile (fixable, garde le code propre) :
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      // Standards projet en WARN (visibilité, jamais bloquant — repo en migration) :
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "no-console": ["warn", { allow: ["warn", "error", "trace"] }],
      "no-restricted-imports": [
        "warn",
        {
          paths: NODE_BUILTINS.map((name) => ({
            name,
            message: `Préfixe Node obligatoire : importe "node:${name}".`,
          })),
        },
      ],
      "@typescript-eslint/ban-types": "off",
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  {
    // Tests & scripts & fichiers de config : on relâche.
    files: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/tests/**/*.ts",
      "**/*.config.{ts,mts,cts,js,mjs,cjs}",
      "scripts/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-console": "off",
      "no-restricted-imports": "off",
    },
  },
];
