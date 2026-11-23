import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { GENERATED_VITE_CONFIG_FILE, isPlainObject } from "nodefony";

/**
 * Nom du fichier d'empreinte, posé à côté du manifeste Vite (`<outDir>/.vite/`).
 */
export const BUILD_FINGERPRINT_FILE = "nodefony-build.json";

/**
 * Paquet dont la version nomme « le framework » dans les messages : tous les
 * paquets Nodefony sont publiés à la même version, un seul suffit à la dire.
 */
const FRAMEWORK_PACKAGE = "@nodefony/frontend";

/**
 * Paquets qui construisent le bundle sans être forcément déclarés par
 * l'application : `vite` arrive souvent par un autre paquet, et le client
 * isomorphe injecté dans le bundle vient du cœur.
 */
const ALWAYS_FINGERPRINTED: readonly string[] = [
  "nodefony",
  FRAMEWORK_PACKAGE,
  "vite",
];

/** Changements nommés un par un dans le motif avant d'être comptés. */
const NAMED_CHANGES = 3;

/**
 * Versions INSTALLÉES de ce qui construit un bundle, par nom de paquet.
 */
export type BuildFingerprint = Readonly<Record<string, string>>;

/**
 * Verdict de fraîcheur d'une entrée : faut-il la reconstruire, et pourquoi.
 */
export interface IBuildFreshness {
  /** `true` : le bundle en place a été construit à partir de l'état actuel. */
  readonly fresh: boolean;
  /** Motif lisible, affiché tel quel par `frontend:build`. */
  readonly reason: string;
  /** Empreinte actuelle — celle que le build écrira s'il a lieu. */
  readonly fingerprint: BuildFingerprint;
}

/**
 * Relève les versions installées de ce qui construit le bundle d'une entrée.
 *
 * Les paquets relevés sont ceux que déclare le `package.json` le plus proche de
 * `root` (dépendances et dépendances de développement), plus le cœur,
 * `@nodefony/frontend` et `vite`. Chaque version est lue dans le `package.json`
 * du paquet RÉSOLU, en remontant les `node_modules` depuis `root` comme le fait
 * Node. Un paquet introuvable n'entre pas dans l'empreinte.
 *
 * On lit des versions et jamais des dates : la date d'un fichier installé par
 * npm ne dit pas quand il a été installé.
 *
 * @param root - racine front de l'entrée (`IResolvedFrontendEntry.root`).
 * @returns l'empreinte, clés triées.
 */
export async function collectBuildFingerprint(
  root: string,
): Promise<BuildFingerprint> {
  const names = new Set<string>(ALWAYS_FINGERPRINTED);
  const manifest = await findNearestManifest(root);
  if (manifest !== null) {
    for (const field of ["dependencies", "devDependencies"]) {
      const deps = manifest[field];
      if (isPlainObject(deps))
        for (const name of Object.keys(deps)) names.add(name);
    }
  }
  const sorted = [...names].sort();
  const versions = await Promise.all(
    sorted.map((name) => resolveInstalledVersion(root, name)),
  );
  const fingerprint: Record<string, string> = {};
  for (let i = 0; i < sorted.length; i++) {
    const version = versions[i];
    const name = sorted[i];
    if (version !== null && version !== undefined && name !== undefined) {
      fingerprint[name] = version;
    }
  }
  return fingerprint;
}

/**
 * Relit l'empreinte écrite au dernier build d'une entrée.
 *
 * @param outDir - dossier de sortie de l'entrée.
 * @returns l'empreinte, ou `null` si elle est absente ou illisible — un bundle
 *   construit avant l'empreinte, ou un fichier abîmé.
 */
export async function readBuildFingerprint(
  outDir: string,
): Promise<BuildFingerprint | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(fingerprintPath(outDir), "utf8"));
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.versions)) return null;
  const fingerprint: Record<string, string> = {};
  for (const [name, version] of Object.entries(parsed.versions)) {
    if (typeof version === "string") fingerprint[name] = version;
  }
  return fingerprint;
}

/**
 * Écrit l'empreinte d'un build réussi à côté de son manifeste Vite.
 *
 * @param outDir - dossier de sortie de l'entrée.
 * @param fingerprint - empreinte relevée AVANT le build.
 */
export async function writeBuildFingerprint(
  outDir: string,
  fingerprint: BuildFingerprint,
): Promise<void> {
  const file = fingerprintPath(outDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    `${JSON.stringify({ versions: fingerprint }, null, 2)}\n`,
  );
}

/**
 * Dit ce qui a changé entre deux empreintes, ou `null` si rien n'a changé.
 *
 * Les paquets Nodefony changent ensemble : leur montée se dit en une phrase,
 * « framework passé de X à Y », plutôt qu'en quinze.
 *
 * @param previous - empreinte du dernier build, `null` s'il n'en a pas laissé.
 * @param current - empreinte actuelle.
 * @returns le motif de reconstruction, ou `null`.
 */
