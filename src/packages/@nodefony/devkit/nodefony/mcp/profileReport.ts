import {
  ACTION_SELF_PHASE,
  type IProfileReport,
  type IRouteStats,
} from "@nodefony/http";

/**
 * Le rapport de profil tel qu'un AGENT de code le lit — rendu partagé par les
 * outils qui observent l'application (`nodefony_observe`) ou la sollicitent.
 *
 * L'ordre est celui de la décision : un verdict d'abord, puis ce qu'il faut
 * corriger (une anomalie par ligne, nommée par route, contrôleur et forme SQL),
 * les tableaux ensuite, et les données brutes en dernier pour comparer deux
 * appels. Chaque section est bornée : le texte entier reste sous la limite que
 * la porte impose à une réponse d'outil.
 */

/** p95 à partir duquel une route est signalée lente (développement, machine locale). */
export const SLOW_ROUTE_P95_MS = 500;

/** Retard moyen de la boucle d'événements à partir duquel le process est jugé chargé. */
export const EVENT_LOOP_BUSY_MS = 50;

/** Lignes maximales par section. */
const MAX_ANOMALIES = 10;
const MAX_ROUTES = 20;
const MAX_SLOW_QUERIES = 10;

/** Longueur maximale d'une forme SQL citée. */
const SHAPE_MAX = 300;

/** Le déroulé de l'observation : ce que le rapport doit dire de sa propre fiabilité. */
export interface IObservationContext {
  /** Fenêtre demandée, en ms. */
  windowMs: number;
  /** Durée réellement observée, en ms. */
  elapsedMs: number;
  /** Relevés effectués. */
  ticks: number;
  /** Profils disparus avant d'être lus (tampon débordé, identifiant réutilisé). */
  lost: number;
  /** L'agent a abandonné l'appel avant la fin de la fenêtre. */
  cancelled: boolean;
  /** Route à laquelle l'observation était restreinte, s'il y en avait une. */
  route: string | null;
  /** Requêtes écartées par ce filtre de route. */
  filteredRoute: number;
  pid: number;
  uptimeSec: number;
  /** Retard de la boucle d'événements sur la fenêtre (ms), si mesuré. */
  eventLoop: { meanMs: number; maxMs: number } | null;
  /** Variation du tas sur la fenêtre (octets), si mesurée. */
  heapDeltaBytes: number | null;
}

