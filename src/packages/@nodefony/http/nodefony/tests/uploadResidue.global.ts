/**
 * Garde de passe des fichiers reçus en upload — ce qu'une suite poste au serveur
 * réel, elle le retire.
 *
 * Le serveur de dev dépose chaque fichier multipart dans `tmp/upload/` (ou
 * `tmp/`) ; seules deux suites purgeaient leur dépôt. Mesuré : 68 801 fichiers
 * accumulés, des milliers de `.txt` d'un octet écrits en une matinée de tests.
 *
 * Photo des dossiers de dépôt avant la passe ; au teardown, les fichiers neufs
 * sont NOMMÉS, supprimés, et la passe échoue — la règle tient pour toute suite
 * de la config, y compris celle qu'on écrira demain.
 *
 * @usage globalSetup: tmpGuard(r("./nodefony/tests/uploadResidue.global.ts"))
 */
import {
  listUploadResidue,
  purgeUploadResidue,
  snapshotUploadDirs,
} from "./helpers/uploadResidue.js";

/**
 * Photographie les dossiers de dépôt et rend le teardown qui contrôle la passe.
 *
 * @returns le teardown : nomme, purge, et lève s'il restait des fichiers.
 * @throws Error au teardown, quand une suite a laissé un fichier reçu en upload.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const snapshot = await snapshotUploadDirs();
  return async () => {
    const left = await listUploadResidue(snapshot);
    if (left.length === 0) return;
    await purgeUploadResidue(snapshot);
    throw new Error(
      `${left.length} fichier(s) reçu(s) en upload laissé(s) par la passe — ` +
        `une suite poste sans purger (snapshotUploadDirs / purgeUploadResidue) :\n` +
        left
          .slice(0, 20)
          .map((f) => `  - ${f}`)
          .join("\n") +
        (left.length > 20 ? `\n  … et ${left.length - 20} autre(s)` : ""),
    );
  };
}
