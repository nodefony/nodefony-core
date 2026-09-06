import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exit } from "node:process";
import type { EnvironmentType } from "nodefony";
import {
  resolveLocalCli,
  DEBUG_ENV,
  DELEGATED_ENV,
  type TLocalCliDecision,
} from "./resolveLocalCli";
// Import STATIQUE, et c'est voulu : le bin est bundlé en fichier UNIQUE, donc
// un import dynamique y créerait un second chunk (le bundler refuse). Ces deux
// fonctions ne tirent que `node:fs`/`node:path` — le coût est nul, et le TAB
// répond sans jamais charger le core.
import { readCliManifest, computeCompletions } from "../cli/completion";
import { detectEnvironmentFromArgv } from "../runtime/engineEnvironment";

/**
 * Résout le **mode runtime** (dev/prod) AVANT le kernel : `NODE_ENV` (ambiant)
 * PRIME sur l'intention de la commande (argv).
 *
 * ⚠️ **Ce n'est pas « le 12-factor » qui l'impose, et l'écrire était faux.** Sa
 * section *Config* REJETTE au contraire les groupes d'environnement : « In a
 * twelve-factor app, env vars are granular controls […] They are never grouped
 * together as "environments" ». `NODE_ENV` est précisément ce qu'elle
 * déconseille. Ce qui relève d'elle ici est la seule PRÉCÉDENCE — la
 * configuration ambiante l'emporte sur ce que la commande croit savoir.
 *
 * Ce qui garantit le mode en production est FACTUEL : Node.js le recommande
 * (« Always run your Node.js with NODE_ENV=production set »), l'image générée
 * pose `ENV NODE_ENV=production`, et les lanceurs déclarent leur intention. Miroir pur de `Kernel.resolveRuntimeEnv`, mais sans instance (le bin tourne
 * avant `new CliKernel()`) et autorisé à rendre `undefined` (aucun `.env.<env>` chargé
 * si ni NODE_ENV ni commande connue — ex. `nodefony frontend:build` hors contexte env).
 */
function resolveRuntimeEnv(argv: string[]): EnvironmentType | undefined {
  const node = process.env.NODE_ENV;
  if (node === "dev" || node === "development") return "development";
  if (node === "prod" || node === "production") return "production";
  return detectEnvironmentFromArgv(argv);
}

/** Trace la décision du lanceur (opt-in `NF_CLI_DEBUG=1`, jamais par défaut). */
function traceDecision(decision: TLocalCliDecision, selfDir: string): void {
  if (!process.env[DEBUG_ENV]) return;
  const target =
    decision.delegate ?? `${selfDir} (soi-même — ${decision.reason})`;
  process.stderr.write(`[nodefony] cli → ${target}\n`);
}

/**
 * Boote le CLI de CE paquet. Les imports du core sont **dynamiques** : quand le
 * lanceur délègue à l'app, le core de ce paquet-ci ne doit jamais être chargé
 * (sinon deux frameworks en mémoire, et le coût de boot payé deux fois).
 */
async function runSelf(): Promise<unknown> {
  // ─── TAB : répondre sans rien charger de plus qu'un lecteur de JSON ────────
  // Un TAB doit être IMPERCEPTIBLE. Le fast-path `__complete` vivait dans
  // `CliKernel.start()` — donc APRÈS l'import du core entier, la lecture des
  // `.env` et la construction d'un CliKernel. Mesuré : 0,46 s par TAB, quand
  // Node seul en coûte 0,11 — un demi-cycle de latence pour lire un fichier de
  // 6 ko. Le manifest cache porte DÉJÀ les intégrées (il est extrait de
  // commander après leur enregistrement) : quand il est là, rien d'autre n'est
  // nécessaire.
  //
  // Absent ou illisible, on ne devine pas : on laisse le chemin normal
  // reprendre la main, qui construira le repli des intégrées en mémoire. Le
  // manifest étant réécrit par chaque commande, ce cas ne dure jamais.
  if (process.argv[2] === "__complete") {
    try {
      const cached = readCliManifest(process.cwd());
      if (cached) {
        const sep = process.argv.indexOf("--");
        const words = sep >= 0 ? process.argv.slice(sep + 1) : [];
        const candidates = computeCompletions(cached, words);
        if (candidates.length > 0) {
          process.stdout.write(`${candidates.join("\n")}\n`);
        }
        // Une complétion sort TOUJOURS en 0 : un TAB qui échoue doit rendre une
        // liste vide, jamais un message dans le terminal de l'utilisateur.
        return exit(0);
      }
    } catch {
      // On retombe sur le chemin normal — il sait faire sans cache.
    }
  }

  const { CliKernel, loadEnv } = await import("nodefony");

  const runtimeEnv = resolveRuntimeEnv(process.argv.slice(2));
  // Axe DÉPLOIEMENT (string libre : staging/canary/prod-eu…) — distinct du mode runtime.
  const appEnv = process.env.APP_ENV ?? process.env.NF_ENV;

  // Canonise NODE_ENV tôt (idempotent si l'orchestrateur l'a déjà posé) : le mode
  // runtime ne vit PLUS dans un `.env` committé (conv B + piège Next : un déploiement
  // sans NODE_ENV ne doit pas hériter d'un `development` figé en dur). Les configs de
  // modules lues au boot (qui lisent `process.env.NODE_ENV`) le voient ainsi résolu.
  if (runtimeEnv) process.env.NODE_ENV = runtimeEnv;

  // Peuple process.env depuis les .env du projet AVANT le boot : les configs de
  // modules (REDIS_*, etc.) les lisent au moment de la construction du kernel.
  loadEnv({ runtimeEnv, appEnv });

  return new CliKernel(runtimeEnv).start().catch((e) => {
    exit(e.code || 1);
  });
}

/**
 * Point d'entrée du binaire `nodefony` — **le CLI de l'application prime**.
 *
 * Le binaire global (`npm i -g nodefony`) est la porte d'entrée du framework : il
 * crée les applications. Mais une fois DANS une app, la version qui fait autorité
 * est celle des `node_modules` du projet : c'est elle qui connaît ses modules, ses
 * scaffolds et ses commandes. Le lanceur remonte donc au projet et, s'il y trouve
 * un autre paquet `nodefony` que lui-même, lui passe la main (`import` du binaire
 * du projet, dans le même process — ni spawn, ni double kernel).
 *
 * Une install cassée (paquet présent, binaire absent) échoue **bruyamment** : on ne
 * pilote pas une app avec une version de framework qu'elle n'a pas choisie.
 */
const selfDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const decision = resolveLocalCli({
  cwd: process.cwd(),
  selfDir,
  env: process.env,
});
traceDecision(decision, selfDir);

if (decision.reason === "local-cli-broken") {
  process.stderr.write(
    `nodefony: ${decision.detail}\n` +
      `           (projet : ${decision.projectRoot})\n`,
  );
  exit(1);
}

let kernel: unknown;
if (decision.delegate) {
  // La garde empêche le CLI de l'app de re-déléguer en boucle.
  process.env[DELEGATED_ENV] = "1";
  kernel = await import(pathToFileURL(decision.delegate).href);
} else {
  kernel = await runSelf();
}

export default kernel;