/** Nombre lisible : une décimale sous 10, entier au-delà. */
function ms(value: number): string {
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function routeLabel(r: {
  route: string;
  controller: string | null;
  action: string | null;
}): string {
  const target =
    r.controller !== null && r.action !== null
      ? ` (${r.controller}.${r.action})`
      : "";
  return `\`${r.route}\`${target}`;
}

/** Requêtes chronométrées d'une route (dénominateur des moyennes par requête). */
function timed(r: IRouteStats): number {
  return Math.max(1, r.count - r.untimed);
}

/**
 * Les trois postes les plus lourds d'une route, en ms par requête.
 * La phase `action` est écartée : elle CONTIENT les autres, `action.self` dit
 * ce qui reste à l'action une fois retirés rendu, initialisation et SQL.
 */
function topPhases(r: IRouteStats): string {
  const parts: [string, number][] = [];
  for (const [name, total] of Object.entries(r.phases)) {
    if (name === "action") continue;
    parts.push([name, total.totalMs / timed(r)]);
  }
  if (r.queries.totalMs > 0) parts.push(["SQL", r.queries.totalMs / timed(r)]);
  parts.sort((a, b) => b[1] - a[1]);
  return parts
    .slice(0, 3)
    .map(([name, v]) => `${name} ${ms(v)} ms`)
    .join(" · ");
}

/** Les anomalies à corriger, les plus coûteuses d'abord. */
function anomalies(report: IProfileReport, ctx: IObservationContext): string[] {
  const lines: string[] = [];
  for (const n of report.nPlusOne) {
    lines.push(
      `N+1 — route ${routeLabel(n)} : \`${cut(n.shape, SHAPE_MAX)}\` répétée ` +
        `×${n.maxRepeats} dans une requête (${n.requests} requête(s) touchée(s), ` +
        `${ms(n.totalMs)} ms cumulés). Exemple : requestId ${n.sampleRequestId}. ` +
        "Remède habituel : charger la relation en une requête (`relations`, `$in`).",
    );
  }
  for (const r of report.routes) {
    if (r.status.s5xx === 0 && r.errors === 0) continue;
    const ids = report.errors.filter((e) => e.route === r.route).slice(0, 3);
    const message = ids.find((e) => e.error !== null)?.error;
    lines.push(
      `Erreurs — route ${routeLabel(r)} : ${r.errors} sur ${r.count}` +
        (message === undefined ? "" : ` — « ${message} »`) +
        (ids.length > 0
          ? `. requestId : ${ids.map((e) => e.requestId).join(", ")}. Journal d'une requête : ` +
            '`nodefony_admin_call { namespace: "syslog", path: "logs", query: { requestId } }`.'
          : "."),
    );
  }
  for (const r of report.routes) {
    if (r.p95Ms === null || r.p95Ms < SLOW_ROUTE_P95_MS) continue;
    lines.push(
      `Lente — route ${routeLabel(r)} : p95 ${ms(r.p95Ms)} ms ; par requête : ${topPhases(r)}.`,
    );
  }
  if (ctx.eventLoop !== null && ctx.eventLoop.maxMs >= EVENT_LOOP_BUSY_MS) {
    lines.push(
      `Boucle d'événements chargée — retard jusqu'à ${ms(ctx.eventLoop.maxMs)} ms ` +
        `(moyenne ${ms(ctx.eventLoop.meanMs)} ms) : un traitement synchrone bloque ` +
        "le process, et toutes les routes en pâtissent.",
    );
  }
  return lines;
}

/** Ce qui rend l'observation incomplète — à dire avant toute conclusion. */
function gaps(report: IProfileReport, ctx: IObservationContext): string[] {
  const out: string[] = [];
  if (report.requests === 0) {
    out.push(
      "aucune requête observée : l'application n'a reçu aucun trafic pendant la " +
        "fenêtre (cet outil n'en génère pas — lancer la page, les tests ou une charge pendant l'observation)",
    );
  }
  if (ctx.lost > 0) {
    out.push(
      `${ctx.lost} profil(s) perdu(s) avant lecture (tampon du profileur débordé) : ` +
        "les chiffres portent sur un échantillon",
    );
  }
  if (report.untimed > 0) {
    out.push(
      `${report.untimed} requête(s) sans durée (mesure des phases désactivée, ou requête interrompue)`,
    );
  }
  if (ctx.cancelled) {
    out.push(
      `observation abandonnée après ${ms(ctx.elapsedMs / 1000)} s sur ${ms(ctx.windowMs / 1000)} s`,
    );
  }
  return out;
}

/**
 * Rend le rapport complet pour l'agent.
 *
 * @param report - l'agrégation des profils observés.
 * @param ctx - le déroulé de l'observation.
 * @returns le texte, borné.
 */
export function renderProfileReport(
  report: IProfileReport,
  ctx: IObservationContext,
): string {
  const found = anomalies(report, ctx);
  const missing = gaps(report, ctx);
  const out: string[] = [];

  const verdict =
    found.length > 0
      ? `anomalies (${found.length})`
      : report.requests > 0
        ? "ok"
        : "rien à juger";
  out.push(
    `Verdict : ${verdict}` +
      (missing.length > 0
        ? " — observation INCOMPLÈTE"
        : " — observation complète"),
  );
  for (const m of missing) out.push(`⚠️ ${m}.`);

  out.push(
    `Fenêtre : ${ms(ctx.elapsedMs / 1000)} s sur ${ms(ctx.windowMs / 1000)} s · ` +
      `${ctx.ticks} relevé(s) · ${report.requests} requête(s) (${report.http} HTTP, ${report.ws} WebSocket) · ` +
      `${ctx.lost} perdue(s) · ${report.filteredTooling} de l'outillage écartée(s)` +
      (ctx.route === null
        ? ""
        : ` · restreinte à la route \`${ctx.route}\` (${ctx.filteredRoute} autre(s) écartée(s))`),
  );
  const process: string[] = [
    `pid ${ctx.pid}, démarré il y a ${Math.round(ctx.uptimeSec)} s`,
  ];
  if (ctx.eventLoop !== null) {
    process.push(
      `boucle d'événements : retard moyen ${ms(ctx.eventLoop.meanMs)} ms, max ${ms(ctx.eventLoop.maxMs)} ms`,
    );
  }
  if (ctx.heapDeltaBytes !== null) {
    const mo = ctx.heapDeltaBytes / (1024 * 1024);
    process.push(`tas ${mo >= 0 ? "+" : ""}${mo.toFixed(1)} Mo`);
  }
  out.push(`Process : ${process.join(" · ")}`);

  const refused = report.routes.filter(
    (r) => r.status.unauthorized + r.status.forbidden > 0,
  );
  if (refused.length > 0) {
    out.push(
      "Refus (hors percentiles) : " +
        refused
          .slice(0, 5)
          .map(
            (r) =>
              `\`${r.route}\` 401×${r.status.unauthorized} 403×${r.status.forbidden}`,
          )
          .join(" · ") +
        " — une route protégée appelée sans jeton se mesure en refus, pas en temps de réponse.",
    );
  }

  if (found.length > 0) {
    out.push("", "Anomalies (les plus coûteuses d'abord) :");
    found
      .slice(0, MAX_ANOMALIES)
      .forEach((line, i) => out.push(`${i + 1}. ${line}`));
    if (found.length > MAX_ANOMALIES) {
      out.push(
        `… et ${found.length - MAX_ANOMALIES} autre(s), dans les données ci-dessous.`,
      );
    }
  }

  if (report.routes.length > 0) {
    out.push(
      "",
      "Routes (p95 décroissant ; durées sur les requêtes servies) :",
      "route | type | n | p50 | p95 | max | 2xx/3xx/4xx/5xx | SQL par requête moy/max | temps par requête",
    );
    for (const r of report.routes.slice(0, MAX_ROUTES)) {
      const s = r.status;
      const sqlAvg = r.queries.total / r.count;
      out.push(
        [
          routeLabel(r),
          r.kind,
          r.count,
          r.p50Ms === null ? "—" : `${ms(r.p50Ms)} ms`,
          r.p95Ms === null ? "—" : `${ms(r.p95Ms)} ms`,
          r.maxMs === null ? "—" : `${ms(r.maxMs)} ms`,
          `${s.s2xx}/${s.s3xx}/${s.s4xx}/${s.s5xx}`,
          `${sqlAvg.toFixed(1)}/${r.queries.perRequestMax}`,
          topPhases(r) || "—",
        ].join(" | "),
      );
    }
    if (report.routes.length > MAX_ROUTES) {
      out.push(`… ${report.routes.length - MAX_ROUTES} route(s) de plus.`);
    }
  }

  if (report.slowQueries.length > 0) {
    out.push(
      "",
      "Requêtes SQL les plus coûteuses (par forme, valeurs masquées) :",
    );
    for (const q of report.slowQueries.slice(0, MAX_SLOW_QUERIES)) {
      out.push(
        `- ${ms(q.totalMs)} ms cumulés · ×${q.count} · max ${ms(q.maxMs)} ms · ` +
          `${q.routes.map((r) => `\`${r}\``).join(", ")} — \`${cut(q.shape, SHAPE_MAX)}\``,
      );
    }
    if (report.sqlShapesDropped > 0) {
      out.push(
        `… ${report.sqlShapesDropped} forme(s) de plus, comptées sans détail.`,
      );
    }
  }

  out.push(
    "",
    "Données (JSON, pour comparer deux appels) :",
    JSON.stringify({
      requests: report.requests,
      lost: ctx.lost,
      routes: report.routes.slice(0, MAX_ROUTES).map((r) => ({
        route: r.route,
        kind: r.kind,
        n: r.count,
        p50: r.p50Ms,
        p95: r.p95Ms,
        s5xx: r.status.s5xx,
        sqlPerReq: Math.round((r.queries.total / r.count) * 10) / 10,
        actionSelfMs:
          r.phases[ACTION_SELF_PHASE] === undefined
            ? null
            : Math.round(
                (r.phases[ACTION_SELF_PHASE].totalMs / timed(r)) * 100,
              ) / 100,
      })),
      nPlusOne: report.nPlusOne.slice(0, MAX_ANOMALIES).map((n) => ({
        route: n.route,
        repeats: n.maxRepeats,
        shape: cut(n.shape, SHAPE_MAX),
      })),
    }),
  );
  return out.join("\n");
}

/**
 * La ligne d'un relevé intermédiaire, envoyée en progression à l'agent.
 *
 * @param report - l'agrégation à cet instant.
 * @param elapsedSec - secondes écoulées.
 * @param windowSec - fenêtre demandée.
 * @param lost - profils perdus jusqu'ici.
 */
export function progressLine(
  report: IProfileReport,
  elapsedSec: number,
  windowSec: number,
  lost: number,
): string {
  let p95: number | null = null;
  for (const r of report.routes) {
    if (r.p95Ms !== null && (p95 === null || r.p95Ms > p95)) p95 = r.p95Ms;
  }
  let errors = 0;
  for (const r of report.routes) errors += r.status.s5xx;
  const n1 = report.nPlusOne.at(0);
  return (
    `t=${Math.round(elapsedSec)}/${windowSec} s — ${report.requests} requête(s)` +
    (report.ws > 0 ? ` (dont ${report.ws} WebSocket)` : "") +
    `, p95 max ${p95 === null ? "—" : `${ms(p95)} ms`}, ${report.nPlusOne.length} N+1` +
    (n1 === undefined ? "" : ` (${n1.route})`) +
    `, ${errors} 5xx, ${lost} perdue(s)`
  );
}
