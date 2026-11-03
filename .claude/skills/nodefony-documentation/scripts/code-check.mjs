#!/usr/bin/env node
/**
 * code-check.mjs — gate de COMPILABILITÉ du « Démarrage rapide » (standard §8sexies).
 *
 * Le standard exige que les blocs ```ts de la section « Démarrage rapide » soient
 * autonomes et compilent contre les VRAIS paquets du repo, du point de vue d'une app
 * consommatrice (`import … from "nodefony"`), jamais des chemins relatifs internes.
 *
 * Principe : extraire les blocs → les écrire dans tmp/scratch/doc-work/qs/ → tsgo -p (strict,
 * décorateurs, moduleResolution Bundler). La résolution passe par le node_modules de la
 * racine (workspaces npm) — exactement ce que verra l'app générée — complété des paquets
 * qu'npm a posés sous un SEUL workspace (`nestedOnlyPaths`) : une app Angular installe
 * `@angular/core` elle-même, où que npm l'ait rangé dans ce dépôt.
 *
 * Les blocs marqués ```ts ignore (ou ```ts no-check) sont sautés : réservé aux fragments
 * volontairement partiels. Un bloc précédé de `<!-- example: X.ts -->` EST le fichier X
 * du module, prouvé en contexte par le test qui compare la page à ses fichiers : il est
 * sauté si X existe dans le module, refusé sinon. Tout le reste DOIT compiler.
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
import { createHash } from "node:crypto";

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
// s'effacer mutuellement leurs extraits. Au-delà de ~100 caractères le nom est
// tronqué + suffixé d'un hash du lot complet : un corpus entier en une invocation
// dépassait NAME_MAX et le mkdir tombait en ENAMETOOLONG (vécu, 63 pages).
const lotName = files.map((f) => path.basename(f, ".md")).join("+");
const QS = path.join(
  REPO,
  "tmp/scratch/doc-work/qs",
  lotName.length <= 100
    ? lotName
    : `${lotName.slice(0, 80)}+${createHash("sha256").update(lotName).digest("hex").slice(0, 8)}`,
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
// Un marqueur `<!-- example: X.ts -->` juste au-dessus (le formateur pose une ligne
// vide entre les deux) dit que le bloc EST le fichier X du module : il est prouvé là,
// en contexte, par le test qui compare la page à ses fichiers (`useCases.test.ts`).
const TS_BLOCK =
  /(?:^<!-- example: (?<example>[\w.-]+\.ts) -->\n\n?)?^```(?:ts|typescript)(?<flags>[^\n]*)\n(?<code>[\s\S]*?)^```/gm;

/**
 * Les noms de fichiers `.ts` d'un module, hors `node_modules` et `dist`.
 *
 * Un bloc marqué `<!-- example: X.ts -->` ne compile pas seul : il importe ses voisins
 * (`./privateRoom`) et les entités de l'application (`../entity/User`), que le harnais
 * n'a pas. Il n'est sauté que si X existe dans le module de la page — un marqueur sans
 * fichier derrière ne prouve rien, et le gate le refuse.
 *
 * @param root - racine du module (le parent du dossier `docs/` de la page)
 * @returns l'ensemble des noms de base trouvés
 */
const moduleTsNames = (root) => {
  const names = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "dist") {
          walk(path.join(dir, entry.name));
        }
      } else if (entry.name.endsWith(".ts")) names.add(entry.name);
    }
  };
  walk(root);
  return names;
};

mkdirSync(QS, { recursive: true });
// Repartir propre : un ancien extrait laissé là ferait échouer (ou passer) à tort.
for (const stale of readdirSync(QS)) {
  if (stale.endsWith(".ts")) rmSync(path.join(QS, stale));
}

/**
 * Paquets que l'installation n'a posés que sous un workspace, jamais à la racine.
 *
 * npm ne remonte pas toujours un paquet à la racine : la montée de dépendances qui a
 * laissé `@angular/core` en DEUX exemplaires identiques (sous `src/nodefony` et sous
 * `src/modules/test-frontend-angular`) l'en a retiré, et le gate, qui compile depuis
 * `tmp/`, ne le voyait plus — rouge sur une page juste. Une app générée, elle,
 * installe ce paquet elle-même : le harnais doit le trouver là où il est vraiment.
 * Lu dans `package-lock.json` (ce que npm a installé), jamais deviné par un parcours
 * du disque. Les chemins sont écrits en `/` : ils VOYAGENT dans un tsconfig.
 *
 * @returns la table `paths` du tsconfig : nom de paquet → dossiers candidats
 */
