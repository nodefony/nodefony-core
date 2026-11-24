import os from "node:os";

/**
 * Répertoire courant des hôtes de fixture — HORS du dépôt.
 *
 * `nodefony stop` rattache à un projet tout hôte porté qui travaille SOUS sa
 * racine (`devProcess.ts#splitByProject`). Un hôte de test posé dans le dépôt
 * était donc abattu par le `stop` qu'un autre fichier lance depuis la racine
 * (`CliIntegration.test.ts`, filet `NF_RUN_CLI_BOOT=1`) : vécu sur la forge, le
 * test d'arrêt forcé trouvait mort l'hôte qu'il attendait figé. Seule source de
 * cette règle pour tous les bancs d'hôtes portés.
 */
export const HELD_HOST_CWD = os.tmpdir();
