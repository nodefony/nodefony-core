import {
  ACTION_SELF_PHASE,
  type IProfileReport,
  type IRouteStats,
} from "@nodefony/http";
import { EVENT_LOOP_RESOLUTION_MS } from "nodefony";

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

/**
 * Pire blocage de la boucle d'événements à partir duquel on le signale : au-delà,
 * TOUTES les requêtes en cours ont attendu, quelle que soit leur route.
 */
export const EVENT_LOOP_BLOCK_MS = 100;

/** Lignes maximales par section. */
const MAX_ANOMALIES = 10;
const MAX_ROUTES = 20;
const MAX_SLOW_QUERIES = 10;

/** Requêtes en erreur dont le journal est montré, par route. */
const LOGS_PER_ROUTE = 3;

/** Longueur maximale d'une forme SQL citée. */
const SHAPE_MAX = 300;

/** Les lignes de journal d'une requête, ou la raison pour laquelle on ne les a pas. */
export type RequestLogs =
  | {
      kind: "lines";
      lines: string[];
      /** Lignes lues mais écartées (détail sous WARNING, ou au-delà du plafond). */
      hidden?: number | undefined;
    }
  | { kind: "unavailable"; reason: string };

/** Au nom de qui les requêtes d'un tir ont été jouées. */
export type ShotIdentity =
  | {
      kind: "anonymous";
      /** Pourquoi aucun compte n'a été joué ; `null` quand l'appelant l'a demandé. */
      why: string | null;
    }
  | {
      kind: "account";
      identifier: string;
      roles: readonly string[];
      /** Un autre compte que le propriétaire du jeton (`as`). */
      impersonated: boolean;
    };

/** Ce que le client du tir a reçu, statut par statut. */
export interface IShotClientStatus {
  ok: number;
  redirected: number;
  unauthorized: number;
  forbidden: number;
  clientError: number;
  serverError: number;
  /** Requêtes sans réponse (connexion refusée, délai dépassé). */
  failed: number;
  /** Première destination de redirection reçue. */
  location: string | null;
  /** Première erreur réseau reçue. */
  failure: string | null;
}

/**
 * Le tir de `nodefony_profile_route` : ce que l'outil a envoyé, au nom de qui,
 * et ce que son client a reçu. Absent pour `nodefony_observe`, qui n'envoie rien.
 */
export interface IShotSummary {
  method: "GET" | "HEAD";
  path: string;
  requested: number;
  sent: number;
  concurrency: number;
  identity: ShotIdentity;
  /** Lot de chauffe, tiré AVANT et hors des mesures. */
  warmup: { count: number; p50Ms: number | null; maxMs: number | null };
  client: IShotClientStatus;
  /** Réponses reçues dont le profil n'a pas été retrouvé. */
  missing: number;
  /** Tir arrêté faute de temps, avant d'avoir tout envoyé. */
  truncated: boolean;
  /** Budget de temps du tir, en ms. */
  budgetMs: number;
}

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
  /** Le serveur s'est arrêté pendant la fenêtre (rechargement, arrêt). */
  interrupted: boolean;
  /**
   * Journal des requêtes en erreur, lu au relevé qui les a vues ; `null` quand
   * l'outil n'a pas de quoi le lire.
   */
  errorLogs: ReadonlyMap<string, RequestLogs> | null;
  /** Route à laquelle l'observation était restreinte, s'il y en avait une. */
  route: string | null;
  /** Requêtes écartées par ce filtre de route. */
  filteredRoute: number;
  pid: number;
  uptimeSec: number;
  /**
   * Retard de la boucle d'événements sur la fenêtre (ms), si mesuré : moyen,
   * et pire blocage (qu'une moyenne noie).
   */
  eventLoop: { meanMs: number; maxMs: number } | null;
  /**
   * Variation du tas sur la fenêtre (octets), si mesurée — sans GC forcé : du
   * déchet en attente autant que de la rétention, donc indicative.
   */
  heapDeltaBytes: number | null;
  /** Le tir, quand c'est l'outil qui a envoyé les requêtes. */
  shot?: IShotSummary | undefined;
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

