#!/usr/bin/env node
/**
 * Gate — tout paquet Nodefony importé doit être DÉCLARÉ par celui qui l'importe.
 *
 * Un import non déclaré ne casse rien dans le monorepo : npm hisse tout à la
 * racine, donc `@nodefony/http` se résout depuis n'importe où. Il casse deux
 * choses qu'on ne voit qu'ailleurs, et tard :
 *
 *  1. **L'ordre de build.** Turbo ordonne `^build` sur les dépendances
 *     DÉCLARÉES. Un paquet qui importe sans déclarer se fait compiler avant
 *     celui dont il dépend → `TS7016: Could not find a declaration file`, mais
 *     seulement après un `clean` (le dist de la fois d'avant masque tout).
 *  2. **L'installation réelle.** `npm i @nodefony/framework` n'installe pas
 *     `@nodefony/http` s'il n'est pas déclaré : l'import échoue chez qui
 *     consomme, jamais chez nous.
 *
 * Les CYCLES sont déclarés ici, nommés et justifiés — pas tolérés en silence.
 * Un cycle de types (`import type`) est effacé à la compilation : il est légal,
 * mais il interdit de le déclarer en peerDependency (npm et turbo refusent le
 * cycle). Le lister ICI est ce qui distingue « assumé » de « oublié ».
 *
 * Usage : `node scripts/check-package-deps.mjs` (exit 1 si un import fuit).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PKG_DIRS = ["src/packages/@nodefony", "src/nodefony"];

/**
 * Cycles de types ASSUMÉS — `importeur → importé`, où l'importé déclare déjà
 * l'importeur. Déclarer la réciproque créerait un cycle que npm et turbo
 * refusent ; l'import est donc `import type` (effacé au build, aucun cycle à
 * l'exécution — vérifié : le JS émis de `http` ne mentionne ces paquets que
 * dans des commentaires).
 *
 * ⚠️ Ce n'est PAS une liste de tolérance à rallonger : chaque entrée est une
 * dette de conception (le contrat partagé devrait vivre dans le cœur). Elle ne
 * doit que RÉTRÉCIR.
 */
const TYPE_CYCLES = {
  // Le CŒUR ne peut déclarer aucun de ses consommateurs : ils déclarent tous
  // `nodefony`. `HttpKernel` (`Kernel.ts`) et `Controller` (`Module.ts`) ne
  // servent qu'au typage — vérifié, le JS émis du cœur ne les importe pas.
  nodefony: ["@nodefony/http", "@nodefony/framework"],
  "@nodefony/http": [
    // `Resolver`/`Router`/`Controller` : http passe par `(context as any).resolver`
    // au runtime justement pour ne pas dépendre du framework.
    "@nodefony/framework",
    // `Firewall`/`SecuredArea`/`Csrf` : security déclare http, la réciproque
    // boucle. Les symboles ne servent qu'au typage du pipeline.
    "@nodefony/security",
  ],
};

/** Paquets internes connus (nom npm → dossier), lus sur le disque. */
function readPackages() {
  const out = [];
  for (const rel of PKG_DIRS) {
    const abs = path.join(ROOT, rel);
    const entries = statSync(path.join(abs, "package.json"), {
      throwIfNoEntry: false,
    })
      ? [abs]
      : readdirSync(abs).map((d) => path.join(abs, d));
    for (const dir of entries) {
      const pj = path.join(dir, "package.json");
      if (!statSync(pj, { throwIfNoEntry: false })) continue;
      out.push({ dir, manifest: JSON.parse(readFileSync(pj, "utf8")) });
    }
  }
  return out;
}

/**
 * Sources qui ENGAGENT le consommateur : ce qui part dans le tarball.
 *
 * Les tests sont exclus à dessein — `files` ne les embarque pas, donc leurs
 * imports n'obligent personne à installer quoi que ce soit. Les inclure ferait
 * réclamer une peerDependency pour un fichier que le consommateur ne reçoit
 * jamais.
 */
function sources(dir) {
  const found = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (
        e.name === "node_modules" ||
        e.name === "dist" ||
        e.name === "tests" ||
        e.name[0] === "."
      )
        continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
        found.push(p);
    }
  };
  walk(dir);
  return found;
}

/**
 * Une VRAIE déclaration d'import, en tête de ligne.
 *
 * L'ancre `^` n'est pas cosmétique : le générateur de scaffold écrit des
 * `import ... from "@nodefony/orm-core"` **dans des chaînes de gabarit** (le
 * code qu'il produit). Sans elle, la gate réclamait une dépendance pour du
 * texte destiné à une AUTRE application.
 */
const IMPORT_RE =
  /^\s*(?:import|export)\s+(type\s+)?[^;]*?from\s+"(@nodefony\/[a-z0-9-]+|nodefony)(?:\/[a-z0-9-]+)?"/gm;

const packages = readPackages();
const internal = new Set(packages.map((p) => p.manifest.name));
let failed = 0;

