/**
 * Résolution du gestionnaire de paquets d'un projet — UNE seule implémentation,
 * appelée par tout ce qui installe, construit ou CONSEILLE une commande
 * (`nodefony install`, `create app`, `create module`, messages d'aide).
 *
 * Quatre sources, dans cet ordre, la première qui répond gagne :
 *
 * 1. **la configuration** (`packageManager` de `nodefony.config.ts`) — un choix
 *    écrit l'emporte toujours sur une déduction ;
 * 2. **le fichier de verrou** présent à la racine — c'est lui qui dit quel outil
 *    a réellement installé l'arbre, et en mélanger deux corrompt `node_modules` ;
 * 3. **`npm_config_user_agent`** — posé par les quatre gestionnaires dans tout ce
 *    qu'ils lancent, `pnpm create nodefony` compris (`pnpm/12.6.0 npm/? node/…`) ;
 *    c'est la seule source disponible pour `create app`, qui tourne hors projet ;
 * 4. **npm**, à défaut — il est livré avec Node.
 *
 * La source est RENDUE avec le nom : un choix déduit se dit comme tel.
 */
import fs from "node:fs";
import path from "node:path";
import type { PackageManagerName } from "../Cli";

/** Gestionnaires pris en charge, dans l'ordre où l'aide les cite. */
export const PACKAGE_MANAGERS: readonly PackageManagerName[] = [
  "npm",
  "pnpm",
  "yarn",
  "bun",
];

/** D'où vient le gestionnaire retenu. */
export type PackageManagerSource =
  "config" | "lockfile" | "user-agent" | "default";

/** Gestionnaire retenu, et la source qui l'a désigné. */
export interface IPackageManagerResolution {
  name: PackageManagerName;
  source: PackageManagerSource;
  /** Fichier de verrou qui a tranché, quand `source === "lockfile"`. */
  lockfile?: string;
}

/**
 * Fichiers de verrou, par ordre de priorité. Deux verrous côte à côte sont une
 * anomalie ; le premier listé l'emporte, de façon stable.
 */
export const LOCKFILES: readonly (readonly [string, PackageManagerName])[] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

/** Garde de type : la valeur est-elle un gestionnaire pris en charge ? */
export function isPackageManagerName(
  value: unknown,
): value is PackageManagerName {
  return (
    typeof value === "string" &&
    (PACKAGE_MANAGERS as readonly string[]).includes(value)
  );
}

/**
 * Lit le gestionnaire dans un `npm_config_user_agent` (`pnpm/12.6.0 npm/? …`).
 *
 * @param userAgent - valeur de la variable, absente hors d'un gestionnaire
 * @returns le gestionnaire nommé en tête, ou `null` s'il n'est pas reconnu
 */
export function packageManagerFromUserAgent(
  userAgent: string | undefined,
): PackageManagerName | null {
  const head = userAgent?.trim().split(/\s/u, 1)[0] ?? "";
  const name = head.split("/", 1)[0];
  return isPackageManagerName(name) ? name : null;
}

/**
 * Désigne le gestionnaire de paquets d'un projet (cf l'ordre des sources en
 * tête de fichier).
 *
 * @param input.configured - valeur `packageManager` de la configuration
 * @param input.dir - racine du projet, où chercher un fichier de verrou
 * @param input.userAgent - défaut `process.env.npm_config_user_agent`
 * @param input.exists - test d'existence injectable (défaut `fs.existsSync`)
 * @returns le gestionnaire retenu et sa source
 */
export function resolvePackageManager(
  input: {
    readonly configured?: PackageManagerName | undefined;
    readonly dir?: string | undefined;
    readonly userAgent?: string | undefined;
    readonly exists?: (file: string) => boolean;
  } = {},
): IPackageManagerResolution {
  if (input.configured) {
    return { name: input.configured, source: "config" };
  }
  if (input.dir) {
    const exists = input.exists ?? fs.existsSync;
    for (const [file, name] of LOCKFILES) {
      if (exists(path.join(input.dir, file))) {
        return { name, source: "lockfile", lockfile: file };
      }
    }
  }
  const fromAgent = packageManagerFromUserAgent(
    "userAgent" in input
      ? input.userAgent
      : process.env["npm_config_user_agent"],
  );
  if (fromAgent) {
    return { name: fromAgent, source: "user-agent" };
  }
  return { name: "npm", source: "default" };
}

/**
 * Arguments qui lancent un BINAIRE installé dans le projet (`nodefony`, `vitest`…).
 *
 * Quatre formes, parce que les quatre gestionnaires n'en partagent aucune :
 * `npm exec --` (sans le `--`, npm lit les options du binaire comme les
 * siennes), `pnpm exec`, et `run` pour yarn et bun, qui résolvent un nom
 * absent des scripts dans `node_modules/.bin`. `bun x` est écarté : il
 * TÉLÉCHARGE ce qu'il ne trouve pas, là où l'on veut l'échec franc d'un binaire
 * que le projet n'a pas installé.
 *
 * @param name - gestionnaire du projet
 * @param bin - binaire à lancer
 * @param args - ses arguments, transmis tels quels
 * @returns les arguments à donner au gestionnaire (sans son nom)
 */