/**
 * Dénominateur de tout ce qui se dit « par requête » : les requêtes servies,
 * la population sur laquelle l'agrégation a cumulé phases et SQL.
 */
function served(r: IRouteStats): number {
  return Math.max(1, r.served);
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
    parts.push([name, total.totalMs / served(r)]);
  }
  if (r.queries.totalMs > 0)
    parts.push(["SQL (cumul)", r.queries.totalMs / served(r)]);
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
        (ids.length === 0
          ? "."
          : `. requestId : ${ids.map((e) => e.requestId).join(", ")}` +
            (ctx.errorLogs === null
              ? '. Journal d\'une requête : `nodefony_admin_call { namespace: "syslog", path: "logs", query: { requestId } }`.'
              : " — journal ci-dessous.")),
    );
  }
  for (const r of report.routes) {
    if (r.p95Ms === null || r.p95Ms < SLOW_ROUTE_P95_MS) continue;
    lines.push(
      `Lente — route ${routeLabel(r)} : p95 ${ms(r.p95Ms)} ms ; par requête : ${topPhases(r)}.`,
    );
  }
  if (ctx.eventLoop !== null && ctx.eventLoop.maxMs >= EVENT_LOOP_BLOCK_MS) {
    lines.push(
      `Boucle d'événements bloquée — jusqu'à ${ms(ctx.eventLoop.maxMs)} ms d'un tenant ` +
        `(retard moyen ${ms(ctx.eventLoop.meanMs)} ms) : un traitement synchrone a gelé ` +
        "le process, et toutes les requêtes en cours ont attendu, quelle que soit leur route." +
        (ctx.uptimeSec < 60
          ? ` Le process a démarré il y a ${Math.round(ctx.uptimeSec)} s : ce blocage peut ` +
            "venir du démarrage (compilation, préparation du front) — rappeler l'outil plus tard pour trancher."
          : ""),
    );
  }
  return lines;
}

/** Durée lisible : en ms sous la seconde, en secondes au-delà. */
function duration(valueMs: number): string {
  return valueMs < 1000
    ? `${Math.round(valueMs)} ms`
    : `${ms(valueMs / 1000)} s`;
}

/** Nom d'une identité de tir, tel que le rapport le cite. */
function identityLabel(identity: ShotIdentity): string {
  if (identity.kind === "anonymous") {
    return identity.why === null ? "anonyme" : `anonyme (${identity.why})`;
  }
  const roles =
    identity.roles.length === 0 ? "aucun rôle" : identity.roles.join(", ");
  return (
    `\`${identity.identifier}\` (${roles})` +
    (identity.impersonated ? ", à la place du propriétaire du jeton" : "")
  );
}

/**
 * Ce qui fait qu'un tir ne mesure pas ce qui était demandé : refus, redirections,
 * profils non retrouvés, budget épuisé. Dit EN TÊTE, avant les chiffres.
 */
