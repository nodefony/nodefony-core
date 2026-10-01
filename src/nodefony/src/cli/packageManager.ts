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
