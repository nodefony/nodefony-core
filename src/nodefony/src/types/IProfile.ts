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

// — Rapport agrégé des profils (`aggregateProfiles`, @nodefony/http) —

/** Répartition des statuts HTTP d'une route. */
export interface IStatusBreakdown {
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
  /** Dont 401 : la route exige une authentification que la requête n'avait pas. */
  unauthorized: number;
  /** Dont 403 : authentifiée, mais refusée. */
  forbidden: number;
}

/** Temps cumulé d'une phase sur les requêtes d'une route. */
export interface IPhaseTotal {
  totalMs: number;
  /** Requêtes où la phase est apparue et s'est terminée. */
  count: number;
}

/** Statistiques d'une route sur la fenêtre agrégée. */
export interface IRouteStats {
  route: string;
  kind: "http" | "ws";
  controller: string | null;
  action: string | null;
  count: number;
  /** Requêtes sans durée mesurée (mesure des phases désactivée, erreur précoce). */
  untimed: number;
  /**
   * Requêtes SERVIES et chronométrées (statut < 400, sans exception) : la
   * population de tout ce qui se dit « par requête » ci-dessous. Refus et
   * erreurs se lisent dans `status` et `errors`.
   */
  served: number;
  /** Percentiles et maximum, sur les requêtes servies. */
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  status: IStatusBreakdown;
  /** Requêtes en erreur : statut ≥ 500 ou exception levée. */
  errors: number;
  /**
   * Requêtes SQL/NoSQL des requêtes servies : total, maximum dans une
   * requête, temps CUMULÉ (des requêtes parallèles s'y additionnent).
   */
  queries: { total: number; perRequestMax: number; totalMs: number };
  /** Temps par phase des requêtes servies, `action.self` compris. */
  phases: Record<string, IPhaseTotal>;
}

/** Un N+1 : la même forme SQL répétée dans une requête. */
export interface INPlusOne {
  route: string;
  controller: string | null;
  action: string | null;
  shape: string;
  /** Plus grand nombre de répétitions vu dans une requête. */
  maxRepeats: number;
  /** Requêtes touchées. */
  requests: number;
  /** Temps cumulé de ces répétitions. */
  totalMs: number;
  /** Une requête touchée, pour aller voir son profil complet. */
  sampleRequestId: string;
}

/** Une forme SQL et son coût sur la fenêtre. */
export interface ISqlShapeStats {
  shape: string;
  connector: string | null;
  count: number;
  totalMs: number;
  maxMs: number;
  /** Routes qui l'ont émise (au plus cinq). */
  routes: string[];
}

/** Un exemple d'erreur, de quoi la retrouver dans le journal. */
export interface IErrorSample {
  route: string;
  status: number | null;
  error: string | null;
  requestId: string;
}

/** Le rapport agrégé. */
export interface IProfileReport {
  /** Requêtes agrégées (hors outillage filtré). */
  requests: number;
  http: number;
  ws: number;
  /** Requêtes de l'outillage écartées (`/nodefony/…`, `/_vite/…`). */
  filteredTooling: number;
  /** Requêtes sans durée mesurée. */
  untimed: number;
  /** Triées par p95 décroissant. */
  routes: IRouteStats[];
  /** Triés par temps cumulé décroissant. */
  nPlusOne: INPlusOne[];
  /** Les dix formes SQL les plus coûteuses (temps cumulé décroissant). */
  slowQueries: ISqlShapeStats[];
  /** Formes SQL distinctes vues au-delà de la capacité, comptées sans détail. */
  sqlShapesDropped: number;
  errors: IErrorSample[];
}
