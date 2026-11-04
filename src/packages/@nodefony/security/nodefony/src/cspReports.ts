import { MemoryRateLimitStore } from "@nodefony/http";
import type { ICspReportsSnapshot, ICspViolation } from "nodefony";

/** Sévérité d'une ligne du journal, au vocabulaire du syslog Nodefony. */
type LogSeverity = "WARNING" | "NOTICE";

/** Options d'un {@link CspReportCollector}. */
export interface ICspReportCollectorOptions {
  /** URL que la politique désigne (rendue par la lecture). */
  endpoint: string;
  /** Violations distinctes gardées au plus. */
  capacity?: number;
  /** Rapports acceptés par adresse et par minute. */
  perMinute?: number;
  /** Adresses suivies au plus par le quota (borne mémoire). */
  maxTrackedClients?: number;
  /** Violations NEUVES journalisées au plus par minute, toutes adresses confondues. */
  logPerMinute?: number;
  /** Journal ; une violation neuve y part une fois, jamais à chaque répétition. */
  log?: (message: string, severity: LogSeverity) => void;
  /** Horloge injectable (ms), pour les tests. */
  now?: () => number;
}

/** Ce que devient un rapport reçu — l'émetteur n'en saura rien (204 toujours). */
export type CspReportOutcome =
  "stored" | "duplicate" | "limited" | "unsupported" | "malformed";

/** Une violation en cours de dédoublonnage (les compteurs bougent). */
interface IStoredViolation {
  documentURL: string;
  blockedURL: string | null;
  effectiveDirective: string;
  disposition: "enforce" | "report";
  sourceFile: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
  statusCode: number | null;
  userAgent: string | null;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

/** Ce que le rapport dit de la violation, avant comptage. */
type ViolationFields = Omit<
  IStoredViolation,
  "count" | "firstSeen" | "lastSeen" | "userAgent"
>;

const MINUTE_MS = 60_000;
const MAX_URL_LENGTH = 512;
const MAX_USER_AGENT_LENGTH = 200;
/** Directive ou mot-clé de la norme : minuscules et tirets, court. */
const TOKEN = /^[a-z][a-z0-9-]{0,47}$/u;
/** Contrôles C0, DEL et C1 — jamais dans une ligne de journal ni un affichage. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/gu;
const MAX_INT = 10_000_000;

/**
 * Reçoit, expurge, dédoublonne et garde EN MÉMOIRE les rapports de violation
 * CSP (ADR-0024 §C7). La porte qui les livre est publique — le navigateur
 * n'envoie aucun identifiant — donc tout ce qui entre est traité comme écrit
 * par un attaquant :
 *
 * - **quota par adresse** (fenêtre d'une minute, le limiteur de `@nodefony/http`) ;
 * - **deux types de contenu seulement** : `application/csp-report` (`report-uri`)
 *   et `application/reports+json` (`report-to`) ;
 * - **URL expurgées** de leur requête, de leur fragment et de leurs identifiants
 *   (la norme ne retire pas la requête : elle peut porter un jeton) ; une URL
 *   qui n'est pas HTTP(S) se réduit à son schéma ;
 * - **l'extrait de code n'est jamais gardé** — c'est une chaîne de l'attaquant ;
 * - **mémoire bornée** : au plus `capacity` violations distinctes, la moins
 *   récemment vue évincée d'abord ; une répétition incrémente un compteur ;
 * - **journal dédoublonné et borné** : une violation neuve y part une fois, et
 *   pas plus de `logPerMinute` lignes par minute.
 *
 * Rien n'est écrit sur disque : le journal centralisé voit déjà ce qui compte.
 */
export class CspReportCollector {
  /** URL que la politique désigne. */
  readonly endpoint: string;
  /** Violations distinctes gardées au plus. */
  readonly capacity: number;
  // Ordre d'insertion = ordre de dernière vue : une violation revue est
  // réinsérée en fin, la tête est donc toujours la moins récemment vue.
  readonly #violations = new Map<string, IStoredViolation>();
  readonly #limiter: MemoryRateLimitStore;
  readonly #log: ((message: string, severity: LogSeverity) => void) | null;
  readonly #now: () => number;
  readonly #logPerMinute: number;
  #logWindowStart = 0;
  #loggedInWindow = 0;
  #silenced = 0;
  #received = 0;
  #rejected = 0;

  /**
   * @param options - URL désignée, bornes, journal, horloge.
   */
  constructor(options: ICspReportCollectorOptions) {
    this.endpoint = options.endpoint;
    this.capacity = options.capacity ?? 200;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? null;
    this.#logPerMinute = options.logPerMinute ?? 20;
    this.#limiter = new MemoryRateLimitStore(
      {
        windowMs: MINUTE_MS,
        max: options.perMinute ?? 120,
        maxTracked: options.maxTrackedClients ?? 10_000,
      },
      this.#now,
    );
  }

