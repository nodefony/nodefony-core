import type { IProfilerQuery } from "nodefony";
import type {
  ISecurityTrace,
  PhaseName,
  PhaseTiming,
} from "../../interfaces/IContext.js";

/**
 * Zone firewall capturée sur le contexte (`SecuredArea`, lue en structurel :
 * `@nodefony/http` ne peut pas importer `@nodefony/security`).
 */
export interface ProfiledArea {
  name?: string;
  security?: boolean;
  mode?: string;
  authenticators?: readonly string[];
}

/** Ce que le Profiler lit d'un Resolver (route/controller/action). */
export interface ProfiledResolver {
  route?: { name?: string } | null;
  controller?: { name?: string } | null;
  actionName?: string;
}

/** Descripteur d'ouverture d'une invocation (ce que le pont connaît d'entrée). */
export interface FrameProfileInit {
  /** Identifiant du profil — `<requestId de la connexion>.<n° de frame>`. */
  requestId: string;
  /** Type de transport du contexte porteur (`websocket` / `websocket-secure`). */
  type: string;
  scheme: string;
  /** Méthode LOGIQUE de l'invocation (`GET`, `POST`…), pas le transport. */
  method: string;
  /** Chemin invoqué par la frame (avec sa query), pas l'URL de la connexion. */
  url: string;
  remoteAddress: string | null;
  traceparent: string | null;
  /** Zone firewall de la connexion (l'identité de la frame en découle). */
  security: ProfiledArea | null;
  /** Décision du firewall au handshake — l'identité que la frame rejoue. */
  securityTrace: ISecurityTrace | null;
  /** Mesurer les phases ? (`timing.enabled` du contexte porteur.) */
  timing: boolean;
  /** Collecter le SQL ? (profiler dev présent → buffer ORM alloué.) */
  queries: boolean;
}

/**
 * Profil d'**une invocation** du pont RPC (une frame `api.request`), et non de
 * la connexion qui la porte.
 *
 * Pourquoi un objet séparé du `Context` : un `WebsocketContext` vit pour toute
 * la **connexion**, alors qu'une socket peut porter des centaines d'invocations,
 * concurrentes de surcroît. Empiler leurs phases sur le contexte produirait une
 * timeline **cumulative** (donc fausse) et ferait croître `Context.phases` sans
 * borne. Le profil naît et meurt donc avec la frame ; il voyage dans l'ALS
 * (`RequestContext.payload.invocation`), seul canal déjà per-invocation traversé
 * par le Resolver, le controller et les adapters ORM.
 *
 * Il satisfait **structurellement** ce que `Profiler.collect()` lit d'un
 * contexte : aucune connaissance du transport n'est requise côté Profiler, un
 * profil de frame s'y collecte comme une requête HTTP (`kind: "ws"`).
 *
 * Coût : **rien n'est alloué** quand le profiler dev est absent ET le timing
 * éteint (production) — le pont n'ouvre alors aucun profil.
 */
export class FrameProfile {
  readonly requestId: string;
  readonly type: string;
  readonly scheme: string;
  readonly method: string;
  readonly url: string;
  readonly remoteAddress: string | null;
  readonly traceparent: string | null;
  readonly security: ProfiledArea | null;
  readonly securityTrace: ISecurityTrace | null;

  /** Phases de CETTE frame (vide si le timing est éteint). */
  readonly phases: PhaseTiming[] = [];
  /**
   * Buffer ORM de CETTE frame — `null` hors profiling. C'est ce buffer que le
   * kernel refusait d'allouer au handshake (il aurait cumulé N messages) : par
   * invocation, il redevient exact, et le SQL se replace dans le waterfall.
   */
  readonly profilerQueries: IProfilerQuery[] | null;

  /** Resolver de la frame — porte route / controller / action. */
  resolver: ProfiledResolver | null = null;
  /** Statut HTTP-équivalent de l'invocation (200, 403, 404…). */
  response: { statusCode: number } | null = null;
  error: { message: string } | null = null;

  private readonly timing: boolean;

  constructor(init: FrameProfileInit) {
    this.requestId = init.requestId;
    this.type = init.type;
    this.scheme = init.scheme;
    this.method = init.method;
    this.url = init.url;
    this.remoteAddress = init.remoteAddress;
    this.traceparent = init.traceparent;
    this.security = init.security;
    this.securityTrace = init.securityTrace;
    this.timing = init.timing;
    this.profilerQueries = init.queries ? [] : null;
  }

  /**
   * Ouvre une phase. Contrairement au `Context`, l'index est un **scan arrière**
   * (pas de `Map<nom, index>`) : une frame porte une poignée de phases, et une
   * phase peut être ré-entrante (une action qui en déclenche une autre) — la
   * table par nom, elle, écraserait la première occurrence.
   */
  phaseStart(name: PhaseName): void {
    if (!this.timing) return;
    this.phases.push({ name, startMs: performance.now() });
  }

  /** Ferme la DERNIÈRE phase ouverte de ce nom (idempotent). */
  phaseEnd(name: PhaseName): void {
    if (!this.timing) return;
    for (let i = this.phases.length - 1; i >= 0; i--) {
      const p = this.phases[i];
      if (p.name === name && p.endMs === undefined) {
        p.endMs = performance.now();
        p.durationMs = p.endMs - p.startMs;
        return;
      }
    }
  }

  /**
   * Fige l'issue de l'invocation (statut + erreur éventuelle) avant collecte.
   *
   * @param status - statut HTTP-équivalent (200 ; 403/404/409… pour un refus).
   * @param error - l'erreur qui a interrompu la frame, le cas échéant.
   */
  finish(status: number, error?: unknown): void {
    this.response = { statusCode: status };
    if (error !== undefined && error !== null) {
      this.error = {
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export default FrameProfile;
