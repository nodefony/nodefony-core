/**
 * Profiler — collecteur **dev-only** de profils de requête, indexé par `requestId`.
 *
 * Modèle inversé (≠ ancien monitoring-bundle qui splicait du Twig serveur dans
 * le body) : le serveur **collecte** un instantané en fin de requête, le client
 * (debug bar) **rend**. La matière existe déjà dans le `Context` quand le timing
 * est actif (`phases`, `requestId`, `status`, resolver) → `collect()` ne fait
 * que SNAPSHOTTER : aucune allocation per-request hors de cette structure, et
 * **rien** en prod (le module n'instancie pas le Profiler hors dev).
 *
 * Stockage = ring buffer borné via l'ordre d'insertion d'une `Map` : à la
 * capacité, on évince la plus ancienne entrée (première clé). O(1) amorti.
 *
 * Corrélation client↔serveur : le framework renvoie déjà `X-Request-Id` sur
 * chaque réponse → le client lit le header de SON appel AJAX et fetch
 * `/nodefony/profiler/api/{requestId}`. Zéro modif du pipeline.
 *
 * Multi-process : un profil vit sur le worker qui a traité l'appel (fetch même
 * origine par requestId). Agrégat cluster = Redis (P13).
 */

/** Une phase du pipeline, projetée pour le transport (durée résolue). */
export interface ProfilePhase {
  name: string;
  /** Début relatif `performance.now()` (ms) — sert au calcul du waterfall. */
  startMs: number;
  /** Durée en ms, `null` si la phase ne s'est pas terminée (erreur). */
  durationMs: number | null;
}

/**
 * Une requête SQL/NoSQL exécutée pendant la requête HTTP (SEAM ORM — futur).
 *
 * Non collecté aujourd'hui : quand `@nodefony/orm-core` arrivera, les adapters
 * pousseront leurs requêtes dans un buffer per-request dev-only (via l'ALS
 * `RequestContext.getRequestId()`, déjà en place) que `collect()` lira ici.
 * Le champ `queries` reste donc `undefined` tant qu'aucun ORM ne pushe → 0 coût.
 */
export interface ProfileQuery {
  /** Requête (SQL ou commande NoSQL), tronquée si volumineuse. */
  sql: string;
  /** Début relatif (`performance.now()`) — même horloge que les phases. */
  startMs?: number;
  /** Durée d'exécution en ms. */
  durationMs: number;
  /** Lignes affectées/retournées, si connu. */
  rows?: number;
  /** Connecteur émetteur (`drizzle`, `mongoose`…). */
  connector?: string;
}

/**
 * Traversée du firewall par cette requête — **ce qui était possible** (la zone :
 * son nom, si elle est protégée, quels authenticators elle accepte) croisé avec
 * **ce qui s'est passé** (quel maillon a résolu l'identité, l'issue, le motif
 * d'un refus).
 *
 * Sans cela, une requête qui PASSE est invisible côté sécurité : le chemin de
 * succès n'émet aucun événement d'audit (choix délibéré — le volume nominal
 * n'est pas un signal). `undefined` hors zone firewall.
 */
export interface ProfileSecurity {
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

/** Profil complet d'une requête (HTTP ou message WS), exposé par `get`. */
export interface ProfileEntry {
  requestId: string;
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
  /** `traceparent` W3C Trace Context (P2.7) — corrélation distribuée RFC-propre. */
  traceparent: string | null;
  error: string | null;
  phases: ProfilePhase[];
  /** Requêtes ORM (SEAM futur — `undefined` tant qu'aucun adapter ne pushe). */
  queries?: ProfileQuery[];
  /** Traversée du firewall — `undefined` si la requête n'a croisé aucune zone. */
  security?: ProfileSecurity;
}

/** Résumé léger d'un profil pour la liste `recent` (sans les phases). */
export interface ProfileSummary {
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

/** Forme structurelle minimale lue sur un `Context` (lecture défensive). */
interface ProfilableContext {
  requestId?: string;
  type?: string;
  scheme?: string;
  method?: string | null;
  url?: string;
  remoteAddress?: string | null;
  traceparent?: string | null;
  error?: { message?: string } | null;
  response?: { statusCode?: number } | null;
  phases?: ReadonlyArray<{
    name: string;
    startMs: number;
    durationMs?: number;
  }>;
  resolver?: {
    route?: { name?: string } | null;
    controller?: { name?: string } | null;
    actionName?: string;
  } | null;
  /**
   * Buffer de requêtes ORM rempli pendant la requête (dev-only). Même tableau
   * que la payload ALS — les adapters ORM y poussent via `RequestContext`.
   * `null`/absent hors profiling.
   */
  profilerQueries?: ProfileQuery[] | null;
  /**
   * Zone firewall capturée (`SecuredArea`, posée par `Firewall.isSecure`). Lue
   * en structurel : `@nodefony/http` ne peut pas importer `@nodefony/security`.
   */
  security?: {
    name?: string;
    security?: boolean;
    mode?: string;
    authenticators?: readonly string[];
  } | null;
  /** Décision du firewall sur cette requête (dev-only, cf `ISecurityTrace`). */
  securityTrace?: {
    authenticator: string | null;
    outcome: string;
    reason: string | null;
    user: string | null;
    roles: string[] | null;
  } | null;
}

/** Durée totale = (fin de la dernière phase terminée) − (début de la 1ère). */
function totalDuration(
  phases: ReadonlyArray<{ startMs: number; durationMs?: number }>,
): number | null {
  if (phases.length === 0) return null;
  const first = phases[0];
  if (typeof first.startMs !== "number") return null;
  let end = first.startMs;
  for (const p of phases) {
    const e = p.startMs + (p.durationMs ?? 0);
    if (e > end) end = e;
  }
  const d = end - first.startMs;
  return d >= 0 ? Math.round(d * 1000) / 1000 : null;
}

/** Capacité par défaut du ring buffer (assez pour une session de debug). */
const DEFAULT_CAP = 500;

export class Profiler {
  private readonly _buf = new Map<string, ProfileEntry>();
  private readonly _cap: number;

