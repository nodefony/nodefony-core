/**
 * Intercepteur réseau **dev-only** de la debug bar — capture les appels AJAX
 * (`fetch` + `XMLHttpRequest`) de la page pour le panneau Network, et lit le
 * header `X-Request-Id` de chaque réponse → corrélation avec le profil serveur
 * (`/nodefony/profiler/api/{requestId}`).
 *
 * ⚠️ Monkey-patch des globals = intrusif. Donc 6 garde-fous (cf décision design) :
 *  1. **dev-only** : n'est installé que par la debug bar, jamais en prod.
 *  2. **défensif** : toute la collecte est en try/catch — un bug ici ne casse
 *     JAMAIS la requête de l'app (on relaie toujours l'appel original).
 *  3. **header-only** : on ne touche jamais au body (pas de `.clone()`, pas de
 *     lecture du stream) → 0 risque de consommer/altérer la réponse.
 *  4. **réversible** : `uninstall()` restaure les implémentations d'origine.
 *  5. **chain-safe** : on wrappe le `fetch`/XHR COURANT (déjà potentiellement
 *     patché par une autre lib), on ne clobber pas — l'uninstall ne restaure que
 *     si personne n'a re-patché par-dessus.
 *  6. **opt-out** : `mountDebugBar({ network:false })` n'installe rien.
 *
 * Coût : 2 `performance.now()` + lecture d'1 header + 1 push capé par appel.
 * Négligeable vs la latence réseau.
 */

/**
 * En-têtes de corrélation posés par le framework sur chaque réponse :
 *  - `x-request-id` = **clé de lookup** du profiler serveur (concept requestId) ;
 *  - `traceparent`  = W3C Trace Context (RFC-propre), affiché pour la corrélation
 *    distribuée — pas la clé du profiler (qui est keyé par requestId).
 */
const REQUEST_ID_HEADER = "x-request-id";
const TRACEPARENT_HEADER = "traceparent";

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
}

export interface NetworkInterceptorOptions {
  /** Appelé à chaque création/mise à jour d'entrée (re-render). */
  onChange: (entry: NetEntry) => void;
  /** Prédicat d'exclusion d'une URL (ex. l'API profiler elle-même). */
  ignore?: (url: string) => boolean;
}

/** Extrait le path d'une URL (absolue ou relative), tolérant. */
function toPath(url: string): string {
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

  // ── fetch ────────────────────────────────────────────────────────────
  const origFetch = window.fetch;
  const patchedFetch: typeof window.fetch | null =
    typeof origFetch === "function"
      ? function (this: unknown, ...args: Parameters<typeof window.fetch>) {
          let url = "";
          let method = "GET";
          try {
            url = fetchUrl(args[0]);
            const init = args[1];
            method = (init?.method ?? (args[0] as Request)?.method ?? "GET")
              .toString()
              .toUpperCase();
          } catch {
            /* lecture défensive */
          }
          // Appel non observé (ex. l'API profiler) → relai direct.
          if (!url || ignore(url)) {
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
          safeEmit(opts, entry);
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
                safeEmit(opts, entry);
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
                safeEmit(opts, entry);
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
  const XHR = window.XMLHttpRequest;
  const origOpen = XHR?.prototype.open;
  const origSend = XHR?.prototype.send;
  // État par instance (sans polluer le prototype public) via WeakMap.
  const state = new WeakMap<XMLHttpRequest, NetEntry>();
  if (XHR && origOpen && origSend) {
    XHR.prototype.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      try {
        const u = url.toString();
        if (u && !ignore(u)) {
          state.set(this, {
            id: ++seq,
            method: (method ?? "GET").toUpperCase(),
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
    XHR.prototype.send = function (this: XMLHttpRequest, ...args: unknown[]) {
      const entry = state.get(this);
      if (entry) {
        entry.startedAt = performance.now();
        safeEmit(opts, entry);
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
            safeEmit(opts, entry);
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

  // ── uninstall (chain-safe) ──────────────────────────────────────────
  return () => {
    // On ne restaure que si personne n'a re-patché par-dessus le nôtre.
    if (patchedFetch && window.fetch === patchedFetch) window.fetch = origFetch;
    if (XHR && origOpen && XHR.prototype.open !== origOpen) {
      XHR.prototype.open = origOpen;
    }
    if (XHR && origSend && XHR.prototype.send !== origSend) {
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
