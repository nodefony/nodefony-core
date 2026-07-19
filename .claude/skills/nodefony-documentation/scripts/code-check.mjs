#!/usr/bin/env node
/**
 * code-check.mjs — gate de COMPILABILITÉ du « Démarrage rapide » (standard §8sexies).
 *
 * Le standard exige que les blocs ```ts de la section « Démarrage rapide » soient
 * autonomes et compilent contre les VRAIS paquets du repo, du point de vue d'une app
 * consommatrice (`import … from "nodefony"`), jamais des chemins relatifs internes.
 *
 * Principe : extraire les blocs → les écrire dans tmp/doc-work/qs/ → tsgo -p (strict,
 * décorateurs, moduleResolution Bundler). La résolution passe par le node_modules de la
 * racine (workspaces npm) — exactement ce que verra l'app générée.
 *
 * Les blocs marqués ```ts ignore (ou ```ts no-check) sont sautés : réservé aux fragments
 * volontairement partiels. Tout le reste DOIT compiler.
 *
 * Usage : node code-check.mjs <page.md ...>
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";

const REPO = execSync("git rev-parse --show-toplevel", {
  encoding: "utf8",
}).trim();
const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node code-check.mjs <page.md ...>");
  process.exit(2);
}
// Un répertoire de travail PAR INVOCATION (nommé d'après les pages) : plusieurs
// rédacteurs travaillent en parallèle sur des pages différentes et ne doivent pas
// s'effacer mutuellement leurs extraits.
const QS = path.join(
  REPO,
  "tmp/doc-work/qs",
  files.map((f) => path.basename(f, ".md")).join("+"),
);

// Section « Démarrage rapide » : du titre H2 (icône canonique tolérée) au H2 suivant.
// Découpe en deux temps — un lookahead `$` en mode `m` matcherait la fin de la LIGNE
// du titre et renverrait une section vide.
const QUICKSTART_TITLE = /^##\s+(?:\S+\s+)?D[ée]marrage rapide[^\n]*\n/im;
const NEXT_H2 = /^##\s/m;
const quickstartOf = (src) => {
  const t = src.match(QUICKSTART_TITLE);
  if (!t) return null;
  const rest = src.slice(t.index + t[0].length);
  const next = rest.match(NEXT_H2);
  return next ? rest.slice(0, next.index) : rest;
};
// ```ts et ```typescript — les deux fences sont employées dans le corpus.
const TS_BLOCK =
  /^```(?:ts|typescript)(?<flags>[^\n]*)\n(?<code>[\s\S]*?)^```/gm;

mkdirSync(QS, { recursive: true });
// Repartir propre : un ancien extrait laissé là ferait échouer (ou passer) à tort.
for (const stale of readdirSync(QS)) {
  if (stale.endsWith(".ts")) rmSync(path.join(QS, stale));
}

// tsconfig du harnais — recréé à chaque run (artefact régénérable, pas une source).
//
// ⚠️ `target`/`lib` DOIVENT rester alignés sur le tsconfig qu'engendre `nodefony
// create app` (`src/nodefony/templates/app/base/tsconfig.json.tpl`). Le gate simule
// une application consommatrice : s'il compile plus strictement qu'elle, il rejette
// des exemples pourtant valides — vécu, deux pages ont dû neutraliser un bloc parce
// que le harnais était en `lib: ES2023` alors que les apps sont en `ESNext` et que
// le framework emploie `RegExp.escape` (ES2025).
writeFileSync(
  path.join(QS, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2024",
        lib: ["ESNext", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
        types: ["node"],
      },
      include: ["*.ts"],
    },
    null,
    2,
  ),
);

// Un extrait de `nodefony.config.ts` se montre SANS ses imports (le lecteur sait que
// `use`/`defineConfig` y sont déjà) — les réclamer alourdirait la page pour rien. On les
// réinjecte ici : la FORME de la config reste vérifiée (c'est là qu'on invente des clés).
const CONFIG_HELPERS = ["use", "defineConfig", "defineEnv"];
const withPreamble = (code) => {
  if (/^\s*import\s/m.test(code)) return code;
  const needed = CONFIG_HELPERS.filter((h) =>
    new RegExp(`\\b${h}\\s*\\(`).test(code),
  );
  return needed.length
    ? `import { ${needed.join(", ")} } from "nodefony";\n${code}`
    : code;
};

let extracted = 0;
const perPage = [];
for (const f of files) {
  if (!existsSync(f)) {
    perPage.push([f, 0, "FICHIER ABSENT"]);
    continue;
  }
  const src = readFileSync(f, "utf8");
  const topic = path.basename(f, ".md");
  const qs = quickstartOf(src);
  if (qs === null) {
    perPage.push([f, 0, "pas de section « Démarrage rapide »"]);
    continue;
  }
  let n = 0;
  for (const m of qs.matchAll(TS_BLOCK)) {
    if (/\b(ignore|no-check)\b/.test(m.groups.flags)) continue;
    n += 1;
    extracted += 1;
    writeFileSync(
      path.join(QS, `${topic}-${n}.ts`),
      withPreamble(m.groups.code),
    );
  }
  perPage.push([f, n, n ? null : "0 bloc ```ts dans le Démarrage rapide"]);
}

console.log("\n=== code-check — compilabilité du Démarrage rapide ===\n");
for (const [f, n, warn] of perPage) {
  const name = path.basename(f);
  console.log(
    warn ? `⚠️  ${name} — ${warn}` : `   ${name} — ${n} bloc(s) extrait(s)`,
  );
}
if (!extracted) {
  console.log("\nAucun bloc à compiler.\n");
  process.exit(1);
}

const r = spawnSync("npx", ["tsgo", "-p", "tsconfig.json"], {
  cwd: QS,
  encoding: "utf8",
});
const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
if (r.status === 0 && !out) {
  console.log(`\n✅ ${extracted} bloc(s) compilent (strict, décorateurs).\n`);
  process.exit(0);
}
console.log(`\n❌ échec de compilation :\n\n${out}\n`);
console.log(
  `Extraits conservés dans ${path.relative(REPO, QS)}/ pour inspection.\n`,
);
process.exit(1);
