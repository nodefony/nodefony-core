/**
 * Intercepteur réseau **dev-only** de la debug bar — capture les appels AJAX
 * (`fetch` + `XMLHttpRequest`) de la page pour le panneau Network, et lit le
 * header `X-Request-Id` de chaque réponse → corrélation avec le profil serveur
 * (`/nodefony/profiler/api/{requestId}`). Il voit aussi naître les flux longue
 * durée — `WebSocket`, `EventSource`, et un `fetch` qui reçoit
 * `text/event-stream` — et ne retient que leur CYCLE (ouverture, fermeture,
 * code, reconnexions) : jamais une trame, ni lue ni comptée, binaire compris.
 *
 * ⚠️ Monkey-patch des globals = intrusif. Donc 6 garde-fous (cf décision design) :
 *  1. **dev-only** : n'est installé que par la debug bar, jamais en prod.
 *  2. **défensif** : toute la collecte est en try/catch — un bug ici ne casse
 *     JAMAIS la requête de l'app (on relaie toujours l'appel original).
 *  3. **header-only** : on ne touche jamais au body (pas de `.clone()`, pas de
 *     lecture du stream) → 0 risque de consommer/altérer la réponse. Un flux
 *     lu par `fetch` se sait fermé par son SEUL signal d'abandon : lire son
 *     corps en parallèle (`tee`) garderait la connexion ouverte quand
 *     l'application, elle, l'abandonne.
 *  4. **réversible** : `uninstall()` restaure les implémentations d'origine.
 *  5. **chain-safe** : on wrappe le `fetch`/XHR COURANT (déjà potentiellement
 *     patché par une autre lib), on ne clobber pas — l'uninstall ne restaure que
 *     si personne n'a re-patché par-dessus.
 *  6. **opt-out** : `mountDebugBar({ network:false })` n'installe rien.
 *
 * Coût : 2 `performance.now()` + lecture d'1 header + 1 push capé par appel.
 * Négligeable vs la latence réseau.
 */
import { isEventStreamResponse } from "../sse/eventStream";

/**
 * En-têtes de corrélation posés par le framework sur chaque réponse :
 *  - `x-request-id` = **clé de lookup** du profiler serveur (concept requestId) ;
 *  - `traceparent`  = W3C Trace Context (RFC-propre), affiché pour la corrélation
 *    distribuée — pas la clé du profiler (qui est keyé par requestId).
 */
const REQUEST_ID_HEADER = "x-request-id";
const TRACEPARENT_HEADER = "traceparent";

/** La nature d'un appel observé : `http` (fetch/XHR), `ws`, `sse`. */
export type NetKind = "http" | "ws" | "sse";

/** Le cycle d'un flux longue durée tel que le navigateur le voit. */
export interface INetStream {
  /** `ws` : WebSocket ; `sse` : flux d'événements (`EventSource`, ou `fetch` qui le reçoit). */
  kind: "ws" | "sse";
  /** Connexion en cours, ouvert, ou fermé. */
  state: "connecting" | "open" | "closed";
  /** Code de fermeture WebSocket (`1000`, `1006`…) ; `null` pour un flux SSE ou tant qu'ouvert. */
  code: number | null;
  /** Motif de fermeture envoyé par le pair, `null` s'il est vide. */
  reason: string | null;
  /** Reconnexions qu'un `EventSource` a relancées seul. */
  reconnects: number;
  /** `performance.now()` de la fermeture : avec `startedAt`, la durée de vie. */
  closedAt: number | null;
}

/** Une entrée du panneau Network (1 appel AJAX observé). */
export interface NetEntry {
  /** Id local monotone (clé de rendu, ≠ requestId serveur). */
  id: number;
  method: string;
  url: string;
  /** Path seul (sans origin/query) pour l'affichage compact. */
  path: string;
  status: number | null;
  ok: boolean;
  /** Durée client (ms, envoi → réponse), `null` tant que pending. */
  durationMs: number | null;
  startedAt: number;
  /** `X-Request-Id` de la réponse → clé du profil serveur. `null` si absent. */
  requestId: string | null;
  /** `traceparent` W3C (RFC-propre) de la réponse, pour la corrélation distribuée. */
  traceparent: string | null;
  /** Vrai tant que la réponse n'est pas arrivée. */
  pending: boolean;
  /** Message d'erreur réseau (fetch rejeté / XHR error), sinon `null`. */
  error: string | null;
  /**
   * Flux longue durée (WebSocket, flux d'événements) : son cycle. Absent pour
   * un appel HTTP ordinaire — rien n'est alloué pour lui.
   */
  stream?: INetStream;
}