for (const { dir, manifest } of packages) {
  const declared = new Set(
    ["dependencies", "peerDependencies", "devDependencies"].flatMap((k) =>
      Object.keys(manifest[k] ?? {}),
    ),
  );
  const allowed = new Set(TYPE_CYCLES[manifest.name] ?? []);
  const missing = new Map(); // paquet → premier fichier fautif

  for (const file of sources(dir)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(IMPORT_RE)) {
      const isTypeOnly = Boolean(m[1]);
      const dep = m[2];
      if (dep === manifest.name || !internal.has(dep)) continue;
      if (declared.has(dep) || allowed.has(dep)) continue;
      const rel = path.relative(ROOT, file);
      const seen = missing.get(dep);
      // On garde le PIRE cas, avec SON fichier : citer un `import type` sous un
      // verdict « runtime » enverrait corriger le mauvais endroit.
      if (!seen) missing.set(dep, { file: rel, typeOnly: isTypeOnly });
      else if (seen.typeOnly && !isTypeOnly)
        missing.set(dep, { file: rel, typeOnly: false });
    }
  }

  for (const [dep, { file, typeOnly }] of missing) {
    const kind = typeOnly ? "type-only" : "VALEUR (runtime)";
    console.error(`❌ ${manifest.name} importe ${dep} — ${kind} — non déclaré`);
    console.error(`   premier usage : ${file}`);
    console.error(
      typeOnly
        ? `   → soit peerDependencies, soit TYPE_CYCLES si ${dep} déclare déjà ${manifest.name}`
        : `   → ajouter "${dep}": "*" dans peerDependencies de ${path.relative(ROOT, dir)}/package.json`,
    );
    failed++;
  }
}

// Un cycle listé qui a disparu du code doit sortir de la liste, sinon elle
// devient un folklore que plus personne ne relit.
for (const [pkgName, deps] of Object.entries(TYPE_CYCLES)) {
  const pkg = packages.find((p) => p.manifest.name === pkgName);
  if (!pkg) {
    console.error(`❌ TYPE_CYCLES cite ${pkgName}, qui n'existe plus`);
    failed++;
    continue;
  }
  const src = sources(pkg.dir)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  for (const dep of deps) {
    if (!src.includes(`from "${dep}"`)) {
      console.error(
        `❌ ${pkgName} n'importe plus ${dep} — retirer l'entrée de TYPE_CYCLES (${path.relative(ROOT, import.meta.filename)})`,
      );
      failed++;
    }
  }
}

/**
 * Paquets dont les types publiés sont INATTEIGNABLES après `npm i`, en dette
 * assumée : `exports["."].types` pointe `./index.ts`, que `files` n'embarque
 * pas. Le consommateur reçoit un paquet sans types.
 *
 * Ce n'est pas un oubli mais un CYCLE : `http` a besoin des types de
 * `framework` et de `security`, qui ont besoin des siens. Pointer la source les
 * résout sans exiger que l'autre soit déjà construit. La dette se propage à qui
 * est lu en source (`security → user → orm-core`).
 *
 * ⚠️ Cette liste ne doit que RÉTRÉCIR : `frontend` en est sorti le jour où il
 * s'est avéré hors du cycle. La sortir entièrement demande de casser le cycle
 * (contrats partagés remontés dans le cœur), pas de bricoler les manifestes —
 * `publishConfig.exports` ne fonctionne PAS avec npm (vérifié sur un tarball).
 */
const TYPES_UNREACHABLE = [
  "@nodefony/http",
  "@nodefony/framework",
  "@nodefony/security",
  "@nodefony/user",
  "@nodefony/orm-core",
];

for (const { manifest } of packages) {
  if (manifest.private === true) continue;
  const declared = manifest.exports?.["."]?.types ?? manifest.types;
  if (!declared) continue; // paquet sans surface de types (studio)
  const shipped = manifest.files ?? [];
  const reachable = shipped.some((f) =>
    declared.replace(/^\.\//, "").startsWith(f.replace(/\/?\*+$/, "")),
  );
  const known = TYPES_UNREACHABLE.includes(manifest.name);
  if (!reachable && !known) {
    console.error(
      `❌ ${manifest.name} : types "${declared}" hors de files ${JSON.stringify(shipped)}`,
    );
    console.error(
      `   → après "npm i", le consommateur n'a AUCUN type. Pointer dist/types, ou ajouter la source à files.`,
    );
    failed++;
  }
  if (reachable && known) {
    console.error(
      `❌ ${manifest.name} : types atteignables — le retirer de TYPES_UNREACHABLE (la dette a été soldée).`,
    );
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} problème(s) de surface publiée.`);
  process.exit(1);
}

const cycles = Object.values(TYPE_CYCLES).flat().length;
console.log(
  `✓ ${packages.length} paquets, 0 import non déclaré (${cycles} cycles de types assumés, ` +
    `${TYPES_UNREACHABLE.length} paquets sans types publiés — dette de cycle).`,
);