const nestedOnlyPaths = () => {
  const lock = JSON.parse(
    readFileSync(path.join(REPO, "package-lock.json"), "utf8"),
  );
  const keys = Object.keys(lock.packages ?? {});
  const atRoot = new Set(
    keys
      .filter((k) => k.startsWith("node_modules/"))
      .map((k) => k.slice("node_modules/".length)),
  );
  const NESTED =
    /^((?:(?!node_modules\/).)+)\/node_modules\/((?:@[^/]+\/)?[^/]+)$/;
  const paths = Object.create(null);
  for (const key of keys) {
    const m = NESTED.exec(key);
    if (m === null || atRoot.has(m[2])) continue;
    const dir = path
      .relative(QS, path.join(REPO, key))
      .split(path.sep)
      .join("/");
    (paths[m[2]] ??= []).push(dir);
    (paths[`${m[2]}/*`] ??= []).push(`${dir}/*`);
  }
  return paths;
};

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
        emitDecoratorMetadata: false,
        esModuleInterop: true,
        types: ["node"],
        paths: nestedOnlyPaths(),
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
const orphanExamples = [];
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
  let proven = 0;
  let moduleNames = null;
  for (const m of qs.matchAll(TS_BLOCK)) {
    if (/\b(ignore|no-check)\b/.test(m.groups.flags)) continue;
    if (m.groups.example !== undefined) {
      moduleNames ??= moduleTsNames(
        path.dirname(path.dirname(path.resolve(f))),
      );
      if (moduleNames.has(m.groups.example)) proven += 1;
      else orphanExamples.push(`${path.basename(f)} → ${m.groups.example}`);
      continue;
    }
    n += 1;
    extracted += 1;
    writeFileSync(
      path.join(QS, `${topic}-${n}.ts`),
      withPreamble(m.groups.code),
    );
  }
  perPage.push([
    f,
    n,
    n || proven ? null : "0 bloc ```ts dans le Démarrage rapide",
    proven,
  ]);
}

console.log("\n=== code-check — compilabilité du Démarrage rapide ===\n");
for (const [f, n, warn, proven = 0] of perPage) {
  const name = path.basename(f);
  const byFile = proven
    ? `, ${proven} prouvé(s) par leur fichier d'exemple`
    : "";
  console.log(
    warn
      ? `⚠️  ${name} — ${warn}`
      : `   ${name} — ${n} bloc(s) extrait(s)${byFile}`,
  );
}
if (orphanExamples.length) {
  console.log(
    `\n❌ marqueur <!-- example: X.ts --> sans fichier X dans le module :\n\n   ${orphanExamples.join("\n   ")}\n`,
  );
  process.exit(1);
}
if (!extracted) {
  if (perPage.some(([, , , proven]) => proven)) {
    console.log(
      "\n✅ Aucun bloc isolé ; les exemples sont prouvés par leurs fichiers.\n",
    );
    process.exit(0);
  }
  console.log("\nAucun bloc à compiler.\n");
  process.exit(1);
}

const r = spawnSync("npx", ["tsgo", "-p", "tsconfig.json"], {
  cwd: QS,
  encoding: "utf8",
});
// npm écrit ses propres lignes `npm notice …` sur stderr autour d'un `npx` :
// ce bruit d'ORCHESTRATION n'est pas une sortie de tsgo — sans ce filtre, toute
// compilation VERTE était déclarée rouge (« sortie non vide », vécu 2026-08-20).
const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
  .split("\n")
  .filter((l) => !/^npm notice\b/.test(l))
  .join("\n")
  .trim();
if (r.status === 0 && !out) {
  console.log(`\n✅ ${extracted} bloc(s) compilent (strict, décorateurs).\n`);
  process.exit(0);
}
console.log(`\n❌ échec de compilation :\n\n${out}\n`);
console.log(
  `Extraits conservés dans ${path.relative(REPO, QS)}/ pour inspection.\n`,
);
process.exit(1);