export interface NetworkInterceptorOptions {
  /** Appelé à chaque création/mise à jour d'entrée (re-render). */
  onChange: (entry: NetEntry) => void;
  /**
   * Prédicat d'exclusion d'une URL (ex. l'API profiler elle-même). `kind` dit
   * ce qui naît : `http` pour fetch/XHR — un flux reçu par `fetch` y reste,
   * son type ne se lisant qu'à la réponse.
   */
  ignore?: (url: string, kind: NetKind) => boolean;
}

/** Extrait le path d'une URL (absolue ou relative), tolérant : ne lève jamais. */
export function toPath(url: string): string {
  try {
    return new URL(url, location.href).pathname;
  } catch {
    return url;
  }
}

/** Normalise l'`input` polymorphe de `fetch` en URL string. */
function fetchUrl(input: unknown): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    const u = (input as { url?: unknown }).url;
    if (typeof u === "string") return u;
  }
  return String(input);
}

/**
 * Installe l'intercepteur fetch + XHR. No-op hors navigateur.
 *
 * @returns `uninstall()` — restaure les globals (OBLIGATOIRE à l'unmount).
 */
export function installNetworkInterceptor(
  opts: NetworkInterceptorOptions,
): () => void {
  if (typeof window === "undefined") return () => {};
  const ignore = opts.ignore ?? (() => false);
  let seq = 0;
  // Un flux ouvert avant la désinstallation peut encore se fermer après :
  // il ne doit plus rien annoncer à une barre démontée.
  let active = true;
  const emit = (entry: NetEntry): void => {
    if (active) safeEmit(opts, entry);
  };

  // ── fetch ────────────────────────────────────────────────────────────
  const origFetch = window.fetch;
  const patchedFetch: typeof window.fetch | null =
    typeof origFetch === "function"
      ? function (this: unknown, ...args: Parameters<typeof window.fetch>) {
          let url = "";
          let method = "GET";
          try {
            url = fetchUrl(args[0]);
            const input = args[0];
            method = (
              args[1]?.method ??
              (input instanceof Request ? input.method : "GET")
            ).toUpperCase();
          } catch {
            /* lecture défensive */
          }
          // Appel non observé (ex. l'API profiler) → relai direct.
          if (!url || ignore(url, "http")) {
            return origFetch.apply(this, args);
          }
          const entry: NetEntry = {
            id: ++seq,
            method,
            url,
            path: toPath(url),
            status: null,
            ok: false,
            durationMs: null,
            startedAt: performance.now(),
            requestId: null,
            traceparent: null,
            pending: true,
            error: null,
          };
          emit(entry);
          const p = origFetch.apply(this, args);
          return p.then(
            (res: Response) => {
              try {
                entry.status = res.status;
                entry.ok = res.ok;
                entry.requestId = res.headers.get(REQUEST_ID_HEADER);
                entry.traceparent = res.headers.get(TRACEPARENT_HEADER);
                entry.durationMs = round(performance.now() - entry.startedAt);
                entry.pending = false;
                if (isEventStreamResponse(res)) watchFetchStream(entry, args);
                emit(entry);
              } catch {
                /* ne jamais casser l'app */
              }
              return res; // body intact — header-only
            },
            (err: unknown) => {
              try {
                entry.error =
                  err instanceof Error ? err.message : "network error";
                entry.durationMs = round(performance.now() - entry.startedAt);
                entry.pending = false;
                emit(entry);
              } catch {
                /* noop */
              }
              throw err; // on relaie le rejet tel quel
            },
          );
        }
      : null;
  if (patchedFetch) window.fetch = patchedFetch;

  // ── XMLHttpRequest ───────────────────────────────────────────────────
  // Absent de certains environnements (worker, rendu serveur) malgré lib.dom.
  const XHR = window.XMLHttpRequest as typeof XMLHttpRequest | undefined;
  // Références NATIVES gardées telles quelles : rappelées par `.apply(this…)`
  // et remises en place à la désinstallation (identité exigée).
  // oxlint-disable-next-line typescript/unbound-method
  const origOpen = XHR?.prototype.open;
  // oxlint-disable-next-line typescript/unbound-method
  const origSend = XHR?.prototype.send;
  // État par instance (sans polluer le prototype public) via WeakMap.
  const state = new WeakMap<XMLHttpRequest, NetEntry>();
  let patchedOpen: XMLHttpRequest["open"] | null = null;
  let patchedSend: XMLHttpRequest["send"] | null = null;
  if (XHR && origOpen && origSend) {
    XHR.prototype.open = patchedOpen = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      try {
        const u = url.toString();
        if (u && !ignore(u, "http")) {
          state.set(this, {
            id: ++seq,
            method: method.toUpperCase(),
            url: u,
            path: toPath(u),
            status: null,
            ok: false,
            durationMs: null,
            startedAt: 0,
            requestId: null,
            traceparent: null,
            pending: true,
            error: null,
          });
        }
      } catch {
        /* noop */
      }
      return origOpen.apply(this, [method, url, ...rest] as never);
    };
    XHR.prototype.send = patchedSend = function (
      this: XMLHttpRequest,
      ...args: unknown[]
    ) {
      const entry = state.get(this);
      if (entry) {
        entry.startedAt = performance.now();
        emit(entry);
        const finalize = (error: string | null): void => {
          try {
            entry.status = this.status || null;
            entry.ok = this.status >= 200 && this.status < 400;
            entry.requestId = this.getResponseHeader(REQUEST_ID_HEADER) || null;
            entry.traceparent =
              this.getResponseHeader(TRACEPARENT_HEADER) || null;
            entry.durationMs = round(performance.now() - entry.startedAt);
            entry.error = error;
            entry.pending = false;
            emit(entry);
          } catch {
            /* noop */
          }
        };
        this.addEventListener("load", () => finalize(null));
        this.addEventListener("error", () => finalize("network error"));
        this.addEventListener("abort", () => finalize("aborted"));
        this.addEventListener("timeout", () => finalize("timeout"));
      }
      return origSend.apply(this, args as never);
    };
  }

  // ── Flux : WebSocket, EventSource ───────────────────────────────────
  // Une sous-classe garde `instanceof`, les constantes statiques et le
  // prototype natif ; on n'écoute que l'ouverture et la fermeture, et chaque
  // écouteur part à la fermeture.
  const newStream = (
    kind: "ws" | "sse",
    method: string,
    url: string,
  ): { entry: NetEntry; stream: INetStream } => {
    const stream: INetStream = {
      kind,
      state: "connecting",
      code: null,
      reason: null,
      reconnects: 0,
      closedAt: null,
    };
    const entry: NetEntry = {
      id: ++seq,
      method,
      url,
      path: toPath(url),
      status: null,
      ok: false,
      durationMs: null,
      startedAt: performance.now(),
      requestId: null,
      traceparent: null,
      pending: true,
      error: null,
      stream,
    };
    return { entry, stream };
  };
  const opened = (
    entry: NetEntry,
    stream: INetStream,
    status: number,
  ): void => {
    if (entry.pending) {
      entry.pending = false;
      entry.status = status;
      entry.ok = true;
      entry.durationMs = round(performance.now() - entry.startedAt);
    }
    stream.state = "open";
    emit(entry);
  };
  const closed = (
    entry: NetEntry,
    stream: INetStream,
    refused: string | null,
  ): void => {
    stream.state = "closed";
    stream.closedAt = performance.now();
    if (entry.pending) {
      entry.pending = false;
      entry.durationMs = round(stream.closedAt - entry.startedAt);
      entry.error = refused;
    }
    emit(entry);
  };

  // Un flux reçu par `fetch` (le client `NodefonySse`, ou tout autre) : son
  // seul signal d'abandon dit sa fin — un flux lu sans signal reste « ouvert ».
  function watchFetchStream(
    entry: NetEntry,
    args: Parameters<typeof window.fetch>,
  ): void {
    const stream: INetStream = {
      kind: "sse",
      state: "open",
      code: null,
      reason: null,
      reconnects: 0,
      closedAt: null,
    };
    entry.stream = stream;
    const input = args[0];
    const signal =
      args[1]?.signal ?? (input instanceof Request ? input.signal : null);
    signal?.addEventListener(
      "abort",
      () => {
        stream.state = "closed";
        stream.closedAt = performance.now();
        emit(entry);
      },
      { once: true },
    );
  }

  const OrigWs =
    typeof window.WebSocket === "function" ? window.WebSocket : null;
  let patchedWs: typeof WebSocket | null = null;
  if (OrigWs) {
    const watch = (ws: WebSocket): void => {
      try {
        if (!active || ignore(ws.url, "ws")) return;
        const { entry, stream } = newStream("ws", "WS", ws.url);
        const onOpen = (): void => opened(entry, stream, 101);
        // Le navigateur cache la cause d'un échec (RFC 6455 §4.1) : `error`
        // précède toujours `close`, qui porte le code — on conclut là.
        const onClose = (ev: CloseEvent): void => {
          ws.removeEventListener("open", onOpen);
          ws.removeEventListener("close", onClose);
          try {
            stream.code = ev.code;
            stream.reason = ev.reason || null;
            closed(entry, stream, `fermée avant l'ouverture (${ev.code})`);
          } catch {
            /* noop */
          }
        };
        ws.addEventListener("open", onOpen);
        ws.addEventListener("close", onClose);
        emit(entry);
      } catch {
        /* ne jamais casser l'app */
      }
    };
    patchedWs = class WebSocket extends OrigWs {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        watch(this);
      }
    };
    window.WebSocket = patchedWs;
  }

  const OrigEs =
    typeof window.EventSource === "function" ? window.EventSource : null;
  let patchedEs: typeof EventSource | null = null;
  if (OrigEs) {
    // `close()` n'émet aucun évènement : la sous-classe le prévient.
    const closers = new WeakMap<EventSource, () => void>();
    const watch = (es: EventSource): void => {
      try {
        if (!active || ignore(es.url, "sse")) return;
        const { entry, stream } = newStream("sse", "GET", es.url);
        const end = (refused: string | null): void => {
          es.removeEventListener("open", onOpen);
          es.removeEventListener("error", onError);
          closers.delete(es);
          closed(entry, stream, refused);
        };
        const onOpen = (): void => opened(entry, stream, 200);
        // `error` : le navigateur relance seul (CONNECTING) ou abandonne (CLOSED).
        const onError = (): void => {
          if (es.readyState === es.CLOSED) {
            end("flux refusé (statut ≠ 200 ou type ≠ text/event-stream)");
          } else if (stream.state === "open") {
            stream.reconnects++;
            stream.state = "connecting";
            emit(entry);
          }
        };
        es.addEventListener("open", onOpen);
        es.addEventListener("error", onError);
        closers.set(es, () => end(null));
        emit(entry);
      } catch {
        /* ne jamais casser l'app */
      }
    };
    patchedEs = class EventSource extends OrigEs {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        watch(this);
      }
      override close(): void {
        super.close();
        closers.get(this)?.();
      }
    };
    window.EventSource = patchedEs;
  }

  // ── uninstall (chain-safe) ──────────────────────────────────────────
  return () => {
    active = false;
    if (OrigWs && patchedWs && window.WebSocket === patchedWs) {
      window.WebSocket = OrigWs;
    }
    if (OrigEs && patchedEs && window.EventSource === patchedEs) {
      window.EventSource = OrigEs;
    }
    // On ne restaure que si personne n'a re-patché par-dessus le nôtre.
    if (patchedFetch && window.fetch === patchedFetch) window.fetch = origFetch;
    if (XHR && origOpen && XHR.prototype.open === patchedOpen) {
      XHR.prototype.open = origOpen;
    }
    if (XHR && origSend && XHR.prototype.send === patchedSend) {
      XHR.prototype.send = origSend;
    }
  };
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/** Émission protégée — un onChange qui throw ne doit pas casser la requête. */
function safeEmit(opts: NetworkInterceptorOptions, entry: NetEntry): void {
  try {
    opts.onChange(entry);
  } catch {
    /* le widget ne doit jamais impacter l'app hôte */
  }
}
