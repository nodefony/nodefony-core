import type {
  ILogDriver,
  ILogDriverProbe,
  ILogQueryCriteria,
  IPduLike,
} from "./ILogDriver";
import { filterPdus } from "./filterPdus";
import { coerceRecord } from "./FileLogDriver";
import { escapeRegExp } from "../../Tools";
import { resolveFetch, fetchWithTimeout } from "../httpFetch";
import type { FetchLike } from "../httpFetch";
import { stripTrailingSlashes } from "../../Tools";

export interface LokiLogDriverOptions {
  /** Base URL de Loki, ex. `http://127.0.0.1:3100`. */
  url: string;
  /** Labels de sélecteur de base (mêmes que le transport). Défaut `{ app: "nodefony" }`. */
  labels?: Record<string, string>;
  /** Tenant multi-tenancy → header `X-Scope-OrgID`. */
  tenantId?: string;
  /** Headers HTTP additionnels. */
  headers?: Record<string, string>;
  /**
   * Budget de scan : nombre max de lignes RAPATRIÉES de Loki avant filtrage local
   * (chemin admin FROID, anti-OOM). Défaut 1000. La pagination fine (`limit`/`offset`)
   * est appliquée APRÈS par {@link filterPdus} sur ce sous-ensemble.
   */
  maxScanLines?: number;
  /**
   * Fenêtre temporelle par défaut quand `from`/`to` sont absents (ms avant `now`).
   * Loki EXIGE un intervalle borné. Défaut 24 h.
   */
  defaultLookbackMs?: number;
  /** Timeout de la query (ms). Défaut 8000. */
  timeoutMs?: number;
  /** Implémentation `fetch` (tests / proxy). Défaut : `fetch` global. */
  fetchImpl?: FetchLike;
}

/** Échappe une chaîne pour une string literal LogQL `"..."` (Go-style). */
function escapeLogQLString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Échappe les métacaractères regex (pour un line filter `|~`). */
const escapeRegex = escapeRegExp;

/**
 * Extrait les lignes de log d'une réponse `query_range` Loki (`data.result[].values[][1]`),
 * en narrowing SÛR (réponse réseau = entrée externe, 0 `any`).
 */
