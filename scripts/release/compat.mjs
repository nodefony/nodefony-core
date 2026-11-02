#!/usr/bin/env node
/**
 * Compatibilité ENTRE VERSIONS de la socket temps réel (#629, ADR-0022 §10) :
 * la version PUBLIÉE face au code courant, dans les deux sens.
 *
 * Un onglet ouvert garde son code pendant des heures ; un déploiement
 * progressif fait coexister deux versions de serveur. Avant de publier, on
 * vérifie donc que :
 *
 *   - le client PUBLIÉ parle au serveur COURANT (l'onglet resté ouvert) ;
 *   - le client COURANT parle au serveur PUBLIÉ (le pod pas encore remplacé).
 *
 * Le script :
 *   1. lit sur npm la version de RÉFÉRENCE (`referenceDeCompat`, cœur de
 *      release) : celle que sert le canal de la version locale
 *      (`10.0.0-beta.6` → `beta`), ou, pour la première stable d'une majeure,
 *      la dernière pré-version publiée de cette majeure — jamais `latest`
 *      supposé : celui de `nodefony` sert encore l'ancien framework JS ;
 *   2. installe `nodefony` et `@nodefony/realtime` à cette version dans
 *      `tmp/apps/compat-<version>/` (réutilisé s'il est déjà là) ;
 *   3. lance le banc `crossVersion.compat.test.ts` (câble en boucle, vrais
 *      client et serveur) par `vitest.compat.config.ts` de `@nodefony/realtime`.
 *
 * Préalable : le cœur bâti (`npm run build`) — le serveur courant l'importe.
 *
 * Code : 0 = compatible (ou aucune version de la majeure en ligne, annoncé),
 * 1 = rupture constatée, 2 = vérification impossible (réseau, installation).
 *
 * @usage npm run release:compat
 * @usage npm run release:compat -- --version <version publiée>
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canalDeVersion,
  referenceDeCompat,
  validerVersion,
} from "./release-core.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const REALTIME = path.join(ROOT, "src", "packages", "@nodefony", "realtime");

let portableSpawn;
try {
  ({ portableSpawn } = await import("nodefony"));
} catch {
  console.error(
    "impossible de charger `nodefony` — le cœur n'est pas bâti. → npm run build",
  );
  process.exit(2);
}

/** Lance `command args…` sans shell ; `capture` rend la sortie au lieu de l'afficher. */
function run(command, args, { cwd = ROOT, env, capture = false } = {}) {
  const spawn = portableSpawn(command, args);
  return spawnSync(spawn.file, spawn.args, {
    cwd,
    env: env ?? process.env,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsVerbatimArguments: spawn.windowsVerbatimArguments,
  });
}

/** Arrêt « vérification impossible » : le motif est nommé, jamais un vert. */
function impossible(message) {
  console.error(`release:compat — vérification impossible : ${message}`);
  process.exit(2);
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

const localVersion = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src", "nodefony", "package.json"), "utf8"),
).version;

let version = argValue("--version");
let canal = "explicite";
if (version !== null && !validerVersion(version).ok)
  impossible(`--version n'est pas une version semver : ${version}`);
if (version === null) {
  if (canalDeVersion(localVersion) === null)
    impossible(`version locale illisible : ${localVersion}`);
  const view = run("npm", ["view", "nodefony", "dist-tags", "time", "--json"], {
    capture: true,
  });
  if (view.status !== 0) impossible(`npm view a échoué\n${view.stderr}`);
  const reference = referenceDeCompat(view.stdout, localVersion);
  if (reference === null) {
    // Une majeure neuve n'a rien en ligne à respecter : la compatibilité ne se
    // promet pas entre majeures. Dit, jamais tu.
    console.log(
      `release:compat — aucune version de la majeure de ${localVersion} n'est publiée : rien à éprouver.`,
    );
    process.exit(0);
  }
  ({ canal, version } = reference);
}

const dir = path.join(ROOT, "tmp", "apps", `compat-${version}`);
const installed = path.join(
  dir,
  "node_modules",
  "@nodefony",
  "realtime",
  "package.json",
);
const alreadyThere =
  fs.existsSync(installed) &&
  JSON.parse(fs.readFileSync(installed, "utf8")).version === version;

console.log(
  `release:compat — publiée ${version} (canal ${canal}) ↔ courante ${localVersion}`,
);

if (!alreadyThere) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify({ name: "nodefony-compat", private: true, type: "module" }, null, 2)}\n`,
  );
  // `--ignore-scripts` : rien de la version publiée ne s'exécute à l'installation.
  const install = run(
    "npm",
    [
      "install",
      `nodefony@${version}`,
      `@nodefony/realtime@${version}`,
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
    ],
    { cwd: dir, capture: true },
  );
  if (install.status !== 0)
    impossible(`installation de ${version} en échec\n${install.stderr}`);
}

// Point d'entrée UNIQUE vers la version publiée : ses imports se résolvent sur
// SES dépendances (`dir/node_modules`), jamais sur celles du dépôt.
fs.writeFileSync(
  path.join(dir, "entry.mjs"),
  [
    'import "reflect-metadata";',
    'export * as realtime from "@nodefony/realtime";',
    'export * as client from "nodefony/client";',
    'export { RpcError as ServerRpcError } from "nodefony";',
    "",
  ].join("\n"),
);

const bench = run(
  "npx",
  ["vitest", "run", "--config", "vitest.compat.config.ts"],
  {
    cwd: REALTIME,
    env: { ...process.env, NF_COMPAT_DIR: dir, NF_COMPAT_VERSION: version },
  },
);
process.exit(bench.status === 0 ? 0 : 1);
