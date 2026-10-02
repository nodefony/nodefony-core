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
 * Arguments d'une installation qui SUIT une modification du manifeste
 * (`create app`, `create module`, une dépendance ajoutée).
 *
 * pnpm fige le verrou dès que `CI` est posé (`frozen-lockfile` par défaut) :
 * l'installation qui doit justement l'accorder au manifeste qu'on vient
 * d'écrire échoue alors sur `ERR_PNPM_OUTDATED_LOCKFILE` — vécu sur la forge,
 * au premier `create module`. npm, yarn 1 et bun ne figent pas sans qu'on le
 * demande.
 *
 * @param name - gestionnaire du projet
 * @returns les arguments à donner au gestionnaire (sans son nom)
 */
export function packageManagerUpdateInstallArgs(
  name: PackageManagerName,
): string[] {
  return name === "pnpm" ? ["install", "--no-frozen-lockfile"] : ["install"];
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

/**
 * Majeure de l'outil que les gabarits d'une application supposent, quand il
 * n'est pas livré avec l'image Node : pnpm 11 a déplacé ses réglages dans
 * `pnpm-workspace.yaml` (`allowBuilds`), que le gabarit écrit ; bun 1 lit
 * `bun.lock`. yarn 1 et npm viennent avec les images `node:*` et les
 * exécuteurs de la forge — le gabarit (`resolutions`, `yarn workspaces run`)
 * est écrit pour yarn 1, pas pour ses successeurs.
 */
export const PACKAGE_MANAGER_TOOL_MAJOR: Readonly<
  Record<"pnpm" | "bun", string>
> = { pnpm: "12", bun: "1" };

/**
 * Délai de décantation, en jours, qu'une application générée impose à ses
 * dépendances : une version publiée depuis moins longtemps n'est pas installée,
 * le gestionnaire retient la précédente.
 *
 * Un paquet compromis (compte de mainteneur volé) est presque toujours repéré
 * et retiré en quelques heures ; ne jamais l'installer le jour de sa sortie
 * retire l'application de cette fenêtre. Sous verrou (`npm ci`,
 * `--frozen-lockfile`) le délai ne joue pas : il ne filtre que la RÉSOLUTION.
 */
export const RELEASE_AGE_DAYS = 3;

/**
 * Paquets EXEMPTÉS du délai : ceux du framework. Une application créée le jour
 * d'une publication réclame cette version précise — sans exemption, elle ne
 * s'installerait pas pendant {@link RELEASE_AGE_DAYS} jours. L'exemption ne
 * couvre que le paquet NOMMÉ, jamais ses dépendances tierces.
 */
export const RELEASE_AGE_EXCLUDES: readonly string[] = [
  "nodefony",
  "@nodefony/*",
  "create-nodefony",
];

/** Le délai de décantation, exprimé dans le fichier et l'unité d'UN outil. */
export interface IReleaseAgePolicy {
  /** Fichier du projet qui porte le réglage. */
  file: ".npmrc" | "pnpm-workspace.yaml" | "bunfig.toml";
  /** Délai dans l'unité que l'outil lit. */
  value: number;
  /** Unité de `value` — chaque outil a la sienne, et une erreur ne prévient pas. */
  unit: "days" | "minutes" | "seconds";
  /** Motifs exemptés ({@link RELEASE_AGE_EXCLUDES}). */
  excludes: readonly string[];
}

/**
 * Traduit {@link RELEASE_AGE_DAYS} dans la grammaire d'un gestionnaire.
 *
 * Constaté sur chaque outil (un délai de 30 jours refuse une version récente,
 * l'exemption la laisse passer) : npm ≥ 11.17 (`min-release-age`, jours, et
 * `min-release-age-exclude`), pnpm 12 (`minimumReleaseAge`, minutes), bun
 * (`minimumReleaseAge`, secondes). yarn 1 n'a aucun réglage de ce genre.
 *
 * @param name - gestionnaire du projet
 * @returns la règle à écrire, ou `null` quand l'outil ne sait pas l'appliquer
 */
export function packageManagerReleaseAge(
  name: PackageManagerName,
): IReleaseAgePolicy | null {
  const excludes = RELEASE_AGE_EXCLUDES;
  switch (name) {
    case "npm":
      return { file: ".npmrc", value: RELEASE_AGE_DAYS, unit: "days", excludes };
    case "pnpm":
      return {
        file: "pnpm-workspace.yaml",
        value: RELEASE_AGE_DAYS * 24 * 60,
        unit: "minutes",
        excludes,
      };
    case "bun":
      return {
        file: "bunfig.toml",
        value: RELEASE_AGE_DAYS * 24 * 60 * 60,
        unit: "seconds",
        excludes,
      };
    case "yarn":
      return null;
  }
}

/** Action GitHub qui pose l'outil sur l'exécuteur, avant `setup-node`. */
export interface IPackageManagerGithubSetup {
  /**
   * Référence ÉPINGLÉE par SHA de commit, suivie de sa version en commentaire
   * YAML (`owner/action@<sha> # vX.Y.Z`) : un tag se déplace, un SHA non — et
   * le commentaire est ce que Dependabot relit pour proposer la montée.
   */
  uses: string;
  /** Nom de l'entrée qui porte la version (`version`, `bun-version`). */
  versionInput: string;
  version: string;
}

/**
 * Ce qu'une chaîne d'INTÉGRATION (forge, image de conteneur) doit écrire pour
 * un gestionnaire — UNE règle, lue par les gabarits CI et le `Dockerfile`.
 */
export interface IPackageManagerToolchain {
  /** Verrou que le gestionnaire écrit, et que la chaîne exige. */
  lockfile: string;
  /** Installation stricte : refuse un verrou désaccordé du `package.json`. */
  frozenInstall: string;
  /** Valeur `cache:` de `actions/setup-node`, `null` s'il ne connaît pas l'outil. */
  setupNodeCache: "npm" | "pnpm" | "yarn" | null;
  /** Action qui installe l'outil sur l'exécuteur GitHub, `null` s'il y est déjà. */
  githubSetup: IPackageManagerGithubSetup | null;
  /** Commande qui installe l'outil dans une image `node:*`, `null` s'il y est déjà. */
  bootstrap: string | null;
  /** Dossier de cache dans l'image (montage BuildKit). */
  imageCacheDir: string;
  /** Dossier de cache RELATIF au projet (GitLab ne garde que l'arbre du job). */
  projectCacheDir: string;
  /** Installation stricte qui écrit son cache dans {@link projectCacheDir}. */
  projectCachedInstall: string;
  /** Installation de l'image, sans scripts, verrou présent. */
  imageInstall: string;
  /** Même chose sans verrou (application fraîche, jamais installée). */
  imageInstallUnlocked: string;
  /** Retire les dépendances de développement d'un arbre installé. */
  prune: string;
}

/**
 * Commandes d'installation, de cache et d'élagage d'un gestionnaire, pour la
 * forge et pour l'image.
 *
 * Aucune ne se transpose : `npm ci` exige `package-lock.json`, `npm prune`
 * refuse le protocole `workspace:*` qu'une application pnpm ou bun déclare
 * (`EUNSUPPORTEDPROTOCOL`), et chaque outil a son dossier de cache. Les
 * scripts d'installation restent coupés dans l'image (`--ignore-scripts`) :
 * les paquets natifs d'une application Nodefony embarquent leurs binaires.
 *
 * @param name - gestionnaire du projet
 * @returns les lignes à écrire dans les gabarits d'intégration
 */
export function packageManagerToolchain(
  name: PackageManagerName,
): IPackageManagerToolchain {
  switch (name) {
    case "npm":
      return {
        lockfile: "package-lock.json",
        frozenInstall: "npm ci",
        setupNodeCache: "npm",
        githubSetup: null,
        bootstrap: null,
        imageCacheDir: "/root/.npm",
        projectCacheDir: ".npm",
        projectCachedInstall: "npm ci --cache .npm --prefer-offline",
        imageInstall: "npm ci --ignore-scripts --no-audit --no-fund",
        imageInstallUnlocked:
          "npm install --ignore-scripts --no-audit --no-fund",
        prune: "npm prune --omit=dev",
      };
    case "pnpm":
      return {
        lockfile: "pnpm-lock.yaml",
        frozenInstall: "pnpm install --frozen-lockfile",
        setupNodeCache: "pnpm",
        githubSetup: {
          uses: "pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86 # v6.0.10",
          versionInput: "version",
          version: PACKAGE_MANAGER_TOOL_MAJOR.pnpm,
        },
        bootstrap: `npm install -g --no-audit --no-fund pnpm@${PACKAGE_MANAGER_TOOL_MAJOR.pnpm}`,
        imageCacheDir: "/root/.local/share/pnpm/store",
        projectCacheDir: ".pnpm-store",
        projectCachedInstall:
          "pnpm install --frozen-lockfile --store-dir .pnpm-store",
        imageInstall: "pnpm install --frozen-lockfile --ignore-scripts",
        imageInstallUnlocked: "pnpm install --ignore-scripts",
        prune: "pnpm prune --prod --ignore-scripts",
      };
    case "yarn":
      return {
        lockfile: "yarn.lock",
        frozenInstall: "yarn install --frozen-lockfile",
        setupNodeCache: "yarn",
        githubSetup: null,
        bootstrap: null,
        imageCacheDir: "/usr/local/share/.cache/yarn",
        projectCacheDir: ".yarn-cache",
        projectCachedInstall:
          "yarn install --frozen-lockfile --cache-folder .yarn-cache",
        imageInstall:
          "yarn install --frozen-lockfile --ignore-scripts --non-interactive",
        imageInstallUnlocked: "yarn install --ignore-scripts --non-interactive",
        // yarn 1 n'a pas de `prune` : on réinstalle en production, ce qui
        // retire les dépendances de développement de l'arbre.
        prune:
          "yarn install --production --frozen-lockfile --ignore-scripts --non-interactive",
      };
    case "bun":
      return {
        lockfile: "bun.lock",
        frozenInstall: "bun install --frozen-lockfile",
        setupNodeCache: null,
        githubSetup: {
          uses: "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0",
          versionInput: "bun-version",
          version: `${PACKAGE_MANAGER_TOOL_MAJOR.bun}.x`,
        },
        bootstrap: `npm install -g --no-audit --no-fund bun@${PACKAGE_MANAGER_TOOL_MAJOR.bun}`,
        imageCacheDir: "/root/.bun/install/cache",
        projectCacheDir: ".bun-cache",
        projectCachedInstall:
          "BUN_INSTALL_CACHE_DIR=.bun-cache bun install --frozen-lockfile",
        imageInstall: "bun install --frozen-lockfile --ignore-scripts",
        imageInstallUnlocked: "bun install --ignore-scripts",
        // bun n'a pas de `prune`, et `install --production` sur un arbre
        // DÉJÀ installé n'en retire rien (constaté : vitest restait dans
        // l'image). On repart d'un arbre vide, depuis le cache.
        prune:
          "rm -rf node_modules modules/*/node_modules && bun install --production --frozen-lockfile --ignore-scripts",
      };
  }
}
