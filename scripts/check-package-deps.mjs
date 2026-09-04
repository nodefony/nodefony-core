#!/usr/bin/env node
/**
 * Garde de pré-commit — surface des paquets du dépôt du framework.
 *
 * Ce fichier ne décide de rien : il EXPLIQUE. L'analyse vit dans le cœur
 * (`nodefony/src/kernel/checks/packageDeps.ts`) et sert aussi la commande
 * `nodefony doctor`, disponible dans toute application ; les exceptions sont
 * déclarées dans le `package.json` racine, sous `nodefony.check`, exactement là
 * où une application déclarerait les siennes. Deux implémentations d'une même
 * règle divergent toujours — et deux LISTES de la même règle aussi : c'est
 * précisément la faute que cette garde cherche.
 *
 * Ce que le JSON ne peut pas porter, et qu'on garde ici — POURQUOI chaque
 * exception existe :
 *
 * `typeCycles` — un cycle de types est effacé à la compilation, donc légal ;
 * mais il interdit de déclarer la réciproque, que npm et turbo refuseraient.
 *  - `nodefony` → `http`, `framework` : le cœur ne peut déclarer aucun de ses
 *    consommateurs, ils déclarent tous `nodefony`. `HttpKernel` (Kernel.ts) et
 *    `Controller` (Module.ts) ne servent qu'au typage — vérifié, le JS émis du
 *    cœur ne les importe pas.
 *  - `http` → `framework` : `Resolver`/`Router`/`Controller` ; http passe par
 *    `(context as any).resolver` au runtime justement pour ne pas en dépendre.
 *  - `http` → `security` : `Firewall`/`SecuredArea`/`Csrf` ; security déclare
 *    http, la réciproque boucle.
 *
 * `typesUnreachable` — paquets dont `exports["."].types` pointe `./index.ts`,
 * que `files` n'embarque pas : après `npm i`, le consommateur n'a aucun type.
 * Ce n'est pas un oubli mais le cycle ci-dessus — pointer la source le résout
 * sans exiger que l'autre soit déjà construit, et la contrainte se propage à
 * qui est lu en source (`security → user → orm-core`).
 *
 * ⚠️ Ces deux listes ne doivent que RÉTRÉCIR — `frontend` en est sorti le jour
 * où il s'est avéré hors du cycle, et la garde REFUSE une entrée devenue
 * inutile. Les vider demande de casser le cycle (remonter les contrats
 * partagés dans le cœur), pas de bricoler les manifestes :
 * `publishConfig.exports` ne fonctionne PAS avec npm (vérifié sur un tarball).
 *
 * Usage : `node scripts/check-package-deps.mjs` (sort en erreur si manquement).
 */
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
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

// Source UNIQUE des exceptions : celle que lit aussi `nodefony doctor`.
const { typeCycles, typesUnreachable } =
  JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).nodefony
    ?.check ?? {};

const { findings, scanned } = checkPackageDeps({
  roots: [
    path.join(ROOT, "src/packages/@nodefony"),
    path.join(ROOT, "src/nodefony"),
  ],
  cwd: ROOT,
  typeCycles,
  typesUnreachable,
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

const cycles = Object.values(typeCycles ?? {}).flat().length;
console.log(
  `✓ ${scanned} paquets, 0 import non déclaré (${cycles} cycles de types assumés, ` +
    `${typesUnreachable?.length ?? 0} paquets sans types publiés — dette de cycle).`,
);
