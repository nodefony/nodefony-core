/**
 * Le profil d'une requête, tel qu'il voyage — UNE définition des deux côtés du
 * fil. `@nodefony/http` le collecte et le sert (`/nodefony/profiler/api/*`), la
 * barre de débogage et la console d'administration le lisent. Types purs : zéro
 * octet à l'exécution, et plus de copie qui dérive (la barre en avait perdu
 * `security`, `seq` et `startMs`).
 */

/** Une phase du pipeline, projetée pour le transport (durée résolue). */
export interface IProfilePhase {
  name: string;
  /** Début relatif `performance.now()` (ms) — sert au calcul du waterfall. */
  startMs: number;
  /** Durée en ms, `null` si la phase ne s'est pas terminée (erreur). */
  durationMs: number | null;
}

/**
 * Une requête SQL/NoSQL exécutée pendant la requête : les adaptateurs ORM la
 * poussent dans le tampon de la requête (`RequestContext.pushQuery`), que le
 * profileur relit au teardown. Absent hors développement, et quand aucun
 * adaptateur n'a rien poussé.
 */
export interface IProfileQuery {
  /** Requête (SQL ou commande NoSQL), tronquée si volumineuse. */
  sql: string;
  /** Début relatif (`performance.now()`) — même horloge que les phases. */
  startMs?: number | undefined;
  /** Durée d'exécution en ms. */
  durationMs: number;
  /** Lignes affectées/retournées, si connu. */
  rows?: number | undefined;
  /** Connecteur émetteur (`drizzle`, `mongoose`…). */
  connector?: string | undefined;
}

/**
 * Traversée du firewall par cette requête — **ce qui était possible** (la zone :
 * son nom, si elle est protégée, quels authenticators elle accepte) croisé avec
 * **ce qui s'est passé** (quel maillon a résolu l'identité, l'issue, le motif
 * d'un refus). Une requête qui PASSE n'émet aucun événement d'audit : sans ce
 * relevé, elle serait invisible côté sécurité.
 */
export interface IProfileSecurity {
  /** Nom de la zone traversée. */
  zone: string | null;
  /** La zone exige-t-elle une identité (`security: true`) ? */
  protected: boolean;
  /** Chaîne d'authenticators : `first` = le premier qui supporte, `all` = MFA. */
  mode: string | null;
  /** Authenticators que la zone accepte (ce qui était POSSIBLE). */
  candidates: string[];
  /** Authenticator qui a RÉELLEMENT résolu l'identité. */
  authenticator: string | null;
  /** `granted` · `anonymous` · `denied` · `failure` · `throttled` · `bypass` · `public`. */
  outcome: string | null;
  /** Motif du refus (`no_credentials`, `invalid_credentials`…). */
  reason: string | null;
  /** Rôles du token résolu (l'axe autorisation). */
  roles: string[] | null;
}

/** Profil complet d'une requête (HTTP ou frame WS), servi par `/{requestId}`. */
export interface IProfileEntry {
  requestId: string;
  /**
   * Numéro d'ordre de collecte, croissant sur la vie du profileur. Un profil
   * réinséré (identifiant réutilisé) reçoit un numéro neuf.
   */
  seq: number;
  /** Horodatage de la collecte (`Date.now()`), pour le tri client. */
  ts: number;
  kind: "http" | "ws";
  method: string | null;
  url: string;
  scheme: string;
  status: number | null;
  /** Durée totale serveur (ms), dérivée des phases. */
  durationMs: number | null;
  route: string | null;
  controller: string | null;
  action: string | null;
  remoteAddress: string | null;
  /** Identité (username) si le firewall l'a injectée, sinon `null`. */
  user: string | null;
  /** `traceparent` W3C Trace Context — corrélation distribuée. */
  traceparent: string | null;
  error: string | null;
  phases: IProfilePhase[];
  /** Requêtes ORM mesurées — `undefined` quand aucun adaptateur n'a poussé. */
  queries?: IProfileQuery[] | undefined;
  /** Traversée du firewall — `undefined` si la requête n'a croisé aucune zone. */
  security?: IProfileSecurity | undefined;
}

/** Résumé léger d'un profil pour la liste `recent` (sans les phases). */
export interface IProfileSummary {
  requestId: string;
  ts: number;
  kind: "http" | "ws";
  method: string | null;
  url: string;
  status: number | null;
  durationMs: number | null;
  route: string | null;
  error: string | null;
}