function shotGaps(shot: IShotSummary, ctx: IObservationContext): string[] {
  const out: string[] = [];
  const c = shot.client;
  const refused = c.unauthorized + c.forbidden;
  if (refused > 0) {
    out.push(
      `${refused}/${shot.sent} requête(s) REFUSÉE(S) (401×${c.unauthorized}, 403×${c.forbidden}) ` +
        `en tant que ${identityLabel(shot.identity)} — un refus n'est pas une mesure : ` +
        (shot.identity.kind === "anonymous"
          ? "jouer un compte exige un jeton MCP portant le scope admin:write " +
            '(`npx nodefony security:mcp:token --scope "admin:read admin:write" --write`)'
          : "ce compte n'a pas les rôles exigés, ou la zone de ce chemin n'accepte pas " +
            "la session (zone à jeton) — essayer `as` avec un compte autorisé"),
    );
  }
  if (c.redirected > 0) {
    out.push(
      `${c.redirected}/${shot.sent} requête(s) REDIRIGÉE(S)` +
        (c.location === null ? "" : ` vers ${c.location}`) +
        " — les durées mesurent la redirection, pas la page (page protégée vue sans session ?)",
    );
  }
  if (c.failed > 0) {
    out.push(
      `${c.failed} requête(s) sans réponse` +
        (c.failure === null ? "" : ` (${c.failure})`),
    );
  }
  if (shot.missing > 0) {
    out.push(
      `${shot.missing} réponse(s) reçue(s) dont le profil n'a pas été retrouvé : ` +
        "les chiffres portent sur les autres",
    );
  }
  if (shot.truncated && !ctx.cancelled && !ctx.interrupted) {
    out.push(
      `tir arrêté au bout de ${ms(shot.budgetMs / 1000)} s : ${shot.sent} requête(s) ` +
        `envoyée(s) sur ${shot.requested} — réduire count, ou la route est trop lente pour ce volume`,
    );
  }
  return out;
}

/** Ce qui rend l'observation incomplète — à dire avant toute conclusion. */
function gaps(report: IProfileReport, ctx: IObservationContext): string[] {
  const out: string[] = [];
  const shot = ctx.shot;
  if (shot !== undefined) out.push(...shotGaps(shot, ctx));
  if (report.requests === 0 && shot !== undefined) {
    out.push(
      "aucune réponse profilée" +
        (shot.client.failure === null ? "" : ` : ${shot.client.failure}`),
    );
  } else if (report.requests === 0) {
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
      `${report.untimed} requête(s) sans durée (chronométrage coupé par timing.enabled: false)`,
    );
  }
  if (ctx.interrupted) {
    out.push(
      `${shot === undefined ? "observation interrompue" : "tir interrompu"} après ${ms(ctx.elapsedMs / 1000)} s : le serveur s'arrête ` +
        "(rechargement après une modification de fichier ?) — rappeler " +
        (shot === undefined ? "nodefony_observe" : "nodefony_profile_route") +
        " une fois le serveur redémarré, sans modifier de fichier pendant la mesure",
    );
  }
  if (ctx.cancelled) {
    out.push(
      shot === undefined
        ? `observation abandonnée après ${ms(ctx.elapsedMs / 1000)} s sur ${ms(ctx.windowMs / 1000)} s`
        : `tir abandonné après ${ms(ctx.elapsedMs / 1000)} s : ${shot.sent} requête(s) envoyée(s) sur ${shot.requested}`,
    );
  }
  return out;
}

