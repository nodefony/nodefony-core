import path from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { findProjectRoot } from "../cli/projectRoot";
import { RESERVED_ENV } from "../config/reservedEnv";

/** Variable de garde : le CLI délégué ne délègue pas à son tour (anti-boucle). */
export const DELEGATED_ENV = RESERVED_ENV.NF_CLI_DELEGATED.name;

/** Trace la décision du lanceur sur stderr quand la variable vaut `1`. */
export const DEBUG_ENV = RESERVED_ENV.NF_CLI_DEBUG.name;

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

/**
 * Aligne `argv[1]` sur le CLI RÉELLEMENT exécuté après une délégation.
 *
 * 🔴 POURQUOI C'EST NÉCESSAIRE, et ce que ça a coûté de ne pas le faire. La
 * délégation charge le CLI de l'application par `import()` **dans le même
 * process** : `process.argv[1]` continue donc de désigner le binaire qu'on a
 * TAPÉ — un lien global vers un autre paquet, le plus souvent. Tout code qui
 * relance ensuite « la même commande » à partir d'`argv` repart alors sur le
 * MAUVAIS paquet, et personne ne le voit.
 *
 * Le cas qui l'impose : `DevSupervisor` relance le serveur par
 * `spawn(process.execPath, process.argv.slice(1))`. Avec un `nodefony` lié
 * globalement vers un dépôt de développement, l'enfant exécutait le Kernel du
 * DÉPÔT pendant que la configuration de l'application importait `nodefony`
 * depuis son propre `node_modules` — deux instances du module dans un seul
 * process. La marque de `defineConfig` (un symbole) ne traversait pas, le Kernel
 * prenait la config pour une configuration historique, `modules` tombait à `[]`,
 * aucun serveur ne montait, et le diagnostic accusait une configuration saine.
 * `npm run dev` n'a jamais eu le défaut : son `argv[1]` est déjà le CLI local.
 *
 * Corriger ICI plutôt que dans le superviseur : `argv[1]` est censé désigner le
 * script qui s'exécute, et d'autres consommateurs le liront (respawn, cluster,
 * messages d'aide). Une rustine posée chez un seul appelant laisserait les
 * autres faux.
 *
 * @param argv - `process.argv` d'origine.
 * @param delegate - chemin absolu du CLI vers lequel on délègue.
 * @returns un `argv` dont l'entrée 1 désigne le CLI délégué.
 */
export function alignArgvWithDelegate(
  argv: readonly string[],
  delegate: string,
): string[] {
  const next = [...argv];
  // `argv[0]` est l'exécutable Node, `argv[1]` le script : seul ce dernier ment.
  if (next.length >= 2) next[1] = delegate;
  return next;
}

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