  constructor(cap: number = DEFAULT_CAP) {
    this._cap = cap > 0 ? cap : DEFAULT_CAP;
  }

  /**
   * Snapshot un `Context` en fin de requête. Tolérant aux champs absents
   * (handshake WS, erreur précoce). À appeler AVANT `context.clean()`.
   *
   * @param ctx - le Context HTTP/WS terminé (lu en structurel, jamais muté).
   */
  collect(ctx: ProfilableContext): void {
    const requestId = ctx.requestId;
    if (!requestId) return;
    const phases = ctx.phases ?? [];
    const entry: ProfileEntry = {
      requestId,
      ts: Date.now(),
      kind:
        ctx.type === "websocket" || ctx.type === "websocket-secure"
          ? "ws"
          : "http",
      method: ctx.method ?? null,
      url: ctx.url ?? "",
      scheme: ctx.scheme ?? "",
      status: ctx.response?.statusCode ?? (ctx.error ? 500 : null),
      durationMs: totalDuration(phases),
      route: ctx.resolver?.route?.name ?? null,
      controller: ctx.resolver?.controller?.name ?? null,
      action: ctx.resolver?.actionName ?? null,
      remoteAddress: ctx.remoteAddress ?? null,
      user: readUser(ctx),
      traceparent: ctx.traceparent ?? null,
      error: ctx.error?.message ?? null,
      phases: phases.map((p) => ({
        name: p.name,
        startMs: p.startMs,
        durationMs: p.durationMs ?? null,
      })),
      // SEAM ORM — `undefined` tant qu'aucun adapter n'a poussé (contrat
      // historique préservé : pas de tableau vide qui ferait apparaître un
      // onglet « Queries » vide côté client).
      queries:
        ctx.profilerQueries && ctx.profilerQueries.length > 0
          ? ctx.profilerQueries
          : undefined,
      security: readSecurity(ctx),
    };
    // Ré-insertion = la clé repasse en queue (entrée la plus récente).
    this._buf.delete(requestId);
    this._buf.set(requestId, entry);
    if (this._buf.size > this._cap) {
      const oldest = this._buf.keys().next().value;
      if (oldest !== undefined) this._buf.delete(oldest);
    }
  }

  /** Profil complet d'une requête, ou `undefined` si évincé/inconnu. */
  get(requestId: string): ProfileEntry | undefined {
    return this._buf.get(requestId);
  }

  /**
   * Résumés des requêtes les plus récentes (récent → ancien), capés à `limit`.
   */
  recent(limit = 60): ProfileSummary[] {
    const out: ProfileSummary[] = [];
    const entries = [...this._buf.values()];
    for (let i = entries.length - 1; i >= 0 && out.length < limit; i--) {
      const e = entries[i]!;
      out.push({
        requestId: e.requestId,
        ts: e.ts,
        kind: e.kind,
        method: e.method,
        url: e.url,
        status: e.status,
        durationMs: e.durationMs,
        route: e.route,
        error: e.error,
      });
    }
    return out;
  }

  /** Nombre de profils en mémoire. */
  get size(): number {
    return this._buf.size;
  }

  /** Vide le ring buffer. */
  clear(): void {
    this._buf.clear();
  }
}

/**
 * Croise la ZONE (ce qui était possible) et la TRACE (ce qui s'est passé).
 *
 * Hors zone firewall → `undefined` (pas de section « Sécurité » vide côté
 * client). Zone publique traversée sans trace → `outcome: "public"` : la
 * requête a bien croisé une zone, qui n'exigeait simplement rien.
 */
function readSecurity(ctx: ProfilableContext): ProfileSecurity | undefined {
  const area = ctx.security;
  if (!area) return undefined;
  const t = ctx.securityTrace ?? null;
  const isProtected = area.security === true;
  return {
    zone: area.name ?? null,
    protected: isProtected,
    mode: area.mode ?? null,
    candidates: area.authenticators ? [...area.authenticators] : [],
    authenticator: t?.authenticator ?? null,
    outcome: t?.outcome ?? (isProtected ? null : "public"),
    reason: t?.reason ?? null,
    roles: t?.roles ?? null,
  };
}

/**
 * Identité de la requête.
 *
 * `context.user` n'est PAS la source de vérité en zone firewall : le token
 * résolu vit dans l'ALS (`RequestContext`), qui n'est plus lisible au teardown
 * où `collect()` s'exécute. Sans le repli sur la trace, une requête pleinement
 * authentifiée (rôles compris) s'afficherait « anonyme ».
 */
function readUser(ctx: ProfilableContext): string | null {
  const u = (ctx as { user?: unknown }).user;
  if (u && typeof u === "object") {
    const username = (u as { username?: unknown }).username;
    if (typeof username === "string") return username;
  }
  return ctx.securityTrace?.user ?? null;
}

export default Profiler;
