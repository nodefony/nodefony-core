import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  ADMIN_SCOPE_WRITE,
  EVENT_LOOP_RESOLUTION_MS,
  ProcessProbe,
  type IMcpCaller,
  type IMcpTool,
  type IMcpToolResult,
  type IMcpToolRun,
} from "nodefony";
import { mcpText, MCP_RESERVED_PREFIX } from "@nodefony/ai";
import {
  aggregateProfiles,
  isFailedProfile,
  N_PLUS_ONE_MIN_REPEATS,
  type IProfilerReader,
  type ProfileEntry,
} from "@nodefony/http";
import { OBSERVE_ERROR_LOGS_MAX, type IObserveProbe } from "./observe";
import {
  renderProfileReport,
  SLOW_ROUTE_P95_MS,
  type IShotClientStatus,
  type RequestLogs,
  type ShotIdentity,
} from "./profileReport";
import {
  createShotClient,
  SHOT_REQUEST_TIMEOUT_MS,
  type IShotClient,
  type IShotTarget,
} from "./shotClient";
import { watchToolStop, type OnShutdown } from "./shutdown";
import { PROFILE_TICKET_HEADER } from "../src/profileTicket";
import { PROFILE_SESSION_PATH } from "../src/profileSession";

/** Requêtes mesurées par défaut. */
export const PROFILE_ROUTE_DEFAULT_COUNT = 50;

/**
 * Requêtes mesurées au plus. Avec la chauffe, sous les 500 profils que garde le
 * profileur : au-delà, les premiers seraient évincés avant d'être lus.
 */
export const PROFILE_ROUTE_MAX_COUNT = 200;

/** Requêtes simultanées par défaut. */
export const PROFILE_ROUTE_DEFAULT_CONCURRENCY = 4;

/** Requêtes simultanées au plus : mesurer une route, pas saturer le process. */
export const PROFILE_ROUTE_MAX_CONCURRENCY = 8;

/** Requêtes de chauffe par défaut, tirées AVANT et hors des mesures. */
export const PROFILE_ROUTE_DEFAULT_WARMUP = 3;

/** Requêtes de chauffe au plus. */
export const PROFILE_ROUTE_MAX_WARMUP = 20;

/**
 * Budget de temps d'un tir, en ms. Sous les 60 s qu'un client MCP attend par
 * défaut : au-delà, l'agent couperait l'appel juste avant le rapport.
 */
export const PROFILE_ROUTE_BUDGET_MS = 45_000;

/**
 * Attente maximale, en ms, d'un profil après la réponse : le profileur le
 * collecte au `close` de la réponse, émis en différé — rien ne garantit qu'il
 * précède la fin de lecture côté client, dans le même process.
 */
export const PROFILE_COLLECT_WAIT_MS = 500;

/**
 * Périodes d'échantillonnage de la boucle d'événements en deçà desquelles la
 * sonde n'a rien mesuré de fiable : un tir plus court rend « non mesurée »,
 * jamais un 0 qui passerait pour une boucle libre.
 */
const EVENT_LOOP_MIN_PERIODS = 5;

/** Longueur maximale d'un chemin profilé. */
const PROFILE_PATH_MAX = 2048;

/** Instantanés de progression par tir, au plus. */
const PROGRESS_STEPS = 10;

const LOOPBACK_BASE = "http://127.0.0.1";

/**
 * Le contrat de l'outil tel que l'agent le lit dans `tools/list`. Les bornes
 * citées sont les constantes du code. Composée une fois, au chargement.
 */