/** La raison commune quand TOUTES les lectures de journal ont échoué, sinon `null`. */
function sameUnavailableReason(
  logs: ReadonlyMap<string, RequestLogs> | null,
): string | null {
  if (logs === null || logs.size === 0) return null;
  let reason: string | null = null;
  for (const one of logs.values()) {
    if (one.kind !== "unavailable") return null;
    if (reason !== null && one.reason !== reason) return null;
    reason = one.reason;
  }
  return reason;
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

  // « ok » se mérite sur des requêtes SERVIES : des refus seuls ne disent
  // rien du temps de réponse.
  const servedTotal = report.routes.reduce((n, r) => n + r.served, 0);
  const verdict =
    found.length > 0
      ? `anomalies (${found.length})`
      : servedTotal > 0
        ? "ok"
        : "rien à juger";
  out.push(
    `Verdict : ${verdict}` +
      (missing.length > 0
        ? " — observation INCOMPLÈTE"
        : " — observation complète"),
  );
  for (const m of missing) out.push(`⚠️ ${m}.`);

  const shot = ctx.shot;
  if (shot !== undefined) {
    const w = shot.warmup;
    const c = shot.client;
    out.push(
      `Tir : ${shot.sent}/${shot.requested} requête(s) ${shot.method} ${shot.path} · ` +
        `concurrence ${shot.concurrency} · ${duration(ctx.elapsedMs)} · ` +
        (w.count === 0
          ? "sans chauffe"
          : `chauffe de ${w.count} requête(s) hors mesures (p50 ${w.p50Ms === null ? "—" : ms(w.p50Ms)} ms, max ${w.maxMs === null ? "—" : ms(w.maxMs)} ms)`),
      `Joué en tant que : ${identityLabel(shot.identity)}`,
      `Reçu par le client : 2xx ${c.ok} · 3xx ${c.redirected} · 401 ${c.unauthorized} · ` +
        `403 ${c.forbidden} · autres 4xx ${c.clientError} · 5xx ${c.serverError} · sans réponse ${c.failed}`,
    );
  } else
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
  if (ctx.eventLoop === null && ctx.shot !== undefined) {
    process.push(
      `boucle d'événements : non mesurée (tir trop court pour la sonde, qui échantillonne toutes les ${EVENT_LOOP_RESOLUTION_MS} ms)`,
    );
  } else if (ctx.eventLoop !== null) {
    process.push(
      `boucle d'événements : retard moyen ${ms(ctx.eventLoop.meanMs)} ms, pire blocage ${ms(ctx.eventLoop.maxMs)} ms`,
    );
  }
  if (ctx.heapDeltaBytes !== null) {
    const mo = ctx.heapDeltaBytes / (1024 * 1024);
    process.push(
      `tas ${mo >= 0 ? "+" : ""}${mo.toFixed(1)} Mo (indicatif, sans GC)`,
    );
  }
  out.push(`Process : ${process.join(" · ")}`);

  const refused = report.routes.filter(
    (r) => r.status.unauthorized + r.status.forbidden > 0,
  );
  if (refused.length > 0 && shot === undefined) {
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

  const closed = sameUnavailableReason(ctx.errorLogs);
  if (closed !== null) {
    // Toutes les lectures ont échoué pour la MÊME raison : la dire une fois.
    out.push("", `Journal des requêtes en erreur : non lu — ${closed}.`);
  } else if (ctx.errorLogs !== null && ctx.errorLogs.size > 0) {
    out.push(
      "",
      "Journal des requêtes en erreur (syslog de l'application, lu au relevé qui les a vues) :",
    );
    // Trois requêtes par route suffisent à montrer l'erreur : la dixième
    // occurrence du même plantage n'apprend rien à l'agent.
    const shown = new Map<string, number>();
    for (const e of report.errors) {
      const logs = ctx.errorLogs.get(e.requestId);
      if (logs === undefined) continue;
      const already = shown.get(e.route) ?? 0;
      if (already >= LOGS_PER_ROUTE) continue;
      shown.set(e.route, already + 1);
      out.push(
        `- requestId ${e.requestId} — route \`${e.route}\`, statut ${e.status ?? "—"} :`,
      );
      if (logs.kind === "unavailable") {
        out.push(`    (journal non lu : ${logs.reason})`);
      } else if (logs.lines.length === 0) {
        out.push(
          (logs.hidden ?? 0) > 0
            ? `    (${logs.hidden} ligne(s) de détail écartée(s), aucune de niveau WARNING ou plus grave)`
            : "    (aucune ligne retrouvée : déjà évincée du tampon de relecture du syslog, ou rien journalisé)",
        );
      } else {
        for (const line of logs.lines) out.push(`    ${line}`);
      }
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
      const sqlAvg = r.queries.total / served(r);
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
        sqlPerReq: Math.round((r.queries.total / served(r)) * 10) / 10,
        actionSelfMs:
          r.phases[ACTION_SELF_PHASE] === undefined
            ? null
            : Math.round(
                (r.phases[ACTION_SELF_PHASE].totalMs / served(r)) * 100,
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
