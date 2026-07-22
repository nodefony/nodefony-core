#!/usr/bin/env node
/**
 * Garde de pré-commit — surface des paquets du dépôt du framework.
 *
 * Ce fichier ne porte QUE ce qui est propre à ce dépôt : où chercher, et les
 * exceptions assumées. L'analyse elle-même vit dans le cœur
 * (`nodefony/src/kernel/checks/packageDeps.ts`) et sert aussi la commande
 * `nodefony check`, disponible dans toute application. Deux implémentations
 * d'une même règle divergent toujours — c'est précisément la faute que cette
 * garde cherche.
 *
 * Usage : `node scripts/check-package-deps.mjs` (sort en erreur si manquement).
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const CORE = path.join(
  ROOT,
  "src/nodefony/dist/node/kernel/checks/packageDeps.js",
);

if (!existsSync(CORE)) {
  console.error(
    "❌ le cœur n'est pas construit — `npm run build` avant de lancer cette garde.",
  );
  console.error(`   attendu : ${path.relative(ROOT, CORE)}`);
  process.exit(1);
}

const { checkPackageDeps } = await import(pathToFileURL(CORE).href);

/**
 * Cycles de types ASSUMÉS — `importeur → [importés]`, où l'importé déclare déjà
 * l'importeur. Un cycle de types est effacé à la compilation, donc légal ; mais
 * il interdit de déclarer la réciproque, que npm et turbo refuseraient.
 *
 * ⚠️ Ce n'est pas une liste de tolérance à rallonger : chaque entrée est une
 * dette de conception (le contrat partagé devrait vivre dans le cœur). Une
 * entrée qui ne correspond plus à aucun import fait échouer la garde.
 */
const TYPE_CYCLES = {
  // Le cœur ne peut déclarer aucun de ses consommateurs : ils déclarent tous
  // `nodefony`. `HttpKernel` (Kernel.ts) et `Controller` (Module.ts) ne servent
  // qu'au typage — vérifié, le JS émis du cœur ne les importe pas.
  nodefony: ["@nodefony/http", "@nodefony/framework"],
  "@nodefony/http": [
    // `Resolver`/`Router`/`Controller` : http passe par `(context as any).resolver`
    // au runtime justement pour ne pas dépendre du framework.
    "@nodefony/framework",
    // `Firewall`/`SecuredArea`/`Csrf` : security déclare http, la réciproque
    // boucle. Ces symboles ne servent qu'au typage du pipeline.
    "@nodefony/security",
  ],
};

/**
 * Paquets dont les types publiés sont INJOIGNABLES après `npm i` :
 * `exports["."].types` pointe `./index.ts`, que `files` n'embarque pas.
 *
 * Ce n'est pas un oubli mais le CYCLE ci-dessus : `http` a besoin des types de
 * `framework` et `security`, qui ont besoin des siens ; pointer la source les
 * résout sans exiger que l'autre soit déjà construit. La contrainte se propage
 * à qui est lu en source (`security → user → orm-core`).
 *
 * ⚠️ Cette liste ne doit que RÉTRÉCIR — `frontend` en est sorti le jour où il
 * s'est avéré hors du cycle. La vider demande de casser le cycle (remonter les
 * contrats partagés dans le cœur), pas de bricoler les manifestes :
 * `publishConfig.exports` ne fonctionne PAS avec npm (vérifié sur un tarball).
 */
const TYPES_UNREACHABLE = [
  "@nodefony/http",
  "@nodefony/framework",
  "@nodefony/security",
  "@nodefony/user",
  "@nodefony/orm-core",
];

const { findings, scanned } = checkPackageDeps({
  roots: [
    path.join(ROOT, "src/packages/@nodefony"),
    path.join(ROOT, "src/nodefony"),
  ],
  cwd: ROOT,
  typeCycles: TYPE_CYCLES,
  typesUnreachable: TYPES_UNREACHABLE,
});

for (const f of findings) {
  console.error(`❌ ${f.message}`);
  if (f.file) {
    console.error(`   premier usage : ${f.file}`);
  }
}

if (findings.length > 0) {
  console.error(`\n${findings.length} problème(s) de surface publiée.`);
  process.exit(1);
}

const cycles = Object.values(TYPE_CYCLES).flat().length;
console.log(
  `✓ ${scanned} paquets, 0 import non déclaré (${cycles} cycles de types assumés, ` +
    `${TYPES_UNREACHABLE.length} paquets sans types publiés — dette de cycle).`,
);