const PROFILE_ROUTE_DESCRIPTION =
  "Mesure UNE route de l'application Nodefony qui tourne : l'outil lui envoie " +
  "lui-même N requêtes, retrouve leurs profils par l'identifiant qu'il pose " +
  "(x-request-id) et rend le même rapport que nodefony_observe — p50/p95, " +
  "requêtes SQL par requête, N+1, où part le temps (action.self, SQL, render, " +
  "firewall), erreurs. Ferme la boucle « je modifie → je mesure » en un appel.\n\n" +
  "QUAND : après avoir modifié le contrôleur, le service ou la requête d'une " +
  "page ; pour comparer avant/après ; face à « cette page est lente » ou " +
  "« trop de requêtes SQL ». Pour observer un trafic que l'on génère soi-même " +
  "(tests, navigation), prendre nodefony_observe.\n\n" +
  "COMMENT :\n" +
  "1. path = un CHEMIN de l'application avec sa requête (`/orders?page=2`), " +
  "jamais une URL : hôte, schéma et `//` sont refusés.\n" +
  `2. count (défaut ${PROFILE_ROUTE_DEFAULT_COUNT}, max ${PROFILE_ROUTE_MAX_COUNT}), ` +
  `concurrency (défaut ${PROFILE_ROUTE_DEFAULT_CONCURRENCY}, max ${PROFILE_ROUTE_MAX_CONCURRENCY}), ` +
  `warmup (défaut ${PROFILE_ROUTE_DEFAULT_WARMUP}, max ${PROFILE_ROUTE_MAX_WARMUP} : ` +
  "requêtes tirées avant, hors mesures — le premier appel compile et se connecte), " +
  "method GET (défaut) ou HEAD.\n" +
  "3. IDENTITÉ — une page protégée vue sans compte ne rend que des refus. Par " +
  "défaut l'outil joue le PROPRIÉTAIRE du jeton MCP si ce jeton porte le scope " +
  `${ADMIN_SCOPE_WRITE} : il ouvre une session à son nom (tous ses rôles), ` +
  'tire avec, puis la détruit. `as: "<identifiant>"` joue un autre compte ' +
  `(scope ${ADMIN_SCOPE_WRITE}, et ses rôles doivent être inclus dans ceux du ` +
  "propriétaire). `anonymous: true` force l'anonyme. Sans ce scope : anonyme, " +
  "et le rapport dit comment obtenir le jeton.\n" +
  "4. Corriger la cause nommée, rappeler l'outil avec les mêmes arguments et " +
  "comparer le bloc « Données (JSON) ».\n" +
  "Ne modifier AUCUN fichier pendant le tir : le serveur redémarre et le " +
  "rapport rendu est partiel (il le dit).\n\n" +
  "LE RAPPORT : en tête, ce qui invalide la mesure — requêtes REFUSÉES " +
  "(401/403), REDIRIGÉES (page de connexion), sans réponse, profils non " +
  "retrouvés ; puis le tir (identité jouée, chauffe, statuts reçus), les " +
  `anomalies (« N+1 » : même requête SQL ≥ ${N_PLUS_ONE_MIN_REPEATS} fois par requête ; ` +
  `« Lente » : p95 ≥ ${SLOW_ROUTE_P95_MS} ms ; « Erreurs » 5xx avec leur journal), ` +
  "le tableau par route et les requêtes SQL les plus coûteuses (valeurs masquées).\n\n" +
  "LIMITES : développement seulement ; GET et HEAD seulement ; HTTP en clair de " +
  "l'application elle-même. Les zones à jeton (jwt, external-jwt) ne sont pas " +
  `jouées : leurs requêtes rendent 401, et le rapport le dit. Tir borné à ${PROFILE_ROUTE_BUDGET_MS / 1000} s, ` +
  `${SHOT_REQUEST_TIMEOUT_MS / 1000} s par requête. Un instantané de progression par lot.`;

/** Verdict de la comparaison des rôles de deux comptes. */
export type RolesVerdict = { ok: true } | { ok: false; reason: string };

/** Ce dont l'outil a besoin — injecté, pour l'éprouver sans application. */
export interface IProfileRouteDeps {
  /** Le profileur de l'application, ou `undefined` hors développement. */
  getProfiler: () => IProfilerReader | undefined;
  /** L'adresse d'écoute HTTP en clair de l'application, ou `null`. */
  getTarget: () => IShotTarget | null;
  /** Fabrique du client du tir (défaut : `node:http`, cf {@link createShotClient}). */
  createClient?:
    ((target: IShotTarget, concurrency: number) => IShotClient) | undefined;
  /** Fabrique de la sonde du process (défaut : `ProcessProbe` du cœur). */
  createProbe?: (() => IObserveProbe) | undefined;
  /** Émet le ticket à usage unique qui ouvrira la session de `identifier`. */
  issueTicket?: ((identifier: string) => string) | undefined;
  /** Détruit la session de profilage désignée par son pseudonyme. */
  closeSession?: ((ref: string) => Promise<unknown>) | undefined;
  /** Les rôles de `target` sont-ils inclus dans ceux de `owner` (hiérarchie comprise) ? */
  rolesWithin?:
    ((owner: string, target: string) => Promise<RolesVerdict>) | undefined;
  /** Lit les lignes de journal d'une requête en erreur. */
  readRequestLogs?:
    | ((requestId: string, caller: IMcpCaller) => Promise<RequestLogs>)
    | undefined;
  /** S'abonne à l'arrêt du serveur pour la durée d'un appel. */
  onShutdown?: OnShutdown | undefined;
  /** Attente d'un profil après sa réponse (défaut {@link PROFILE_COLLECT_WAIT_MS}). */
  collectWaitMs?: number | undefined;
  /** Budget du tir (défaut {@link PROFILE_ROUTE_BUDGET_MS}). */
  budgetMs?: number | undefined;
}

