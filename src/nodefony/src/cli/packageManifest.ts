import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Ce qu'un paquet DÉCLARE au framework dans son `package.json`, rubrique
 * `nodefony` — `{ "nodefony": { "contribute": "./dist/…", "configSchema": "./dist/…" } }`.
 *
 * Une déclaration plutôt qu'une devinette : un paquet tiers range ses fichiers
 * comme il veut, et rien ne l'oblige à suivre notre arborescence. Ce qu'il
 * déclare, il s'engage à le livrer ; ce qu'on devinerait, il ne nous l'a jamais
 * promis. Une seule lecture pour tous les champs : `scaffold:sync` et
 * `nodefony env` résolvent la même rubrique avec la même garde.
 */

/** Champ qui déclare la contribution de fichiers (`scaffold:sync`). */
export const CONTRIBUTE_FIELD = "contribute";

/**
 * Champ qui déclare le fichier du SCHÉMA de configuration, lu sans démarrer
 * l'application (`nodefony env`, `.env.example`). Ce fichier exporte
 * {@link CONFIG_SCHEMA_EXPORT} et n'importe que le schéma : il ne doit rien
 * ouvrir ni connecter à l'import.
 */
export const CONFIG_SCHEMA_FIELD = "configSchema";

/** Nom FIXE de la fonction que ce fichier exporte : rend le JSON Schema. */
export const CONFIG_SCHEMA_EXPORT = "configJsonSchema";

/**
 * Le chemin relatif qu'un paquet déclare sous `nodefony.<field>`, ou `null`.
 *
 * @param packageDir - dossier du paquet (celui de son `package.json`).
 * @param field - le champ de la rubrique `nodefony`.
 * @returns la valeur déclarée si c'est une chaîne, sinon `null` (manifeste
 *   absent ou illisible compris : ne rien déclarer n'est pas une erreur).
 */
export function declaredPackageEntry(
  packageDir: string,
  field: string,
): string | null {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(packageDir, "package.json"), "utf8"),
    ) as { nodefony?: Record<string, unknown> };
    const entry = manifest.nodefony?.[field];
    return typeof entry === "string" ? entry : null;
  } catch {
    return null;
  }
}

/**
 * Traduit un chemin relatif en `/` (un chemin qui VOYAGE, déclaré dans un
 * manifeste) vers un chemin natif SOUS `root`, ou lève.
 *
 * @param root - la racine qu'on ne doit pas quitter.
 * @param relative - le chemin déclaré.
 * @returns le chemin absolu natif.
 * @throws Error si le chemin sort de `root` (`..`, absolu) ou désigne la racine.
 */
export function resolveInside(root: string, relative: string): string {
  const absolute = path.resolve(root, ...relative.split("/"));
  const rel = path.relative(root, absolute);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`chemin hors de la racine refusé : ${relative}`);
  }
  return absolute;
}
