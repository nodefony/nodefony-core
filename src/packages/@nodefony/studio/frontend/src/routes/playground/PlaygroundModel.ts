/**
 * PlaygroundModel — types MIROIR du data plane
 * `GET /nodefony/framework/api/playground/routes` (`PlaygroundAdminApi.ts` côté
 * framework) + helpers PURS (0 JSX). Frontière isomorphe : jamais d'import
 * runtime d'un module serveur — le contrat vit dans ce miroir local.
 */

/** Un paramètre décoré d'une action (`@Param`/`@Body`/`@Query`…). */
export interface PlaygroundParam {
  source: string;
  key: string | null;
  index: number;
  stream: boolean;
}

/** Gardes déclaratives d'une action (badges + comportement du formulaire). */
export interface PlaygroundGuards {
  security: {
    clauses: { anyOf: string[]; subjectParam: string | null }[];
  } | null;
  scopes: string[];
  idempotent: { required: boolean } | null;
  csrfProtect: boolean;
  csrfExempt: boolean;
  session: unknown;
  bypassFirewall: boolean;
}

/** Une action invocable (1 route du Router). */
export interface PlaygroundAction {
  route: string;
  path: string | null;
  methods: string[];
  duplex: boolean;
  action: string | null;
  variables: string[];
  defaults: Record<string, unknown>;
  params: PlaygroundParam[];
  guards: PlaygroundGuards;
}

/** Un controller et ses actions. */
export interface PlaygroundController {
  name: string;
  module: string | null;
  actions: PlaygroundAction[];
}

/** Snapshot complet du data plane playground. */
export interface PlaygroundSnapshot {
  controllers: PlaygroundController[];
}

/** Résultat d'UNE exécution (une porte : HTTP ou socket). */
export interface ExecResult {
  transport: "http" | "socket";
  /** Statut HTTP (ou équivalent via `RpcError.data.status`) — `null` = transport KO. */
  status: number | null;
  ok: boolean;
  durationMs: number;
  body: unknown;
  /** Message d'erreur transport/réseau (pas une réponse serveur). */
  error: string | null;
  /** Instance qui a répondu (`x-nodefony-instance`) — HTTP seulement. */
  instance: string | null;
  /**
   * `x-request-id` de la réponse — la CLÉ de la radiographie : le serveur
   * l'émet sur chaque réponse, le Profiler indexe son profil dessus.
   * `null` sur la porte socket (le pont ne trace pas encore par frame).
   */
  requestId: string | null;
}

/** Méthodes HTTP jouables d'une action (transports moins WEBSOCKET/ANY). */
export function httpMethodsOf(action: PlaygroundAction): string[] {
  return action.methods.filter((m) => m !== "WEBSOCKET" && m !== "ANY");
}

/** Vrai si la méthode porte un corps (formulaire body affiché). */
export function isMutation(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

/**
 * Construit l'URL d'exécution : remplace chaque `{var}` du path par sa valeur
 * (encodée), ajoute la query string des champs non vides.
 */
export function buildUrl(
  path: string,
  vars: Record<string, string>,
  query: Record<string, string>,
): string {
  let url = path.replace(/\{([^}]+)\}/g, (_m, name: string) =>
    encodeURIComponent(vars[name] ?? ""),
  );
  const qs = Object.entries(query)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  if (qs) url += `${url.includes("?") ? "&" : "?"}${qs}`;
  return url;
}

/** Clé d'idempotence unique (UUID v4 ; fallback hors secure-context dev). */
export function makeIdempotencyKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Message FR honnête pour l'échec du fetch du snapshot playground.
 * Le 404 est le cas NOMINAL hors dev : le data plane n'est pas monté.
 */
export function describePlaygroundError(e: unknown): string {
  const status = (e as { status?: number }).status;
  if (status === 404) {
    return "Playground non monté : cette console n'existe qu'en développement (elle exécute des actions réelles).";
  }
  if (status === 401) return "Session expirée — reconnectez-vous.";
  if (status === 403) {
    return "Accès refusé : le playground exige ROLE_NODEFONY_ADMIN.";
  }
  return e instanceof Error ? e.message : "Erreur inattendue.";
}

/** Sources de param SAISISSABLES dans le formulaire (le reste = injecté serveur). */
export const FORM_SOURCES = new Set(["param", "body", "query", "headers"]);

/** Libellé FR d'une source de param injectée par le serveur (read-only). */
export function describeInjectedSource(source: string): string {
  switch (source) {
    case "user":
      return "identité du firewall (ALS)";
    case "session":
      return "session serveur";
    case "cookie":
      return "cookie de la requête";
    case "req":
    case "res":
      return "objet requête/réponse";
    case "file":
    case "files":
      return "upload multipart";
    default:
      return source;
  }
}
