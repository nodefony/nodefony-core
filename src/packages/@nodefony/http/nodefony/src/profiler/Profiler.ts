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

import type { ProfiledResolver } from "./FrameProfile.js";
import type { ProtocolName } from "../../interfaces/IContext.js";
import { frameIndexOf } from "nodefony";
import type {
  IProfileEntry,
  IProfilePhase,
  IProfileQuery,
  IProfileSecurity,
  IProfileSummary,
} from "nodefony";
import { profileLane, type ProfileLane } from "./aggregate.js";

// Les types du profil vivent au cœur (`nodefony`, `types/IProfile.ts`) : UNE
// définition pour le serveur, la barre de débogage et la console. Les noms
// publiés par ce paquet restent, en alias.
export type ProfilePhase = IProfilePhase;
export type ProfileQuery = IProfileQuery;
export type ProfileSecurity = IProfileSecurity;
export type ProfileEntry = IProfileEntry;
export type ProfileSummary = IProfileSummary;

/** Forme structurelle minimale lue sur un `Context` (lecture défensive). */
interface ProfilableContext {
  requestId?: string | undefined;
  userIdentifier?: string | null | undefined;
  type?: ProtocolName | undefined;
  scheme?: string | undefined;
  method?: string | null | undefined;
  url?: string | undefined;
  remoteAddress?: string | null | undefined;
  traceparent?: string | null | undefined;
  error?: { message?: string } | null | undefined;
  response?: { statusCode?: number } | null | undefined;
  phases?:
    | ReadonlyArray<{
        name: string;
        startMs: number;
        durationMs?: number | undefined;
      }>
    | undefined;
  resolver?: ProfiledResolver | null | undefined;
  /**
   * Buffer de requêtes ORM rempli pendant la requête (dev-only). Même tableau
   * que la payload ALS — les adapters ORM y poussent via `RequestContext`.
   * `null`/absent hors profiling.
   */
  profilerQueries?: ProfileQuery[] | null | undefined;
  /**
   * Zone firewall capturée (`SecuredArea`, posée par `Firewall.isSecure`). Lue
   * en structurel : `@nodefony/http` ne peut pas importer `@nodefony/security`.
   */
  security?:
    | {
        name?: string | undefined;
        security?: boolean | undefined;
        mode?: string | undefined;
        authenticators?: readonly string[] | undefined;
      }
    | null
    | undefined;
  /** Décision du firewall sur cette requête (dev-only, cf `ISecurityTrace`). */
  securityTrace?:
    | {
        authenticator: string | null;
        outcome: string;
        reason: string | null;
        user: string | null;
        roles: string[] | null;
      }
    | null
    | undefined;
}

/**
 * Durée totale = (fin de la dernière phase) − (début de la 1ère).
 *
 * Une phase encore OUVERTE à la collecte (action interrompue par le départ du
 * client : flux SSE, outil MCP annulé) court jusqu'à la collecte — la compter
 * pour zéro publiait 0,3 ms pour un appel coupé à 3 s.
 */
function totalDuration(
  phases: ReadonlyArray<{ startMs: number; durationMs?: number | undefined }>,
): number | null {
  if (phases.length === 0) return null;
  const first = phases.at(0);
  if (first === undefined || typeof first.startMs !== "number") return null;
  let end = first.startMs;
  let now: number | null = null;
  for (const p of phases) {
    const e =
      p.durationMs === undefined
        ? (now ??= performance.now())
        : p.startMs + p.durationMs;
    if (e > end) end = e;
  }
  const d = end - first.startMs;
  return d >= 0 ? Math.round(d * 1000) / 1000 : null;
}

/** Capacité par défaut du ring buffer (assez pour une session de debug). */
const DEFAULT_CAP = 500;

/**
 * Capacité par défaut des deux anneaux annexes : l'OUTILLAGE (console, API
 * d'administration, porte MCP) et les ASSETS relayés de Vite. Un chargement
 * de la console relaie à lui seul quelques centaines de modules : dans un
 * tampon commun, il chassait en quelques secondes les profils de
 * l'application, puis ceux des appels de la console elle-même.
 */
const DEFAULT_SIDE_CAP = 100;

/** Les profils collectés depuis un curseur. */
export interface IProfileBatch {
  /** Profils de numéro supérieur au curseur, du plus ancien au plus récent. */
  entries: ProfileEntry[];
  /** Curseur à repasser au prochain appel : le dernier numéro attribué. */
  cursor: number;
  /**
   * Profils collectés depuis le curseur mais disparus avant d'être lus —
   * évincés par le tampon, ou écrasés par un identifiant réutilisé. Exact.
   */
  lost: number;
}

/**
 * Ce qu'un lecteur extérieur (outil de l'agent de code, banc) attend du
 * profileur : suivre les profils au fil de l'eau, ou en retrouver un par son
 * identifiant. Contrat structurel — on le résout par NOM dans le conteneur
 * (`"profiler"`), sans dépendre de la classe.
 */
export interface IProfilerReader {
  /** Curseur courant : le passer à {@link since} pour ne lire que la suite. */
  readonly cursor: number;
  /** Profils collectés depuis `cursor`, et le compte de ceux qui ont été perdus. */
  since(cursor: number): IProfileBatch;
  /** Profil complet d'une requête, ou `undefined` si évincé/inconnu. */
  get(requestId: string): ProfileEntry | undefined;
}

