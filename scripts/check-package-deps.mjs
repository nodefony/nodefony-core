#!/usr/bin/env node
/**
 * Garde de pré-commit — surface des paquets du dépôt du framework.
 *
 * Ce fichier ne décide de rien : il EXPLIQUE. L'analyse vit dans le cœur
 * (`nodefony/src/kernel/checks/packageDeps.ts`) et sert aussi la commande
 * `nodefony doctor`, disponible dans toute application ; les exceptions sont
 * déclarées dans le `package.json` racine, sous `nodefony.doctor`, exactement là
 * où une application déclarerait les siennes. Deux implémentations d'une même
 * règle divergent toujours — et deux LISTES de la même règle aussi : c'est
 * précisément la faute que cette garde cherche.
 *
 * Ce que le JSON ne peut pas porter, et qu'on garde ici — POURQUOI chaque
 * exception existe :
 *
 * `typeCycles` — un cycle de types est effacé à la compilation, donc légal ;
 * mais il interdit de déclarer la réciproque, que npm et turbo refuseraient.
 * La liste est VIDE : le cœur, http, framework et security ne se connaissent
 * plus qu'à sens unique — c'est le LECTEUR qui définit le contrat qu'il lit
 * (`IServerKernel` au cœur, `IRouteResolver`/`ISecurityZone`/`IFirewallGate`
 * dans http), et le paquet qui l'implémente l'étend. Une entrée qui y
 * reviendrait est une régression d'architecture, pas une dette.
 *
 * `typesUnreachable` — paquets dont `exports["."].types` pointe `./index.ts`,
 * que `files` n'embarque pas : après `npm i`, le consommateur n'a aucun type.
 * La liste est VIDE : un paquet consommé en source se lit par la condition
 * d'export `nodefony-source` (déclarée dans les tsconfigs du dépôt), et
 * `types` pointe le `.d.ts` publié. Une entrée qui y reviendrait est une
 * régression, pas une dette.
 *
 * ⚠️ Ces deux listes ne doivent que RÉTRÉCIR — la garde REFUSE une entrée
 * devenue inutile. `publishConfig.exports` ne fonctionne PAS avec npm (vérifié
 * sur un tarball) : ne pas y chercher un remède.
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

// Les exceptions que lit aussi `nodefony doctor` — clé `nodefony.doctor` du
// manifeste racine.
//
// 🔴 Le commentaire disait « source UNIQUE » et ne l'était pas : la clé est lue
// à DEUX endroits écrits séparément — ici, et `readExceptions` dans
// `src/nodefony/src/kernel/checks/runDoctor.ts`. La duplication a divergé au
// premier renommage : passer la clé de `check` à `doctor` a fait perdre à CE
// script ses exceptions, et neuf manquements légitimement exemptés sont
// réapparus d'un coup, sur un commit qui n'avait touché aucun des manifestes
// accusés. Deux copies d'une règle passent chacune leurs propres tests.
const { typeCycles, typesUnreachable } =
  JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).nodefony
    ?.doctor ?? {};

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
