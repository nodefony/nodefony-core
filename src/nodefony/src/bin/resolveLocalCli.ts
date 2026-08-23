import path from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { findProjectRoot } from "../cli/projectRoot";

/** Variable de garde : le CLI délégué ne délègue pas à son tour (anti-boucle). */
export const DELEGATED_ENV = "NF_CLI_DELEGATED";

/** Trace la décision du lanceur sur stderr quand la variable vaut `1`. */
export const DEBUG_ENV = "NF_CLI_DEBUG";

/** Décision du lanceur : exécuter soi-même, ou passer la main au CLI de l'app. */
export type TLocalCliDecision =
  | {
      /** Exécuter le CLI courant (celui qui tourne). */
      delegate: null;
      reason:
        | "already-delegated"
        | "no-project"
        | "no-local-cli"
        | "same-package";
      detail?: string;
    }
  | {
      /** Chemin ABSOLU du binaire du projet à exécuter à la place. */
      delegate: string;
      reason: "local-cli";
      projectRoot: string;
      selfVersion: string | null;
      localVersion: string | null;
    }
  | {
      /** Le projet a un `nodefony` installé, mais son CLI est inutilisable. */
      delegate: null;
      reason: "local-cli-broken";
      projectRoot: string;
      detail: string;
    };

/** Lit un `package.json` — `null` si absent ou illisible (jamais de throw). */
function readPackageJson(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Chemin déclaré par le champ `bin` d'un package.json (forme string ou map). */
function binEntry(pkg: Record<string, unknown>): string | null {
  const bin = pkg.bin;
  if (typeof bin === "string") return bin;
  if (bin && typeof bin === "object") {
    const entry = (bin as Record<string, unknown>).nodefony;
    if (typeof entry === "string") return entry;
  }
  return null;
}

/** `realpath` tolérant — retombe sur le chemin brut si la cible n'existe pas. */
function realOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Décide quel CLI Nodefony doit réellement s'exécuter : **celui de l'application**
 * dès qu'on se trouve dans un projet, sinon celui qu'on a lancé.
 *
 * Pourquoi cette règle : le binaire installé en global (`npm i -g nodefony`) est
 * la porte d'entrée du framework (c'est lui qui fait `create app`), mais sa version
 * dérive de celle des applications déjà générées. Exécuter le CLI global **dans**
 * une app reviendrait à piloter cette app avec un autre framework que celui de ses
 * `node_modules` : configs, scaffolds et commandes de module peuvent diverger.
 * La version qui fait autorité est donc toujours celle de l'application — comme le
 * wrapper d'un projet (`gradlew`, `mvnw`) prime sur l'outil de la machine.
 *
 * Fonction PURE (aucun effet de bord, aucun `process`) : les entrées sont passées
 * explicitement pour que la décision soit testable sans lancer de binaire.
 *
 * @param input.cwd - dossier courant, point de départ de la recherche du projet.
 * @param input.selfDir - racine du paquet `nodefony` en train de s'exécuter.
 * @param input.env - environnement (lu pour la garde anti-boucle).
 * @returns la décision : `delegate` = chemin du binaire à charger, ou `null` pour soi.
 */
export function resolveLocalCli(input: {
  cwd: string;
  selfDir: string;
  env?: Record<string, string | undefined>;
}): TLocalCliDecision {
  const env = input.env ?? {};

  // Le CLI de l'app a été chargé PAR le CLI global : il exécute, il ne redélègue pas.
  if (env[DELEGATED_ENV]) {
    return { delegate: null, reason: "already-delegated" };
  }

  const projectRoot = findProjectRoot(input.cwd);
  // Hors projet — cas nominal de `nodefony create app` : c'est bien le global qui court.
  if (!projectRoot) {
    return { delegate: null, reason: "no-project" };
  }

  const localPkgDir = path.join(projectRoot, "node_modules", "nodefony");
  const localPkg = existsSync(localPkgDir) ? readPackageJson(localPkgDir) : null;
  // Projet dont les dépendances ne sont pas installées : le global rend service
  // (il n'y a pas d'autre CLI à préférer).
  if (!localPkg) {
    return {
      delegate: null,
      reason: "no-local-cli",
      detail: `${localPkgDir} absent`,
    };
  }

  // Monorepo self-hosted, `npm link`, `create app --link` : le paquet du projet EST
  // celui qui tourne (symlink). Déléguer serait un aller-retour sans objet.
  if (realOrSelf(localPkgDir) === realOrSelf(input.selfDir)) {
    return { delegate: null, reason: "same-package" };
  }

  const rel = binEntry(localPkg);
  if (!rel) {
    return {
      delegate: null,
      reason: "local-cli-broken",
      projectRoot,
      detail: `le paquet nodefony de ${projectRoot} ne déclare aucun binaire (champ "bin")`,
    };
  }

  const localBin = path.resolve(localPkgDir, rel);
  if (!existsSync(localBin)) {
    return {
      delegate: null,
      reason: "local-cli-broken",
      projectRoot,
      detail: `le CLI du projet est déclaré mais absent : ${localBin} (paquet non construit ? \`npm install\` / \`npm run build\`)`,
    };
  }

  const version = (pkg: Record<string, unknown> | null): string | null =>
    typeof pkg?.version === "string" ? pkg.version : null;

  return {
    delegate: localBin,
    reason: "local-cli",
    projectRoot,
    selfVersion: version(readPackageJson(input.selfDir)),
    localVersion: version(localPkg),
  };
}