/**
 * Collecteur des profils de requête, en un anneau par provenance
 * ({@link profileLane}) : l'application, l'outillage, les assets relayés.
 * Chacun évince ses propres profils — ouvrir la console ne chasse plus celui
 * qu'on y consulte.
 */
export class Profiler implements IProfilerReader {
  private readonly _lanes: Record<ProfileLane, Map<string, ProfileEntry>> = {
    app: new Map(),
    tooling: new Map(),
    asset: new Map(),
  };
  private readonly _caps: Record<ProfileLane, number>;
  /** Dernier numéro d'ordre attribué (0 = aucun profil collecté). */
  private _seq = 0;

  /**
   * @param cap - capacité de l'anneau de l'application.
   * @param sideCap - capacité de chacun des anneaux de l'outillage et des
   *          assets relayés.
   */
  constructor(cap: number = DEFAULT_CAP, sideCap: number = DEFAULT_SIDE_CAP) {
    const side = sideCap > 0 ? sideCap : DEFAULT_SIDE_CAP;
    this._caps = {
      app: cap > 0 ? cap : DEFAULT_CAP,
      tooling: side,
      asset: side,
    };
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
      seq: ++this._seq,
      ts: Date.now(),
      kind: ctx.type === "websocket" ? "ws" : "http",
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
    // Un identifiant vit dans UN seul anneau : un `X-Request-Id` réutilisé
    // sur une autre URL change d'anneau sans y laisser de doublon.
    const { app, tooling, asset } = this._lanes;
    app.delete(requestId);
    tooling.delete(requestId);
    asset.delete(requestId);
    const lane = profileLane(entry.url);
    const buf = this._lanes[lane];
    // Ré-insertion = la clé repasse en queue (entrée la plus récente).
    buf.set(requestId, entry);
    if (buf.size > this._caps[lane]) {
      const oldest = buf.keys().next().value;
      if (oldest !== undefined) buf.delete(oldest);
    }
  }

  /** Profil complet d'une requête, ou `undefined` si évincé/inconnu. */
  get(requestId: string): ProfileEntry | undefined {
    const { app, tooling, asset } = this._lanes;
    return app.get(requestId) ?? tooling.get(requestId) ?? asset.get(requestId);
  }

  /**
   * Résumés des requêtes les plus récentes (récent → ancien), capés à `limit`.
   *
   * @param limit - nombre maximal de résumés
   * @param connection - le requestId d'une connexion WebSocket : ses SEULES
   *   frames du pont (`<connection>.<n>`, règle `frameIndexOf` du cœur)
   */
  recent(limit = 60, connection?: string): ProfileSummary[] {
    const out: ProfileSummary[] = [];
    // Les anneaux, remis dans l'ordre de collecte (récent → ancien).
    const entries = this.#collectAfter(0).reverse();
    for (const e of entries) {
      if (out.length >= limit) break;
      if (connection && frameIndexOf(e.requestId, connection) === null)
        continue;
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

  /** Dernier numéro d'ordre attribué : le point de départ d'une lecture suivie. */
  get cursor(): number {
    return this._seq;
  }

  /**
   * Profils collectés après `cursor`, tous anneaux confondus, dans l'ordre
   * des numéros.
   *
   * Les pertes se comptent sans estimation : chaque numéro attribué est un
   * profil collecté, donc ce qui manque entre le curseur et le dernier numéro
   * a disparu avant d'être lu. Un curseur venu d'ailleurs (supérieur au
   * dernier numéro) repart de zéro.
   *
   * @param cursor - le `cursor` rendu par l'appel précédent, ou {@link cursor}.
   */
  since(cursor: number): IProfileBatch {
    const from = cursor >= 0 && cursor <= this._seq ? cursor : 0;
    const entries = this.#collectAfter(from);
    return {
      entries,
      cursor: this._seq,
      lost: this._seq - from - entries.length,
    };
  }

  /** Nombre de profils en mémoire. */
  get size(): number {
    const { app, tooling, asset } = this._lanes;
    return app.size + tooling.size + asset.size;
  }

  /** Vide les anneaux. */
  clear(): void {
    const { app, tooling, asset } = this._lanes;
    app.clear();
    tooling.clear();
    asset.clear();
  }

  /**
   * Profils de numéro supérieur à `from`, tous anneaux confondus, du plus
   * ancien au plus récent. Lecture à la demande (console, outil de l'agent) :
   * jamais sur le chemin d'une requête.
   */
  #collectAfter(from: number): ProfileEntry[] {
    const out: ProfileEntry[] = [];
    for (const lane of Object.values(this._lanes)) {
      for (const e of lane.values()) if (e.seq > from) out.push(e);
    }
    return out.sort((a, b) => a.seq - b.seq);
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
 * Le jeton résolu vit dans l'ALS, qui n'est plus lisible au teardown où
 * `collect()` s'exécute : le pare-feu pose donc l'identifiant de l'appelant
 * authentifié sur `context.userIdentifier` (même source que le journal
 * d'audit). La trace du pare-feu prend le relais pour l'anonyme d'une zone
 * `anonymous`, qu'elle nomme.
 */
function readUser(ctx: ProfilableContext): string | null {
  return ctx.userIdentifier ?? ctx.securityTrace?.user ?? null;
}

export default Profiler;