/**
 * Contrôle le chemin à profiler : un CHEMIN de l'application, jamais une URL —
 * l'outil ne doit pouvoir viser qu'elle.
 *
 * @param raw - l'argument `path`, non fiable.
 * @returns le chemin normalisé (fragment retiré), ou la raison du refus.
 */
export function checkProfilePath(
  raw: unknown,
): { ok: true; path: string } | { ok: false; reason: string } {
  if (typeof raw !== "string" || raw.length === 0) {
    return {
      ok: false,
      reason:
        "path est requis : un chemin de l'application, ex. /orders?page=2",
    };
  }
  if (raw.length > PROFILE_PATH_MAX) {
    return {
      ok: false,
      reason: `path dépasse ${PROFILE_PATH_MAX} caractères`,
    };
  }
  if (
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    /[\\\s\u0000-\u001f\u007f]/u.test(raw)
  ) {
    return {
      ok: false,
      reason:
        "path doit être un CHEMIN commençant par un seul « / », sans antislash, " +
        "espace ni caractère de contrôle — jamais une URL ni un hôte : l'outil ne " +
        "vise que l'application",
    };
  }
  const url = new URL(raw, LOOPBACK_BASE);
  if (url.origin !== LOOPBACK_BASE) {
    return { ok: false, reason: "path sort de l'application" };
  }
  return { ok: true, path: url.pathname + url.search };
}

/** Entier borné — et la remarque à faire s'il a été corrigé. */
function readBounded(
  raw: unknown,
  name: string,
  fallback: number,
  min: number,
  max: number,
): { value: number; note: string | null } {
  if (raw === undefined) return { value: fallback, note: null };
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { value: fallback, note: `${name} illisible, ${fallback} retenu` };
  }
  const value = Math.min(Math.max(Math.round(raw), min), max);
  return {
    value,
    note:
      value === raw ? null : `${name} ramené à ${value} (bornes ${min}–${max})`,
  };
}

/** L'identité à jouer, ou le refus à rendre à l'agent. */
async function resolveIdentity(
  args: Record<string, unknown>,
  caller: IMcpCaller,
  deps: IProfileRouteDeps,
): Promise<
  | { ok: true; identity: ShotIdentity; account: string | null }
  | { ok: false; message: string }
> {
  if (args.anonymous === true) {
    return {
      ok: true,
      identity: { kind: "anonymous", why: null },
      account: null,
    };
  }
  const owner =
    caller.authenticated &&
    typeof caller.subject === "string" &&
    caller.subject.length > 0 &&
    caller.scopes.includes(ADMIN_SCOPE_WRITE)
      ? caller.subject
      : null;
  const as = typeof args.as === "string" && args.as.length > 0 ? args.as : null;
  if (as !== null) {
    if (owner === null) {
      return {
        ok: false,
        message:
          `\`as\` exige un jeton MCP portant le scope ${ADMIN_SCOPE_WRITE} : jouer un ` +
          "compte, c'est agir en son nom. Jeton : " +
          '`npx nodefony security:mcp:token --scope "admin:read admin:write" --write`.',
      };
    }
    if (as !== owner) {
      const verdict: RolesVerdict =
        deps.rolesWithin === undefined
          ? { ok: false, reason: "comparaison des rôles indisponible" }
          : await deps.rolesWithin(owner, as);
      if (!verdict.ok) {
        return {
          ok: false,
          message:
            `\`as: "${as}"\` refusé — ${verdict.reason}. Jouer un autre compte ne ` +
            "doit jamais monter en droits : ses rôles doivent être inclus dans ceux " +
            `du propriétaire du jeton (\`${owner}\`).`,
        };
      }
    }
    return {
      ok: true,
      identity: { kind: "anonymous", why: null },
      account: as,
    };
  }
  if (owner !== null) {
    return {
      ok: true,
      identity: { kind: "anonymous", why: null },
      account: owner,
    };
  }
  return {
    ok: true,
    account: null,
    identity: {
      kind: "anonymous",
      why: caller.authenticated
        ? `le jeton MCP n'a pas le scope ${ADMIN_SCOPE_WRITE}`
        : "appel sans jeton MCP",
    },
  };
}

