/**
 * Bornes de la réception des journaux remontés par un navigateur.
 *
 * Elles vivent dans une interface à part parce qu'elles voyagent : la configuration du
 * module les produit, le hub les porte, et le contrôleur les consomme au handshake pour
 * fabriquer le handler d'une connexion. Le hub n'en DÉCIDE rien — il les transporte,
 * comme il transporte la garde d'origine et le plafond de canaux.
 *
 * Leur présence vaut ouverture du canal : `null` sur le hub = aucun handler entrant
 * déclaré pour `nodefony:syslog:uplink`, donc une frame qui l'invoque est droppée comme
 * n'importe quelle méthode inconnue.
 */
export interface IClientLogsLimits {
  /** Entrées retenues par lot reçu ; le surplus est ignoré. */
  readonly maxEntriesPerBatch: number;
  /** Entrées retenues par fenêtre et par connexion. */
  readonly maxEntriesPerWindow: number;
  /** Durée de la fenêtre de débit, en ms. */
  readonly windowMs: number;
  /** Longueur maximale d'une chaîne acceptée (message, pile). */
  readonly maxStringLength: number;
}