export function packageManagerExecArgs(
  name: PackageManagerName,
  bin: string,
  args: readonly string[] = [],
): string[] {
  switch (name) {
    case "npm":
      return ["exec", "--", bin, ...args];
    case "pnpm":
      return ["exec", bin, ...args];
    case "yarn":
    case "bun":
      return ["run", bin, ...args];
  }
}

/**
 * Lignes de commande à AFFICHER pour un gestionnaire — ce qu'on conseille à
 * l'utilisateur doit être ce que son outil accepte, et sortir de la même règle
 * que ce qu'on exécute ({@link packageManagerExecArgs}).
 *
 * @param name - gestionnaire du projet
 * @returns les gestes : installer l'arbre, ajouter un paquet, lancer un
 *   script, lancer un binaire
 */
export function packageManagerCommandLines(name: PackageManagerName): {
  install: string;
  /** `npm install x` ; `add` chez les trois autres — yarn 1 refuse `install x`. */
  add: (pkg: string) => string;
  run: (script: string) => string;
  exec: (bin: string) => string;
  /** Audit des dépendances de PRODUCTION ; bun n'a pas de filtre, il audite tout. */
  audit: string;
} {
  return {
    install: `${name} install`,
    add: (pkg) => `${name} ${name === "npm" ? "install" : "add"} ${pkg}`,
    run: (script) => `${name} run ${script}`,
    exec: (bin) => [name, ...packageManagerExecArgs(name, bin)].join(" "),
    audit: {
      npm: "npm audit --omit=dev",
      pnpm: "pnpm audit --prod",
      yarn: "yarn audit --groups dependencies",
      bun: "bun audit",
    }[name],
  };
}

/**
 * Ligne de script qui lance `script` dans chaque module du workspace
 * (`modules/*`), sans échouer sur un module qui ne le déclare pas.
 *
 * Une forme par gestionnaire, parce qu'aucune ne se transpose :
 *
 * - **bun** RÉÉCRIT `npm run` en `bun run` dans les scripts, et ignore
 *   `--workspaces` : `npm run build --workspaces` y relance le `build` de la
 *   RACINE, qui se relance lui-même, sans fin. Il lui faut `--filter`, borné
 *   au dossier des modules (un filtre `*` attraperait la racine) ;
 * - **pnpm** : `-r` exclut la racine par défaut ;
 * - **yarn 1** n'a pas d'`--if-present` : un module sans le script échoue
 *   franchement. Le gabarit de module déclare `build`, `typecheck` et `test`.
 *
 * Pas de commande `nodefony` pour ce parcours : elle démarrerait le noyau, qui
 * charge les modules dont elle doit justement bâtir le `dist`, et chaque
 * `build` paierait ce démarrage.
 *
 * @param name - gestionnaire du projet
 * @param script - script à lancer dans chaque module
 * @returns la ligne à écrire dans un script du `package.json` racine
 */
export function packageManagerWorkspaceRun(
  name: PackageManagerName,
  script: string,
): string {
  switch (name) {
    case "npm":
      return `npm run ${script} --workspaces --if-present`;
    case "pnpm":
      return `pnpm -r --if-present run ${script}`;
    case "yarn":
      return `yarn workspaces run ${script}`;
    case "bun":
      return `bun run --filter './modules/*' ${script}`;
  }
}

/**
 * Le script délègue-t-il DÉJÀ aux modules, sous l'une des quatre formes de
 * {@link packageManagerWorkspaceRun} ? Rend le câblage idempotent même après
 * un changement de gestionnaire : on ne greffe pas une seconde délégation.
 *
 * @param line - ligne de script du `package.json` racine
 * @returns vrai si une délégation aux modules y figure
 */
export function hasWorkspaceRun(line: string): boolean {
  return /--workspaces\b|\bpnpm\s+-r\b|\byarn\s+workspaces\s+run\b|--filter\s+'\.\/modules\/\*'/u.test(
    line,
  );
}

/**
 * Un gestionnaire ne lie-t-il un module du workspace à la racine que si la
 * racine le DÉCLARE (`"@app/blog": "workspace:*"`) ?
 *
 * pnpm et bun : oui — sans la déclaration, `import("@app/blog")` échoue au
 * boot et le typecheck tombe sur « Cannot find module ». npm et yarn 1 lient
 * tout workspace d'office, et REFUSENT le protocole `workspace:` (npm :
 * `EUNSUPPORTEDPROTOCOL`) : la déclaration y serait une panne, pas un filet.
 *
 * @param name - gestionnaire du projet
 * @returns vrai s'il faut déclarer le module dans les dépendances racine
 */
export function needsWorkspaceProtocol(name: PackageManagerName): boolean {
  return name === "pnpm" || name === "bun";
}
