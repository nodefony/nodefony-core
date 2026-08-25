#!/usr/bin/env node
/**
 * Banc de CONFORMITÉ de l'application générée — « ce qui a été câblé tient-il
 * les promesses du framework ? »
 *
 * Le banc frère (`verify-generated.mjs`) éprouve la CHAÎNE DE FABRICATION : le
 * code produit compile, se lint, se bâtit, ses tests passent, la ressource
 * répond. Celui-ci éprouve le PRODUIT EN FONCTIONNEMENT, et la distinction est
 * sa raison d'être — une application peut compiler parfaitement, démarrer sans
 * un mot, et servir une route qui contourne le firewall, une liste que le
 * client peut faire déborder, une suppression que personne n'a besoin
 * d'autoriser.
 *
 * Trois étages, joués séparément pour que le verdict dise LEQUEL est tombé :
 *
 *   1. UNITAIRE     — ni serveur ni base. Ce qui survit au boot : une balise de
 *                     gabarit non résolue, un service non déclaré, une variable
 *                     d'environnement lue hors du catalogue.
 *   2. INTÉGRATION  — l'application boote EN ENTIER, sans ouvrir de port
 *                     (`nodefony inspect`, profil console). Services résolus au
 *                     conteneur, routes montées, modules du manifeste chargés,
 *                     couche donnée sur une base réelle en mémoire.
 *   3. E2E          — serveur RÉEL, en PRODUCTION, HTTP et WebSocket. Le CRUD
 *                     complet, l'identité exigée, ce que le navigateur reçoit.
 *
 * ## Les suites ne sont pas livrées à l'utilisateur
 *
 * Elles vivent dans ce skill (`suites/`) et sont INJECTÉES dans l'application
 * témoin, jouées, puis jetées avec le décor. Une suite livrée serait une suite
 * que l'utilisateur doit maintenir, et qui parle de choses dont il se moque —
 * « ma commande porte-t-elle son namespace ? » est une question du générateur,
 * pas de l'application.
 *
 * ## Décor
 *
 * Ce banc ne monte PAS son propre décor : il réutilise celui de
 * `verify-generated.mjs --keep`. Deux motifs, et le second est le vrai — monter
 * un second décor coûterait une minute pour rien, et surtout il MESURERAIT UNE
 * AUTRE APPLICATION que celle dont on vient de prouver qu'elle compile.
 *
 * Usage :
 *   node scripts/verify-generated.mjs --keep      # d'abord : monte et éprouve
 *   node scripts/verify-runtime.mjs               # puis : la conformité
 *   node scripts/verify-runtime.mjs --link        # décor lié (verdict amputé)
 *   node scripts/verify-runtime.mjs --etage unit  # un seul étage
 *
 * Sortie : rapport console + code de sortie 1 dès qu'un étage est rouge.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { envDecor } from "./lib/env-decor.mjs";

/** Racine du dépôt, trouvée en REMONTANT — un skill se déplace, un `..` compté se périme. */
function findRepoRoot(from) {
  let dir = from;
  for (let up = 0; up < 8; up += 1) {
    if (existsSync(path.join(dir, "src/nodefony/bin/nodefony"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("racine du dépôt Nodefony introuvable depuis " + from);
}

const ICI = path.dirname(fileURLToPath(import.meta.url));
const REPO = findRepoRoot(ICI);
const SUITES = path.join(ICI, "..", "suites");

const LINKED = process.argv.includes("--link");
const iEtage = process.argv.indexOf("--etage");
const ETAGE_DEMANDE = iEtage === -1 ? null : process.argv[iEtage + 1];

/**
 * Le décor, aux MÊMES emplacements que `verify-generated.mjs`.
 *
 * Ces deux chemins sont la seule chose que les deux bancs partagent en dur ; les
 * changer d'un côté sans l'autre ferait chercher l'application là où elle n'est
 * pas, avec un message qui parlerait de décor absent plutôt que de désaccord.
 */
const ROOT = LINKED
  ? path.join(REPO, "tmp", "devkit-verify")
  : path.join(os.tmpdir(), "nodefony-devkit-verify");
const APP = path.join(ROOT, "app");

/**
 * Ports DÉDIÉS à l'application témoin — les mêmes que le banc de vérité.
 *
 * Sans eux, la sonde mesure la MACHINE et non le produit. Vécu au premier run :
 * `nodefony check` a rendu deux manquements — « le port 5151 est déjà tenu » —
 * parce que le serveur de développement du poste écoutait. Le verdict accusait
 * l'application générée d'un défaut qui n'était pas le sien, et il aurait été
 * vert sur un runner : une mesure qui dépend de ce qui tourne à côté ne mesure
 * rien.
 */
const PORTS = { NF_PORT: "5361", NF_PORT_HTTPS: "5362" };

/** Où les suites atterrissent dans l'application — un dossier à elles, jamais mêlé aux siennes. */
const DEST = path.join(APP, "tests-conformite");

/**
 * Les trois étages, et ce que chaque config doit dire à vitest.
 *
 * Trois configs plutôt qu'une avec trois `include` : un étage rouge doit se
 * nommer. Une config unique rendrait « 3 fichiers, 41 cas, 2 échecs » — vrai, et
 * inutilisable pour savoir si le défaut est dans le câblage ou dans le serveur.
 */
const ETAGES = [
  {
    cle: "unit",
    titre: "UNITAIRE — ce qui survit au boot",
    fichier: "conformite.unit.test.ts",
    setup: false,
    timeout: 120_000,
  },
  {
    cle: "integration",
    titre: "INTÉGRATION — l'application boote, aucun port ouvert",
    fichier: "conformite.integration.test.ts",
    setup: false,
    timeout: 300_000,
  },
  {
    cle: "e2e",
    titre: "E2E — serveur réel, en production, HTTP et WebSocket",
    fichier: "conformite.e2e.test.ts",
    setup: true,
    timeout: 300_000,
  },
];

/**
 * Écrit la config vitest d'un étage, à la racine de l'application.
 *
 * `oxc.decorator` reprend mot pour mot ce que le scaffold pose dans les configs
 * de l'application : les entités et services importés par l'étage d'intégration
 * portent des décorateurs, et une config qui les ignore fait échouer l'import
 * sur une erreur qui ne parle pas de décorateurs.
 *
 * `globalSetup` réutilise le démarrage écrit par le SCAFFOLD
 * (`tests/e2e.setup.ts`) : c'est lui qui sait démarrer l'application en
 * production, avec sa base jetable et son compte d'administration.
 */
function ecrireConfig(etage) {
  const nom = `vitest.conformite.${etage.cle}.config.ts`;
  const setup = etage.setup ? `\n    globalSetup: ["tests/e2e.setup.ts"],` : "";
  writeFileSync(
    path.join(APP, nom),
    `import { defineConfig } from "vitest/config";

// Config ÉCRITE par le banc de conformité — jetée avec le décor.
export default defineConfig({
  test: {
    include: ["tests-conformite/${etage.fichier}"],${setup}
    fileParallelism: false,
    testTimeout: ${etage.timeout},
    hookTimeout: ${etage.timeout},
  },
  oxc: {
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
});
`,
  );
  return nom;
}

process.stdout.write(
  "Banc de conformité — l'application générée tient-elle les promesses du framework ?\n",
);

if (!existsSync(APP)) {
  process.stderr.write(
    `\n❌ Aucune application témoin en ${APP}.\n` +
      `   Ce banc réutilise le décor du banc de vérité — monte-le d'abord :\n` +
      `     node ${path.relative(REPO, path.join(ICI, "verify-generated.mjs"))} --keep${
        LINKED ? " --link" : ""
      }\n`,
  );
  process.exit(1);
}

// Les suites sont RECOPIÉES à chaque exécution, jamais mises à jour en place :
// un fichier d'une version précédente resté dans le décor ferait juger le
// produit d'aujourd'hui par les règles d'hier, sans que rien ne le signale.
rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
cpSync(SUITES, DEST, { recursive: true });
process.stdout.write(`• suites injectées dans ${path.relative(ROOT, DEST)}\n`);

const resultats = [];
let rouge = false;

for (const etage of ETAGES) {
  if (ETAGE_DEMANDE !== null && ETAGE_DEMANDE !== etage.cle) continue;
  const config = ecrireConfig(etage);
  process.stdout.write(`\n━━ ${etage.titre}\n`);
  const debut = process.hrtime.bigint();
  const res = spawnSync(
    "npx",
    ["vitest", "run", "--config", config, "--reporter", "verbose"],
    {
      cwd: APP,
      encoding: "utf8",
      timeout: 900_000,
      shell: process.platform === "win32",
      // L'environnement d'un UTILISATEUR, pas celui de l'atelier : `envDecor`
      // écarte toutes les `NF_*` du poste avant de poser celles du banc. Une
      // variable du shell de lancement arriverait sinon dans l'application comme
      // une variable qu'elle ne déclare pas — et la suite de conformité la
      // compterait comme un défaut du générateur.
      env: envDecor(PORTS),
    },
  );
  const ms = Number(process.hrtime.bigint() - debut) / 1e6;
  const sortie = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  process.stdout.write(sortie);
  const ok = res.status === 0;
  if (!ok) rouge = true;
  resultats.push({ etage: etage.cle, ok, ms, code: res.status });
  process.stdout.write(
    `   ${ok ? "✅" : "❌"} ${etage.cle} — ${Math.round(ms)} ms (code ${res.status})\n`,
  );
}

process.stdout.write("\n━━ verdict\n");
for (const r of resultats) {
  process.stdout.write(
    `  ${r.ok ? "✅" : "❌"} ${r.etage} (${Math.round(r.ms)} ms)\n`,
  );
}

writeFileSync(
  path.join(ROOT, "conformite.json"),
  `${JSON.stringify(
    {
      etages: resultats,
      app: APP,
      decor: LINKED
        ? "lié au checkout (--link)"
        : "isolé (tarballs, hors dépôt)",
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(
  rouge
    ? "\n❌ l'application générée ne tient pas toutes les promesses — voir l'étage rouge\n"
    : "\n✅ les trois étages sont verts : câblage, boot et service réel\n",
);
process.exit(rouge ? 1 : 0);
