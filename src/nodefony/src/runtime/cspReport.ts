/**
 * Rapports de violation de la politique de sécurité du contenu (CSP) — le
 * contrat partagé par ceux qui les DEMANDENT (`@nodefony/security` compose
 * `report-uri`, `report-to` et `Reporting-Endpoints`), ceux qui les REÇOIVENT
 * (la route publique montée par `@nodefony/framework`) et ceux qui les LISENT
 * (plan d'administration, console Studio). ADR-0024 §C7.
 *
 * @module
 */

/**
 * Chemin où le navigateur poste ses rapports de violation. Relatif : le
 * navigateur le résout contre l'URL du document, l'application n'a donc pas à
 * connaître son origine publique.
 */
export const CSP_REPORT_PATH = "/nodefony/security/api/csp-report";

/** Nom du groupe désigné par `report-to` et déclaré par `Reporting-Endpoints`. */
export const CSP_REPORT_GROUP = "nodefony-csp";

/**
 * Plafond d'un corps de rapport, en octets réels du flux. Un rapport fait
 * quelques centaines d'octets ; la politique d'origine qu'il recopie est le
 * gros de son poids.
 */
export const CSP_REPORT_MAX_BYTES = 8 * 1024;

/**
 * Une violation reçue, expurgée et dédoublonnée. Chaque champ texte vient du
 * NAVIGATEUR — donc potentiellement d'un attaquant qui poste à la main : il
 * s'affiche comme du texte, jamais comme du balisage. L'extrait de code
 * (`sample`) n'est jamais gardé.
 */
export interface ICspViolation {
  /** Document qui a subi la violation, sans requête ni fragment. */
  readonly documentURL: string;
  /**
   * Ressource bloquée, sans requête ni fragment — ou un mot-clé de la norme
   * (`inline`, `eval`, `wasm-eval`, `trusted-types-sink`…), ou le seul schéma
   * pour une URL qui n'est pas HTTP(S) (`data`, `blob`).
   */
  readonly blockedURL: string | null;
  /** Directive appliquée (`script-src-elem`, `img-src`…). */
  readonly effectiveDirective: string;
  /** `enforce` : bloqué ; `report` : signalé seulement (politique `Report-Only`). */
  readonly disposition: "enforce" | "report";
  /** Fichier où la violation est née, sans requête ni fragment. */
  readonly sourceFile: string | null;
  readonly lineNumber: number | null;
  readonly columnNumber: number | null;
  /** Statut HTTP du document. */
  readonly statusCode: number | null;
  /** Navigateur qui a rapporté (en-tête `User-Agent`, tronqué). */
  readonly userAgent: string | null;
  /** Nombre de fois que cette même violation a été rapportée. */
  readonly count: number;
  /** Première et dernière réception, en ms depuis l'epoch. */
  readonly firstSeen: number;
  readonly lastSeen: number;
}

/** Ce que rend la lecture des rapports (`GET /nodefony/security/api/csp-reports`). */
export interface ICspReportsSnapshot {
  /** `false` : l'application ne collecte pas (désactivé, ou collecteur tiers). */
  readonly enabled: boolean;
  /** URL que la politique désigne, `null` si aucun rapport n'est demandé. */
  readonly endpoint: string | null;
  /** Violations distinctes gardées au plus ; la moins récemment vue part d'abord. */
  readonly capacity: number;
  /** Rapports reçus depuis le démarrage, gardés ou non. */
  readonly received: number;
  /** Rapports écartés : quota dépassé, type de contenu ou forme refusés. */
  readonly rejected: number;
  /** Violations distinctes, la plus récemment vue d'abord. */
  readonly items: readonly ICspViolation[];
}