  /**
   * Traite un corps de rapport déjà lu (et déjà borné par l'appelant).
   *
   * @param contentType - type de contenu de la requête, paramètres compris ou non.
   * @param body - le corps, octets ou texte.
   * @param client - adresse cliente résolue (proxy de confiance compris) ;
   *   `null` = inconnue, non comptée (jamais une clé commune à tous).
   * @param userAgent - en-tête `User-Agent`, gardé tronqué.
   * @returns ce que le rapport est devenu — pour le journal et les tests ;
   *   l'émetteur reçoit 204 quoi qu'il arrive.
   */
  receive(
    contentType: string | null | undefined,
    body: Uint8Array | string,
    client: string | null,
    userAgent?: string | null,
  ): CspReportOutcome {
    this.#received++;
    if (client !== null && this.#limiter.hit(client).limited) {
      this.#rejected++;
      return "limited";
    }
    const type = mediaTypeOf(contentType);
    if (
      type !== "application/csp-report" &&
      type !== "application/reports+json"
    ) {
      this.#rejected++;
      return "unsupported";
    }
    let payload: unknown;
    try {
      payload = JSON.parse(
        typeof body === "string" ? body : Buffer.from(body).toString("utf8"),
      );
    } catch {
      this.#rejected++;
      return "malformed";
    }
    const agent = cleanText(userAgent, MAX_USER_AGENT_LENGTH);
    const violations =
      type === "application/csp-report"
        ? fromCspReport(payload)
        : fromReportsJson(payload);
    if (violations.length === 0) {
      this.#rejected++;
      return "malformed";
    }
    let outcome: CspReportOutcome = "duplicate";
    for (const violation of violations) {
      if (this.#store(violation, agent)) outcome = "stored";
    }
    return outcome;
  }

  /**
   * Photo des violations gardées, la plus récemment vue d'abord — ce que rend
   * le plan d'administration.
   *
   * @returns une copie : la modifier ne touche pas le collecteur.
   */
  snapshot(): ICspReportsSnapshot {
    const items: ICspViolation[] = [];
    for (const v of this.#violations.values()) items.push({ ...v });
    items.reverse();
    return {
      enabled: true,
      endpoint: this.endpoint,
      capacity: this.capacity,
      received: this.#received,
      rejected: this.#rejected,
      items,
    };
  }

  /** Range une violation ; `true` si elle est neuve. */
  #store(violation: ViolationFields, userAgent: string | null): boolean {
    const now = this.#now();
    const key = [
      violation.disposition,
      violation.effectiveDirective,
      violation.documentURL,
      violation.blockedURL ?? "",
      violation.sourceFile ?? "",
      violation.lineNumber ?? "",
      violation.columnNumber ?? "",
    ].join("\u0000");
    const known = this.#violations.get(key);
    if (known !== undefined) {
      known.count++;
      known.lastSeen = now;
      if (userAgent !== null) known.userAgent = userAgent;
      this.#violations.delete(key);
      this.#violations.set(key, known);
      return false;
    }
    if (this.#violations.size >= this.capacity) {
      const oldest = this.#violations.keys().next();
      if (oldest.done !== true) this.#violations.delete(oldest.value);
    }
    this.#violations.set(key, {
      ...violation,
      userAgent,
      count: 1,
      firstSeen: now,
      lastSeen: now,
    });
    this.#announce(violation, now);
    return true;
  }

  /** Journalise une violation neuve, dans la limite du budget de la minute. */
  #announce(
    v: Pick<
      IStoredViolation,
      | "effectiveDirective"
      | "blockedURL"
      | "documentURL"
      | "sourceFile"
      | "lineNumber"
      | "disposition"
    >,
    now: number,
  ): void {
    if (this.#log === null) return;
    if (now - this.#logWindowStart >= MINUTE_MS) {
      if (this.#silenced > 0) {
        this.#log(
          `CSP : ${this.#silenced} violation(s) neuve(s) non journalisée(s) la minute précédente — liste complète : GET /nodefony/security/api/csp-reports`,
          "NOTICE",
        );
      }
      this.#logWindowStart = now;
      this.#loggedInWindow = 0;
      this.#silenced = 0;
    }
    if (this.#loggedInWindow >= this.#logPerMinute) {
      this.#silenced++;
      return;
    }
    this.#loggedInWindow++;
    const where =
      v.sourceFile !== null
        ? ` (${v.sourceFile}${v.lineNumber !== null ? `:${v.lineNumber}` : ""})`
        : "";
    this.#log(
      `CSP ${v.disposition === "report" ? "signalée" : "bloquée"} : ${
        v.effectiveDirective
      } refuse ${v.blockedURL ?? "?"} sur ${v.documentURL}${where}`,
      "WARNING",
    );
  }
}