/** Session ouverte pour le tir. */
interface IShotSession {
  cookie: string;
  ref: string;
  identifier: string;
  roles: readonly string[];
}

/** Lit la réponse de la route de connexion du profilage, sans lui faire confiance. */
function readSessionBody(body: string | null):
  | {
      identifier: string;
      roles: readonly string[];
      ref: string;
    }
  | { message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body ?? "");
  } catch {
    return { message: "réponse illisible" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { message: "réponse illisible" };
  }
  if (
    "identifier" in parsed &&
    typeof parsed.identifier === "string" &&
    "ref" in parsed &&
    typeof parsed.ref === "string"
  ) {
    const roles =
      "roles" in parsed && Array.isArray(parsed.roles)
        ? parsed.roles.filter(
            (r: unknown): r is string => typeof r === "string",
          )
        : [];
    return { identifier: parsed.identifier, roles, ref: parsed.ref };
  }
  return {
    message:
      "message" in parsed && typeof parsed.message === "string"
        ? parsed.message
        : "réponse sans compte",
  };
}

/** Ouvre la session du tir par la route de connexion du profilage. */
async function openShotSession(
  client: IShotClient,
  issueTicket: (identifier: string) => string,
  account: string,
  signal: AbortSignal,
): Promise<
  { ok: true; session: IShotSession } | { ok: false; message: string }
> {
  let ticket: string;
  try {
    ticket = issueTicket(account);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const res = await client.send(
    {
      method: "POST",
      path: PROFILE_SESSION_PATH,
      headers: { [PROFILE_TICKET_HEADER]: ticket },
      readBody: true,
    },
    signal,
  );
  const read = readSessionBody(res.body);
  if (res.status !== 200 || "message" in read) {
    const why = "message" in read ? read.message : `statut ${res.status}`;
    return {
      ok: false,
      message:
        `session de profilage non ouverte pour \`${account}\` (${res.status} — ${why}). ` +
        (res.status === 403
          ? "Compte inconnu, inactif ou verrouillé ?"
          : res.status === 503
            ? ""
            : "La route de connexion du profilage répond-elle ?"),
    };
  }
  const cookie = res.setCookie
    .map((c) => c.split(";", 1)[0] ?? "")
    .filter((c) => c.length > 0)
    .join("; ");
  if (cookie.length === 0) {
    return {
      ok: false,
      message: `session ouverte pour \`${account}\`, mais aucun cookie reçu`,
    };
  }
  return {
    ok: true,
    session: {
      cookie,
      ref: read.ref,
      identifier: read.identifier,
      roles: read.roles,
    },
  };
}

/** Ce qu'une requête du tir a donné, vu du client. */
interface IShotOutcome {
  requestId: string;
  status: number | null;
}

/** Comptes du client, mis à jour réponse par réponse. */
function emptyClientStatus(): IShotClientStatus {
  return {
    ok: 0,
    redirected: 0,
    unauthorized: 0,
    forbidden: 0,
    clientError: 0,
    serverError: 0,
    failed: 0,
    location: null,
    failure: null,
  };
}

function countStatus(
  c: IShotClientStatus,
  status: number,
  location: string | null,
): void {
  if (status === 401) c.unauthorized += 1;
  else if (status === 403) c.forbidden += 1;
  else if (status >= 500) c.serverError += 1;
  else if (status >= 400) c.clientError += 1;
  else if (status >= 300) {
    c.redirected += 1;
    c.location ??= location;
  } else c.ok += 1;
}

/** Le tir proprement dit : un groupe de requêtes, `concurrency` à la fois. */
async function fire(
  client: IShotClient,
  ids: readonly string[],
  opts: {
    method: "GET" | "HEAD";
    path: string;
    headers: Readonly<Record<string, string>>;
    concurrency: number;
    signal: AbortSignal;
    deadline: number;
    status: IShotClientStatus | null;
    onDone?: ((done: number) => void) | undefined;
  },
): Promise<{ outcomes: IShotOutcome[]; truncated: boolean }> {
  const outcomes: IShotOutcome[] = [];
  let next = 0;
  let truncated = false;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (opts.signal.aborted) return;
      if (performance.now() >= opts.deadline) {
        truncated = next < ids.length;
        return;
      }
      const index = next;
      next += 1;
      const requestId = ids[index];
      if (requestId === undefined) return;
      try {
        const res = await client.send(
          {
            method: opts.method,
            path: opts.path,
            headers: { ...opts.headers, "x-request-id": requestId },
          },
          opts.signal,
        );
        outcomes.push({ requestId, status: res.status });
        if (opts.status !== null)
          countStatus(opts.status, res.status, res.location);
      } catch (error) {
        // Une requête avortée (l'agent part, le serveur s'arrête) n'est pas
        // une réponse manquante : le tir s'arrête là.
        if (error instanceof Error && error.name === "AbortError") return;
        outcomes.push({ requestId, status: null });
        if (opts.status !== null) {
          opts.status.failed += 1;
          opts.status.failure ??=
            error instanceof Error ? error.message : String(error);
        }
      }
      opts.onDone?.(outcomes.length);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency }, worker));
  return { outcomes, truncated };
}

