/**
 * Petit contrat `fetch` minimal et INJECTABLE, partagé par les destinations HTTP du
 * Log Backplane (drivers `loki`/`opensearch` côté query, transports côté write).
 *
 * Pourquoi un type local plutôt que le `fetch` global de `lib.dom` : le workspace core
 * est isomorphe (Node + browser) et ne tire pas `lib.dom`. On déclare donc la surface
 * STRICTE qu'on utilise (statut + `text`/`json`), ce qui rend aussi le code **testable
 * sans réseau** : un test passe un `FetchLike` factice. 0 `any`, narrowing explicite.
 */
export interface FetchResponseLike {
  /** `true` si statut 2xx. */
  readonly ok: boolean;
  /** Code HTTP (utile pour distinguer 404 « pas encore d'index » d'une vraie panne). */
  readonly status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/** Sous-ensemble des options `RequestInit` réellement utilisées. */
export interface FetchInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/** Signature compatible `globalThis.fetch` (surface réduite). */
export type FetchLike = (
  url: string,
  init?: FetchInitLike,
) => Promise<FetchResponseLike>;

/**
 * Résout l'implémentation `fetch` à utiliser : celle passée explicitement (tests,
 * proxy custom), sinon le `fetch` global (Node ≥ 18). Lève si aucune n'est dispo
 * (jamais d'échec silencieux d'un driver prod mal configuré).
 *
 * @param custom - implémentation explicite (prioritaire).
 * @returns un `FetchLike` garanti non nul.
 * @throws si aucun `fetch` n'est disponible.
 */
export function resolveFetch(custom?: FetchLike): FetchLike {
  if (custom) return custom;
  const f = (globalThis as { fetch?: unknown }).fetch;
  if (typeof f !== "function") {
    throw new Error(
      "global fetch unavailable (Node >= 18 required) — pass fetchImpl explicitly",
    );
  }
  return f as FetchLike;
}

/**
 * `fetch` borné par un timeout (via `AbortController`) — un push/lecture de logs ne
 * doit JAMAIS bloquer indéfiniment sur une destination injoignable. `timeoutMs ≤ 0`
 * = pas de timeout.
 *
 * @param fetchImpl - implémentation `FetchLike`.
 * @param url - URL cible.
 * @param init - options de requête.
 * @param timeoutMs - délai max avant `abort`.
 * @returns la réponse, ou rejette (timeout/réseau).
 */
export async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: FetchInitLike,
  timeoutMs: number,
): Promise<FetchResponseLike> {
  if (!timeoutMs || timeoutMs <= 0) return fetchImpl(url, init);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }
  try {
    return await fetchImpl(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}
