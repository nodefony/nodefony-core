import { realpathSync } from "node:fs";
import path from "node:path";

/**
 * À qui une page de documentation s'adresse : `user` (qui se sert de Nodefony),
 * `core` (qui développe le framework, dans son dépôt), `none` (personne — elle
 * reste dans git, nulle part ailleurs).
 */
export type DocScope = "user" | "core" | "none";

/**
 * Lit la clé de frontmatter `publish` d'une page de documentation.
 *
 * La forme booléenne historique reste comprise : `true` publie (`user`),
 * `false` retire du public (`core`). Une valeur absente ou inconnue rend
 * `null` — c'est alors le CONTEXTE (dossier de la page) qui décide.
 *
 * @param publish - valeur brute de la clé, telle que le frontmatter la rend.
 * @returns la portée déclarée, ou `null` si la page n'en déclare aucune.
 */
export function readDocScope(publish: unknown): DocScope | null {
  if (publish === true || publish === "true" || publish === "user")
    return "user";
  if (publish === false || publish === "false" || publish === "core")
    return "core";
  if (publish === "none") return "none";
  return null;
}

/**
 * Une page de cette portée se montre-t-elle dans ce décor ?
 *
 * `none` n'est montrée nulle part ; `core` seulement dans le dépôt du
 * framework ; `user` et une page sans portée déclarée, partout.
 *
 * @param scope - portée lue par {@link readDocScope}.
 * @param frameworkRepository - le décor est-il le dépôt du framework
 *   (cf {@link isFrameworkRepository}) ?
 * @returns `true` si la page doit être servie.
 */
export function isDocVisible(
  scope: DocScope | null,
  frameworkRepository: boolean,
): boolean {
  if (scope === "none") return false;
  if (scope === "core") return frameworkRepository;
  return true;
}

/**
 * Cette racine est-elle le dépôt du framework lui-même ?
 *
 * Le fait se CONSTATE : le paquet `nodefony` que résout le projet est une
 * SOURCE du projet (son chemin réel tombe dans la racine, hors de tout
 * `node_modules`). Une application installée le reçoit dans `node_modules` ;
 * une application liée à un checkout (`--link`) le trouve hors de sa racine.
 * Un monorepo d'application à paquets scopés n'est donc PAS confondu avec le
 * dépôt du framework — ce que la forme du `workspaces` ne distingue pas.
 *
 * @param projectRoot - racine du projet (celle qui porte `node_modules`).
 * @returns `true` dans le dépôt du framework, `false` partout ailleurs —
 *   y compris quand `nodefony` n'est pas résolu.
 */
export function isFrameworkRepository(projectRoot: string): boolean {
  let real: string;
  let root: string;
  try {
    real = realpathSync.native(
      path.join(projectRoot, "node_modules", "nodefony"),
    );
    root = realpathSync.native(projectRoot);
  } catch {
    return false;
  }
  const rel = path.relative(root, real);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  return !rel.split(path.sep).includes("node_modules");
}