/**
 * Retrouve les profils des requêtes tirées, par leur identifiant. Un profil
 * peut arriver APRÈS la réponse : attente bornée, puis le reste est compté.
 */
async function collectProfiles(
  profiler: IProfilerReader,
  outcomes: readonly IShotOutcome[],
  waitMs: number,
): Promise<{ entries: ProfileEntry[]; missing: number }> {
  const entries: ProfileEntry[] = [];
  let pending: string[] = [];
  for (const o of outcomes) {
    if (o.status === null) continue;
    const entry = profiler.get(o.requestId);
    if (entry === undefined) pending.push(o.requestId);
    else entries.push(entry);
  }
  const deadline = performance.now() + waitMs;
  while (pending.length > 0 && performance.now() < deadline) {
    await delay(10);
    pending = pending.filter((id) => {
      const entry = profiler.get(id);
      if (entry === undefined) return true;
      entries.push(entry);
      return false;
    });
  }
  return { entries, missing: pending.length };
}

/**
 * L'outil `nodefony_profile_route` : envoie lui-même N requêtes à une route de
 * l'application, au nom d'un compte s'il le faut, et rend leur profil agrégé.
 *
 * Rien n'est armé hors d'un appel : le client du tir (ses connexions), la
 * session de profilage et l'écoute de l'arrêt du serveur naissent avec l'appel
 * et sont libérés à sa sortie, quelle qu'elle soit.
 *
 * @param deps - profileur, adresse d'écoute, ouverture de session, journal.
 */