export function describeFingerprintChange(
  previous: BuildFingerprint | null,
  current: BuildFingerprint,
): string | null {
  if (previous === null) {
    return "aucune empreinte des versions au dernier build (construit par une version antérieure du framework)";
  }
  const changes: string[] = [];
  const frameworkBefore = frameworkVersion(previous);
  const frameworkNow = frameworkVersion(current);
  const frameworkMoved = frameworkBefore !== frameworkNow;
  if (frameworkMoved) {
    changes.push(
      `framework passé de ${frameworkBefore ?? "?"} à ${frameworkNow ?? "?"}`,
    );
  }
  const names = new Set([...Object.keys(previous), ...Object.keys(current)]);
  for (const name of [...names].sort()) {
    if (frameworkMoved && isFrameworkPackage(name)) continue;
    const before = previous[name];
    const now = current[name];
    if (before === now) continue;
    if (before === undefined) changes.push(`${name} ajouté (${now})`);
    else if (now === undefined) changes.push(`${name} retiré`);
    else changes.push(`${name} passé de ${before} à ${now}`);
  }
  if (changes.length === 0) return null;
  if (changes.length <= NAMED_CHANGES) return changes.join(", ");
  const rest = changes.length - NAMED_CHANGES;
  return `${changes.slice(0, NAMED_CHANGES).join(", ")} et ${rest} autre${rest > 1 ? "s" : ""}`;
}

/**
 * Juge si le bundle d'une entrée est à jour, et dit pourquoi.
 *
 * Trois conditions, dans l'ordre où elles se lisent : un manifeste Vite existe ;
 * les versions de ce qui construit le bundle n'ont pas bougé depuis ce build ;
 * aucun fichier source (sous `root`, hors `node_modules`, `.vite`, `outDir` et
 * `vite.config.generated.mjs`) n'est plus récent que le manifeste.
 *
 * @param root - racine front de l'entrée.
 * @param outDir - dossier de sortie de l'entrée.
 * @returns le verdict, son motif et l'empreinte actuelle.
 */
export async function judgeBuildFreshness(
  root: string,
  outDir: string,
): Promise<IBuildFreshness> {
  const fingerprint = await collectBuildFingerprint(root);
  let manifestMtime: number;
  try {
    manifestMtime = (await fs.stat(path.join(outDir, ".vite", "manifest.json")))
      .mtimeMs;
  } catch {
    return { fresh: false, reason: "jamais construit", fingerprint };
  }
  const change = describeFingerprintChange(
    await readBuildFingerprint(outDir),
    fingerprint,
  );
  if (change !== null) return { fresh: false, reason: change, fingerprint };
  if ((await newestSourceMtime(root, outDir)) > manifestMtime) {
    return {
      fresh: false,
      reason: "sources modifiées depuis le dernier build",
      fingerprint,
    };
  }
  const framework = frameworkVersion(fingerprint);
  return {
    fresh: true,
    reason: `sources et versions inchangées${framework === undefined ? "" : ` (framework ${framework})`}`,
    fingerprint,
  };
}

/**
 * Date de modification du fichier le plus récent sous `dir`, en sautant
 * `node_modules`, `.vite`, le dossier de sortie et la config Vite générée par
 * le serveur de dev.
 *
 * @param dir - racine front.
 * @param outDir - dossier de sortie, exclu s'il est sous `dir`.
 * @returns la date en millisecondes, 0 si rien n'est lisible.
 */
async function newestSourceMtime(dir: string, outDir: string): Promise<number> {
  let items: Dirent[];
  try {
    items = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  const dates = await Promise.all(
    items.map(async (item): Promise<number> => {
      // La config que le superviseur de dev RÉÉCRIT à chaque démarrage n'est
      // pas une source : la compter reconstruisait le bundle après tout
      // `npm run dev`. Nom unique, partagé avec le contrôle de fraîcheur du cœur.
      if (
        item.name === "node_modules" ||
        item.name === ".vite" ||
        item.name === GENERATED_VITE_CONFIG_FILE
      ) {
        return 0;
      }
      const full = path.join(dir, item.name);
      if (full === outDir) return 0;
      if (item.isDirectory()) return newestSourceMtime(full, outDir);
      try {
        return (await fs.stat(full)).mtimeMs;
      } catch {
        // Fichier disparu entre la lecture du dossier et sa date.
        return 0;
      }
    }),
  );
  let newest = 0;
  for (const date of dates) if (date > newest) newest = date;
  return newest;
}

/** Le `package.json` le plus proche en remontant depuis `dir`, ou `null`. */
async function findNearestManifest(
  dir: string,
): Promise<Record<string, unknown> | null> {
  for (let current = path.resolve(dir); ;) {
    const manifest = await readJsonObject(path.join(current, "package.json"));
    if (manifest !== null) return manifest;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Version du paquet `name` tel que Node le résoudrait depuis `dir` : premier
 * `node_modules/<name>/package.json` trouvé en remontant.
 */
async function resolveInstalledVersion(
  dir: string,
  name: string,
): Promise<string | null> {
  for (let current = path.resolve(dir); ;) {
    const manifest = await readJsonObject(
      path.join(current, "node_modules", ...name.split("/"), "package.json"),
    );
    if (manifest !== null) {
      return typeof manifest.version === "string" ? manifest.version : null;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Un fichier JSON dont la racine est un objet, ou `null`. */
async function readJsonObject(
  file: string,
): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function fingerprintPath(outDir: string): string {
  return path.join(outDir, ".vite", BUILD_FINGERPRINT_FILE);
}

function isFrameworkPackage(name: string): boolean {
  return name === "nodefony" || name.startsWith("@nodefony/");
}

function frameworkVersion(fingerprint: BuildFingerprint): string | undefined {
  return fingerprint[FRAMEWORK_PACKAGE] ?? fingerprint.nodefony;
}