/** Type de contenu sans paramètres, en minuscules. */
function mediaTypeOf(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const semi = value.indexOf(";");
  return (semi === -1 ? value : value.slice(0, semi)).trim().toLowerCase();
}

/** Objet ordinaire, ou `null`. */
function recordOf(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Corps `application/csp-report` : `{ "csp-report": { … } }` (CSP2, `report-uri`). */
function fromCspReport(payload: unknown): ViolationFields[] {
  const report = recordOf(recordOf(payload)?.["csp-report"]);
  if (report === null) return [];
  const one = normalize({
    documentURL: report["document-uri"],
    blockedURL: report["blocked-uri"],
    effectiveDirective: report["effective-directive"],
    violatedDirective: report["violated-directive"],
    disposition: report["disposition"],
    sourceFile: report["source-file"],
    lineNumber: report["line-number"],
    columnNumber: report["column-number"],
    statusCode: report["status-code"],
  });
  return one === null ? [] : [one];
}

/**
 * Corps `application/reports+json` : un tableau de rapports de la Reporting
 * API, dont seuls ceux de type `csp-violation` sont lus.
 */
function fromReportsJson(payload: unknown): ViolationFields[] {
  if (!Array.isArray(payload)) return [];
  const out: ViolationFields[] = [];
  for (const item of payload) {
    const report = recordOf(item);
    if (report?.["type"] !== "csp-violation") continue;
    const body = recordOf(report["body"]);
    if (body === null) continue;
    const one = normalize({
      documentURL: body["documentURL"] ?? report["url"],
      blockedURL: body["blockedURL"],
      effectiveDirective: body["effectiveDirective"],
      violatedDirective: undefined,
      disposition: body["disposition"],
      sourceFile: body["sourceFile"],
      lineNumber: body["lineNumber"],
      columnNumber: body["columnNumber"],
      statusCode: body["statusCode"],
    });
    if (one !== null) out.push(one);
  }
  return out;
}

/** Les champs bruts, tels que l'un ou l'autre format les nomme. */
interface IRawViolation {
  documentURL: unknown;
  blockedURL: unknown;
  effectiveDirective: unknown;
  violatedDirective: unknown;
  disposition: unknown;
  sourceFile: unknown;
  lineNumber: unknown;
  columnNumber: unknown;
  statusCode: unknown;
}

/**
 * Expurge une violation ; `null` si elle ne désigne ni un document ni une
 * directive — rien d'exploitable, donc rien à garder.
 */
function normalize(raw: IRawViolation): ViolationFields | null {
  const documentURL = stripUrl(raw.documentURL);
  if (documentURL === null) return null;
  const effectiveDirective =
    tokenOf(raw.effectiveDirective) ?? firstTokenOf(raw.violatedDirective);
  if (effectiveDirective === null) return null;
  return {
    documentURL,
    blockedURL: stripUrl(raw.blockedURL),
    effectiveDirective,
    disposition: raw.disposition === "report" ? "report" : "enforce",
    sourceFile: stripUrl(raw.sourceFile),
    lineNumber: intOf(raw.lineNumber),
    columnNumber: intOf(raw.columnNumber),
    statusCode: intOf(raw.statusCode),
  };
}

/**
 * Une URL de rapport, expurgée : sans identifiants, requête ni fragment ; le
 * seul schéma si elle n'est pas HTTP(S) (`w3c-reporting.bs`, « Strip URL for
 * use in reports », qui garde la requête — pas nous : elle peut porter un
 * jeton). Un mot-clé de la norme (`inline`, `eval`…) passe tel quel.
 */
function stripUrl(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  if (TOKEN.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return url.protocol.slice(0, -1);
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  const href = url.href;
  return href.length > MAX_URL_LENGTH ? href.slice(0, MAX_URL_LENGTH) : href;
}

function tokenOf(value: unknown): string | null {
  return typeof value === "string" && TOKEN.test(value) ? value : null;
}

/** `violated-directive` (CSP2) porte la directive suivie de ses sources. */
function firstTokenOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const space = value.indexOf(" ");
  return tokenOf(space === -1 ? value : value.slice(0, space));
}

function intOf(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_INT
    ? value
    : null;
}

/** Texte libre de l'émetteur : sans contrôles, tronqué. */
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(CONTROL, "").trim();
  if (text === "") return null;
  return text.length > max ? text.slice(0, max) : text;
}