export function profileRouteTool(deps: IProfileRouteDeps): IMcpTool {
  return {
    name: `${MCP_RESERVED_PREFIX}profile_route`,
    annotations: {
      // L'outil ÉMET des requêtes : une application mal écrite peut traiter un
      // GET comme une écriture. Sûres et idempotentes au sens de RFC 9110.
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description: PROFILE_ROUTE_DESCRIPTION,
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description:
            "CHEMIN de l'application, requête comprise (`/orders?page=2`) — jamais une URL",
        },
        count: {
          type: "integer",
          minimum: 1,
          maximum: PROFILE_ROUTE_MAX_COUNT,
          description: `Requêtes mesurées (défaut ${PROFILE_ROUTE_DEFAULT_COUNT}, max ${PROFILE_ROUTE_MAX_COUNT})`,
        },
        concurrency: {
          type: "integer",
          minimum: 1,
          maximum: PROFILE_ROUTE_MAX_CONCURRENCY,
          description: `Requêtes simultanées (défaut ${PROFILE_ROUTE_DEFAULT_CONCURRENCY}, max ${PROFILE_ROUTE_MAX_CONCURRENCY})`,
        },
        warmup: {
          type: "integer",
          minimum: 0,
          maximum: PROFILE_ROUTE_MAX_WARMUP,
          description: `Requêtes de chauffe, hors mesures (défaut ${PROFILE_ROUTE_DEFAULT_WARMUP}, max ${PROFILE_ROUTE_MAX_WARMUP})`,
        },
        method: {
          type: "string",
          enum: ["GET", "HEAD"],
          description: "Méthode (défaut GET)",
        },
        as: {
          type: "string",
          description: `Identifiant du compte à jouer (scope ${ADMIN_SCOPE_WRITE} ; rôles inclus dans ceux du propriétaire du jeton)`,
        },
        anonymous: {
          type: "boolean",
          description:
            "Jouer en anonyme, même avec un jeton qui permettrait un compte",
        },
      },
    },
    handler: async (args, caller, run) => {
      const profiler = deps.getProfiler();
      if (profiler === undefined) {
        return mcpText(
          "Aucun profileur dans cette application : il n'existe qu'en " +
            "développement, et seulement si `@nodefony/http` est chargé.",
          true,
        );
      }
      const path = checkProfilePath(args.path);
      if (!path.ok) return mcpText(`Refusé : ${path.reason}.`, true);
      if (
        args.method !== undefined &&
        args.method !== "GET" &&
        args.method !== "HEAD"
      ) {
        return mcpText(
          "Refusé : method vaut GET ou HEAD — les seules méthodes sûres et " +
            "idempotentes (RFC 9110) ; l'outil ne déclenche aucune écriture.",
          true,
        );
      }
      const target = deps.getTarget();
      if (target === null) {
        return mcpText(
          "Aucun serveur HTTP en clair prêt dans cette application : rien à viser.",
          true,
        );
      }
      const identity = await resolveIdentity(args, caller, deps);
      if (!identity.ok) return mcpText(identity.message, true);
      const count = readBounded(
        args.count,
        "count",
        PROFILE_ROUTE_DEFAULT_COUNT,
        1,
        PROFILE_ROUTE_MAX_COUNT,
      );
      const concurrency = readBounded(
        args.concurrency,
        "concurrency",
        PROFILE_ROUTE_DEFAULT_CONCURRENCY,
        1,
        PROFILE_ROUTE_MAX_CONCURRENCY,
      );
      const warmup = readBounded(
        args.warmup,
        "warmup",
        PROFILE_ROUTE_DEFAULT_WARMUP,
        0,
        PROFILE_ROUTE_MAX_WARMUP,
      );
      const notes = [count.note, concurrency.note, warmup.note].filter(
        (n): n is string => n !== null,
      );
      return profileRoute(profiler, target, deps, {
        method: args.method === "HEAD" ? "HEAD" : "GET",
        path: path.path,
        count: count.value,
        concurrency: concurrency.value,
        warmup: warmup.value,
        identity: identity.identity,
        account: identity.account,
        caller,
        run,
        notes,
      });
    },
  };
}

interface IProfileRouteRun {
  method: "GET" | "HEAD";
  path: string;
  count: number;
  concurrency: number;
  warmup: number;
  identity: ShotIdentity;
  account: string | null;
  caller: IMcpCaller;
  run: IMcpToolRun | undefined;
  notes: string[];
}

