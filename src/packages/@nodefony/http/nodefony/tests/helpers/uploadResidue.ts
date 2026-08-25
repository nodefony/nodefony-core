import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Racine du dépôt, depuis `nodefony/tests/helpers/` du paquet `@nodefony/http`.
 */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../..",
);

/**
 * Dossiers où un fichier reçu en multipart peut atterrir pendant une suite.
 *
 * Il y en a DEUX, et viser le mauvais est un nettoyage qui n'en est pas un :
 * le défaut du framework résout `upload.uploadDir` vide sur `kernel.tmpDir`
 * (soit `tmp/`), tandis que l'application de ce dépôt le pose explicitement à
 * `./tmp/upload` (`nodefony.config.ts`). Les suites tournent contre CETTE
 * application — un garde écrit sur le défaut ne supprimait donc rien, et
 * 4 420 fichiers s'y étaient accumulés sans qu'aucun test ne s'en aperçoive.
 */
export const UPLOAD_DIRS: readonly string[] = [
  path.join(REPO_ROOT, "tmp"),
  path.join(REPO_ROOT, "tmp", "upload"),
];

/** Photo d'un dossier avant la suite : nom de fichier → présent avant. */
export type UploadSnapshot = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Photographie les dossiers de dépôt AVANT la suite, pour ne supprimer ensuite
 * que ce qu'elle aura créé.
 *
 * @param dirs - dossiers à photographier (défaut : {@link UPLOAD_DIRS})
 * @returns la photo à passer à {@link purgeUploadResidue}
 */
export async function snapshotUploadDirs(
  dirs: readonly string[] = UPLOAD_DIRS,
): Promise<UploadSnapshot> {
  const snap = new Map<string, ReadonlySet<string>>();
  for (const dir of dirs) {
    snap.set(dir, new Set(await fsp.readdir(dir).catch(() => [])));
  }
  return snap;
}

/**
 * Supprime les fichiers apparus depuis la photo, et rend leur NOMBRE.
 *
 * Le compte est la seule chose qui rende ce garde vérifiable : une suite qui
 * dépose des fichiers et obtient `0` vise un dossier qui n'est pas celui où le
 * serveur écrit. C'est l'assertion, pas le `unlink`, qui empêche le résidu de
 * revenir en silence.
 *
 * @param snapshot - photo rendue par {@link snapshotUploadDirs}
 * @returns nombre de fichiers effectivement supprimés
 */
export async function purgeUploadResidue(
  snapshot: UploadSnapshot,
): Promise<number> {
  let removed = 0;
  for (const [dir, before] of snapshot) {
    const entries = await fsp
      .readdir(dir, { withFileTypes: true })
      .catch(() => [] as import("node:fs").Dirent[]);
    for (const entry of entries) {
      if (!entry.isFile() || before.has(entry.name)) continue;
      const ok = await fsp
        .unlink(path.join(dir, entry.name))
        .then(() => true)
        .catch(() => false);
      if (ok) removed++;
    }
  }
  return removed;
}
