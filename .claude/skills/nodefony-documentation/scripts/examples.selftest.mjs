#!/usr/bin/env node
/**
 * Auto-contrôle de la garde des exemples (`examples.mjs`).
 *
 * Chaque cas rouge est un défaut CONSTATÉ dans une page publiée ; chaque cas vert est une
 * forme légitime que la garde ne doit PAS punir (prose, commentaire, exception déclarée).
 *
 * ```bash
 * node .claude/skills/nodefony-documentation/scripts/examples.selftest.mjs
 * ```
 */
import { exampleDefects } from "./examples.mjs";

let reds = 0;
const check = (name, got, expected) => {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) reds += 1;
  console.log(
    `  ${ok ? "✅" : "❌"} ${name}${ok ? "" : ` — attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(got)}`}`,
  );
};
const fence = (body, lang = "typescript") =>
  "```" + lang + "\n" + body + "\n```\n";
const lines = (src) => exampleDefects(src).map((d) => d.line);

console.log("━━ process.env");
check(
  "PG_URL lu en direct dans un exemple (tutorial-entity.md)",
  lines(fence('analytics: { dialect: "postgres", url: process.env.PG_URL },')),
  [2],
);
check(
  "la forme à crochets est lue aussi",
  lines(fence('const s = process.env["NF_X"];')),
  [2],
);
check(
  "même avec le préfixe NF_ : la règle est « env.ts », pas « un préfixe »",
  lines(fence("secret: process.env.NF_JWT_KEYSET,")),
  [2],
);
check(
  "la prose qui cite process.env n'est pas un exemple",
  lines("Le seul lecteur de `process.env.` est env.ts.\n"),
  [],
);
check(
  "le point final d'une phrase en commentaire ne mord pas",
  lines(
    fence(
      "// Catalogue TYPÉ. C'est le seul lecteur de process.env.\nconst a = 1;",
    ),
  ),
  [],
);
check(
  "un commentaire de fin de ligne n'est pas du code",
  lines(fence("const a = 1; // pas process.env.X ici")),
  [],
);
check(
  "ctx.env.X est la forme attendue",
  lines(fence("url: ctx.env.NF_DATABASE_URL,")),
  [],
);
check(
  "l'exception déclarée avant la fence lève le bloc, et lui seul",
  lines(
    "<!-- doc-lint: process-env — script hors application -->\n" +
      fence("const s = process.env.NF_HOOK;") +
      "\n" +
      fence("const t = process.env.NF_AUTRE;"),
  ),
  [7],
);

console.log("━━ nodefony/databases/");
check(
  "base sous le dossier du code (orm-core/docs/index.md)",
  lines(
    fence(
      'default: { dialect: "sqlite", filename: "nodefony/databases/app.db" },',
    ),
  ),
  [2],
);
check(
  "var/databases/ est le bon rangement",
  lines(fence('filename: "var/databases/app.db"')),
  [],
);
check(
  "hors bloc de code (prose), pas de défaut",
  lines("Ne pas écrire `nodefony/databases/app.db`.\n"),
  [],
);

console.log(reds ? `\n${reds} rouge(s)\n` : "\ntout est vert\n");
process.exit(reds ? 1 : 0);