async function profileRoute(
  profiler: IProfilerReader,
  target: IShotTarget,
  deps: IProfileRouteDeps,
  opts: IProfileRouteRun,
): Promise<IMcpToolResult> {
  const stop = watchToolStop(opts.run, deps.onShutdown);
  const client = (deps.createClient ?? createShotClient)(
    target,
    opts.concurrency,
  );
  const probe = (
    deps.createProbe ?? ((): IObserveProbe => new ProcessProbe())
  )();
  const budgetMs = deps.budgetMs ?? PROFILE_ROUTE_BUDGET_MS;
  const started = performance.now();
  const deadline = started + budgetMs;
  const runId = randomBytes(4).toString("hex");
  const ids = (prefix: string, n: number): string[] =>
    Array.from({ length: n }, (_, i) => `nf-prof-${runId}-${prefix}${i + 1}`);
  let session: IShotSession | null = null;
  let identity = opts.identity;
  try {
    // ─── Identité : la session du compte, ouverte par le vrai circuit ───────
    const headers: Record<string, string> = {
      "user-agent": "nodefony-profile-route",
    };
    if (opts.account !== null) {
      if (deps.issueTicket === undefined) {
        return mcpText(
          "Profilage authentifié indisponible : aucun émetteur de ticket.",
          true,
        );
      }
      const opened = await openShotSession(
        client,
        deps.issueTicket,
        opts.account,
        stop.signal,
      );
      if (!opened.ok) return mcpText(opened.message, true);
      session = opened.session;
      headers.cookie = session.cookie;
      identity = {
        kind: "account",
        identifier: session.identifier,
        roles: session.roles,
        impersonated: opts.caller.subject !== opts.account,
      };
    }

    probe.read(); // référence : la sonde mesure depuis son dernier relevé
    const probeStart = performance.now();
    const shared = {
      method: opts.method,
      path: opts.path,
      headers,
      concurrency: opts.concurrency,
      signal: stop.signal,
      deadline,
    };
    // ─── Chauffe : compilation, connexions, caches — hors mesures ───────────
    const warm = await fire(client, ids("w", opts.warmup), {
      ...shared,
      status: null,
    });
    // ─── Tir mesuré ──────────────────────────────────────────────────────────
    const status = emptyClientStatus();
    const step = Math.max(1, Math.ceil(opts.count / PROGRESS_STEPS));
    let ticks = 0;
    opts.run?.progress(
      0,
      opts.count,
      `tir de ${opts.count} requête(s) ${opts.method} ${opts.path}`,
    );
    const shot = await fire(client, ids("", opts.count), {
      ...shared,
      status,
      onDone: (done) => {
        if (done % step !== 0 && done !== opts.count) return;
        ticks += 1;
        opts.run?.progress(
          done,
          opts.count,
          `${done}/${opts.count} · 2xx ${status.ok} · refus ${status.unauthorized + status.forbidden} · 5xx ${status.serverError}`,
        );
      },
    });
    const health = probe.read();
    const probedMs = performance.now() - probeStart;
    const waitMs = deps.collectWaitMs ?? PROFILE_COLLECT_WAIT_MS;
    const warmed = await collectProfiles(profiler, warm.outcomes, waitMs);
    const measured = await collectProfiles(profiler, shot.outcomes, waitMs);
    const warmRoute = aggregateProfiles(warmed.entries, {
      includeTooling: true,
    }).routes[0];
    const report = aggregateProfiles(measured.entries, {
      includeTooling: true,
    });

    let errorLogs: Map<string, RequestLogs> | null = null;
    const read = deps.readRequestLogs;
    if (read !== undefined) {
      errorLogs = new Map();
      for (const entry of measured.entries) {
        if (errorLogs.size >= OBSERVE_ERROR_LOGS_MAX) break;
        if (!isFailedProfile(entry)) continue;
        errorLogs.set(
          entry.requestId,
          await read(entry.requestId, opts.caller).catch((): RequestLogs => ({
            kind: "unavailable",
            reason: "la lecture du journal a échoué",
          })),
        );
      }
    }

    const elapsedMs = performance.now() - started;
    const text = renderProfileReport(report, {
      windowMs: elapsedMs,
      elapsedMs,
      ticks,
      lost: 0,
      cancelled: stop.signal.aborted && !stop.interrupted,
      interrupted: stop.interrupted,
      errorLogs,
      route: null,
      filteredRoute: 0,
      pid: process.pid,
      uptimeSec: process.uptime(),
      eventLoop:
        probedMs < EVENT_LOOP_RESOLUTION_MS * EVENT_LOOP_MIN_PERIODS
          ? null
          : { meanMs: health.eventLoopMs, maxMs: health.eventLoopMaxMs },
      heapDeltaBytes: null,
      shot: {
        method: opts.method,
        path: opts.path,
        requested: opts.count,
        sent: shot.outcomes.length,
        concurrency: opts.concurrency,
        identity,
        warmup: {
          count: warm.outcomes.length,
          p50Ms: warmRoute?.p50Ms ?? null,
          maxMs: warmRoute?.maxMs ?? null,
        },
        client: status,
        missing: measured.missing,
        truncated: shot.truncated || warm.truncated,
        budgetMs,
      },
    });
    return mcpText(
      opts.notes.length === 0 ? text : `ℹ️ ${opts.notes.join(" · ")}.\n${text}`,
    );
  } finally {
    client.close();
    probe.dispose();
    if (session !== null && deps.closeSession !== undefined) {
      await deps.closeSession(session.ref).catch(() => undefined);
    }
    stop.release();
  }
}
