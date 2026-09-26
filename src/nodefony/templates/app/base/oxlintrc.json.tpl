{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "unicorn", "oxc", "promise", "import"],
  // Lint TYPÉ (paquet `oxlint-tsgolint`, en devDependency) : ces règles lisent
  // les types du compilateur, là où les autres ne voient que la syntaxe. C'est
  // la même rigueur que le framework s'impose à lui-même — un test du
  // framework compare les deux grilles.
  "options": {
    "typeAware": true,
    "reportUnusedDisableDirectives": "warn"
  },
  "categories": {
    "correctness": "error",
    "suspicious": "warn",
    "perf": "warn"
  },
  "env": { "node": true, "es2024": true },
  "ignorePatterns": ["node_modules/**", "dist/**", "var/**", "*.log"],
  "rules": {
    "no-unused-vars": [
      "error",
      {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
        "caughtErrors": "none"
      }
    ],
    "no-restricted-imports": [
      "error",
      {
        "paths": [
          {
            "name": "assert",
            "message": "Préfixe Node obligatoire : importe \"node:assert\"."
          },
          {
            "name": "buffer",
            "message": "Préfixe Node obligatoire : importe \"node:buffer\"."
          },
          {
            "name": "child_process",
            "message": "Préfixe Node obligatoire : importe \"node:child_process\"."
          },
          {
            "name": "crypto",
            "message": "Préfixe Node obligatoire : importe \"node:crypto\"."
          },
          {
            "name": "events",
            "message": "Préfixe Node obligatoire : importe \"node:events\"."
          },
          {
            "name": "fs",
            "message": "Préfixe Node obligatoire : importe \"node:fs\"."
          },
          {
            "name": "fs/promises",
            "message": "Préfixe Node obligatoire : importe \"node:fs/promises\"."
          },
          {
            "name": "http",
            "message": "Préfixe Node obligatoire : importe \"node:http\"."
          },
          {
            "name": "http2",
            "message": "Préfixe Node obligatoire : importe \"node:http2\"."
          },
          {
            "name": "https",
            "message": "Préfixe Node obligatoire : importe \"node:https\"."
          },
          {
            "name": "net",
            "message": "Préfixe Node obligatoire : importe \"node:net\"."
          },
          {
            "name": "os",
            "message": "Préfixe Node obligatoire : importe \"node:os\"."
          },
          {
            "name": "path",
            "message": "Préfixe Node obligatoire : importe \"node:path\"."
          },
          {
            "name": "process",
            "message": "Préfixe Node obligatoire : importe \"node:process\"."
          },
          {
            "name": "stream",
            "message": "Préfixe Node obligatoire : importe \"node:stream\"."
          },
          {
            "name": "timers",
            "message": "Préfixe Node obligatoire : importe \"node:timers\"."
          },
          {
            "name": "url",
            "message": "Préfixe Node obligatoire : importe \"node:url\"."
          },
          {
            "name": "util",
            "message": "Préfixe Node obligatoire : importe \"node:util\"."
          },
          {
            "name": "worker_threads",
            "message": "Préfixe Node obligatoire : importe \"node:worker_threads\"."
          }
        ]
      }
    ],
    // Une feuille de style s'importe POUR SON EFFET, sans rien affecter : c'est
    // la seule forme qu'un bundler accepte. La règle reste utile ailleurs (un
    // module importé pour effet de bord et oublié), d'où l'exception ciblée
    // plutôt que l'extinction.
    "import/no-unassigned-import": [
      "warn",
      { "allow": ["**/*.css", "**/*.scss", "**/*.sass", "**/*.less"] }
    ],
    "typescript/no-explicit-any": "warn",
    "typescript/ban-ts-comment": "warn",
    // ESM strict : une application Nodefony n'écrit jamais `require`.
    "typescript/no-require-imports": "warn",
    // Préréglage `strict-type-checked` de typescript-eslint : un `any` ne se
    // propage pas en silence — le lire, l'appeler, l'affecter ou le rendre
    // exige de l'avoir d'abord rétréci. Et `x!` affirme au compilateur une
    // absence de `null` qu'il ne peut pas vérifier.
    "typescript/no-unsafe-assignment": "warn",
    "typescript/no-unsafe-member-access": "warn",
    "typescript/no-unsafe-argument": "warn",
    "typescript/no-unsafe-return": "warn",
    "typescript/no-unsafe-call": "warn",
    "typescript/no-unnecessary-type-assertion": "warn",
    "typescript/no-non-null-assertion": "warn",
    // Les règles qui attrapent des DÉFAUTS : promesse lancée sans être
    // attendue ni gardée, callback async passé là où l'on attend du
    // synchrone, `return` sans `await` dans un `try` qui saute le `catch`,
    // rejet ou throw d'autre chose qu'une `Error`, `case` oublié quand une
    // union grandit.
    "typescript/no-misused-promises": "error",
    "typescript/return-await": "error",
    "typescript/prefer-promise-reject-errors": "error",
    "typescript/only-throw-error": "error",
    "typescript/use-unknown-in-catch-callback-variable": "error",
    "typescript/no-deprecated": "error",
    "typescript/consistent-type-exports": "error",
    "typescript/restrict-plus-operands": "error",
    "typescript/switch-exhaustiveness-check": "error",
    // `a && a.b` → `a?.b`. Le correctif automatique n'est pas sûr hors
    // condition : `a && a.b` rend `a` (`""`, `0`, `null`), `a?.b` rend `undefined`.
    "typescript/prefer-optional-chain": "error",
    // `describe`/`it`/`test` de `node:test` rendent une promesse que le runner
    // suit lui-même : déclarés sûrs ici, une fois.
    "typescript/no-floating-promises": [
      "error",
      {
        "allowForKnownSafeCalls": [
          {
            "from": "package",
            "package": "node:test",
            "name": ["describe", "it", "test", "suite"]
          }
        ]
      }
    ],
    // Allumées par les catégories mais hors du préréglage : `no-unsafe-type-
    // assertion` interdirait tout `as` qui rétrécit, y compris après une
    // validation ; `require-array-sort-compare` refuse un `sort()` de chaînes,
    // correct par défaut.
    "typescript/no-unsafe-type-assertion": "off",
    "typescript/require-array-sort-compare": "off",
    "typescript/no-empty-object-type": "off",
    "typescript/no-this-alias": "off",
    "no-eval": "error",
    "no-new-func": "error",
    "no-await-in-loop": "off",
    "no-console": "off",
    "unicorn/no-array-reverse": "off",
    "unicorn/consistent-function-scoping": "off",
    "typescript/no-extraneous-class": "off"
  },
  "overrides": [
    {
      "files": ["**/*.test.ts", "**/*.spec.ts", "tests/**/*.ts"],
      "rules": {
        "typescript/no-explicit-any": "off",
        // Un double de test manipule des formes partielles : les propagations
        // d'`any` et les `x!` sur un décor connu y sont admis. Et
        // `expect(mock.fn).toHaveBeenCalled()` référence une méthode sans la
        // lier : l'idiome du runner, pas un `this` perdu.
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-argument": "off",
        "typescript/no-unsafe-return": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unnecessary-type-assertion": "off",
        "typescript/no-non-null-assertion": "off",
        "typescript/unbound-method": "off",
        "typescript/no-implied-eval": "off",
        "no-unused-vars": "off",
        "no-unused-expressions": "off",
        "no-restricted-imports": "off",
        "promise/no-callback-in-promise": "off"
      }
    },
    {
      // JavaScript non typé : tout y est `any` par nature, les règles qui
      // suivent la propagation d'un `any` n'y ont aucun sens.
      "files": ["**/*.js", "**/*.mjs", "**/*.cjs"],
      "rules": {
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-argument": "off",
        "typescript/no-unsafe-return": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unnecessary-type-assertion": "off"
      }
    }
  ]
}