function extractLokiLines(json: unknown): string[] {
  if (typeof json !== "object" || json === null) return [];
  const data = (json as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return [];
  const result = (data as { result?: unknown }).result;
  if (!Array.isArray(result)) return [];
  const lines: string[] = [];
  for (const stream of result) {
    if (typeof stream !== "object" || stream === null) continue;
    const values = (stream as { values?: unknown }).values;
    if (!Array.isArray(values)) continue;
    for (const v of values) {
      if (Array.isArray(v) && typeof v[1] === "string") lines.push(v[1]);
    }
  }
  return lines;
}

/**
 * Driver `loki` du Log Backplane (LB.4) — relit les logs dans **Grafana Loki** via
 * LogQL (`GET /loki/api/v1/query_range`). **Adaptateur, pas moteur** : Loki BORNE le
 * rapatriement (sélecteur de labels + fenêtre temporelle + grep + budget de lignes),
 * puis {@link filterPdus} est l'**autorité finale** sur le sous-ensemble rapatrié →
 * sémantique EXACTEMENT identique aux drivers `memory`/`file` (inclusion insensible à
 * la casse, ordering `uid`, pagination). Une logique, N façades.
 *
 * Chaque ligne Loki est le record wire JSON écrit par {@link LokiTransport} → `JSON.parse`
 * + {@link coerceRecord} (lignes corrompues ignorées). Chemin **FROID** (admin/debug),
 * jamais dans le pipeline requête. Loki injoignable / requête invalide → `throw` explicite
 * (≠ `file` absent : une infra de logs prod en panne DOIT être visible, pas masquée).
 *
 * @param options - URL Loki + labels + budgets.
 * @returns un `ILogDriver` `loki` queryable (Node-only).
 */
export function createLokiLogDriver(options: LokiLogDriverOptions): ILogDriver {
  const base = stripTrailingSlashes(options.url);
  const baseLabels = options.labels ?? { app: "nodefony" };
  const maxScanLines = options.maxScanLines ?? 1000;
  const defaultLookbackMs = options.defaultLookbackMs ?? 86_400_000;
  const timeoutMs = options.timeoutMs ?? 8000;
  const headers: Record<string, string> = {
    ...(options.tenantId ? { "X-Scope-OrgID": options.tenantId } : {}),
    ...options.headers,
  };
  const fetchImpl = resolveFetch(options.fetchImpl);

  const buildQuery = (criteria: ILogQueryCriteria): string => {
    // Sélecteur de labels : base (exact) + severity (label, basse cardinalité) si filtré.
    const sel: string[] = Object.entries(baseLabels).map(
      ([k, v]) => `${k}="${escapeLogQLString(v)}"`,
    );
    if (criteria.severity !== undefined) {
      const sevs = (
        Array.isArray(criteria.severity)
          ? criteria.severity
          : [criteria.severity]
      ).map((s) => escapeLogQLString(s.toUpperCase()));
      sel.push(`severity=~"${sevs.join("|")}"`);
    }
    let q = `{${sel.join(",")}}`;
    // Line filters : requestId = substring exact (`|=`), text = regex insensible casse.
    if (criteria.requestId !== undefined) {
      q += ` |= "${escapeLogQLString(criteria.requestId)}"`;
    }
    if (criteria.text !== undefined) {
      q += ` |~ "${escapeLogQLString("(?i)" + escapeRegex(criteria.text))}"`;
    }
    return q;
  };

  return {
    name: "loki",
    capabilities: { write: true, query: true, stream: false },
    query: async (criteria: ILogQueryCriteria) => {
      const now = Date.now();
      const fromMs = criteria.from ?? now - defaultLookbackMs;
      const toMs = criteria.to ?? now;
      const params = new URLSearchParams({
        query: buildQuery(criteria),
        start: `${fromMs}000000`, // ms → ns
        end: `${toMs}000000`,
        limit: String(maxScanLines),
        direction: "backward",
      });
      const url = `${base}/loki/api/v1/query_range?${params.toString()}`;
      const res = await fetchWithTimeout(
        fetchImpl,
        url,
        { method: "GET", headers },
        timeoutMs,
      );
      if (!res.ok) {
        throw new Error(`LokiLogDriver: query HTTP ${res.status}`);
      }
      const lines = extractLokiLines(await res.json());
      const records: IPduLike[] = [];
      for (const line of lines) {
        let raw: unknown;
        try {
          raw = JSON.parse(line);
        } catch {
          continue; // ligne non-JSON (ne devrait pas arriver depuis notre transport)
        }
        const rec = coerceRecord(raw);
        if (rec) records.push(rec);
      }
      // Loki renvoie les entrées groupées PAR STREAM (un stream par jeu de labels
      // severity/module/pid) → la concaténation `extractLokiLines` n'est PAS triée
      // globalement (chaque stream est chronologique, mais l'ordre inter-streams
      // suit la réponse). `filterPdus` itère son entrée de la FIN vers le début, donc
      // il attend un ordre ASCENDANT (ancien→récent) et émet récent-d'abord. On trie
      // donc par timeStamp CROISSANT (tie-break uid) avant de déléguer. ⚠️ un simple
      // `reverse()` (ce qu'il y avait) ne suffit pas : il n'ordonne correctement que
      // pour un flux unique déjà trié — sur du multi-sévérité il sort dans le désordre
      // (bug attrapé par l'E2E réel, invisible du mock mono-stream).
      records.sort((a, b) => a.timeStamp - b.timeStamp || a.uid - b.uid);
      return filterPdus(records, criteria);
    },
    probe: async (): Promise<ILogDriverProbe> => {
      // `/ready` = endpoint de santé natif de Loki (200 « ready » quand le binaire a
      // fini son boot). Sonde FROIDE (admin), ne throw jamais.
      const t0 = Date.now();
      try {
        const res = await fetchWithTimeout(
          fetchImpl,
          `${base}/ready`,
          { method: "GET", headers },
          timeoutMs,
        );
        const latencyMs = Date.now() - t0;
        const text = (await res.text()).trim();
        const ready = res.ok && text.toLowerCase().startsWith("ready");
        const info: Record<string, string | number> = {
          endpoint: base,
          httpStatus: res.status,
        };
        return ready
          ? { ok: true, latencyMs, info }
          : {
              ok: false,
              latencyMs,
              detail: `Loki /ready → HTTP ${res.status}${text ? ` (${text.slice(0, 60)})` : ""}`,
              info,
            };
      } catch (e) {
        return {
          ok: false,
          latencyMs: Date.now() - t0,
          detail: e instanceof Error ? e.message : "unreachable",
          info: { endpoint: base },
        };
      }
    },
  };
}
