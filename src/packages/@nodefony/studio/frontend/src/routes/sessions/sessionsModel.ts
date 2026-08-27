/**
 * Modèle de la console **Sessions** (administration des sessions actives, P6.15) —
 * **types miroir** du contrat back `@nodefony/http` (frontière isomorphe : on
 * recopie la shape JSON, secrets exclus par construction, jamais d'import runtime
 * serveur) + endpoints, mapping d'erreur, formatage et parsing User-Agent.
 *
 * Le data plane vit dans `@nodefony/http` (propriétaire du domaine session :
 * store + `destroy` + count + audit), monté par `HttpAdminApi` sous le namespace
 * `http` (broker admin) → `/nodefony/http/api/sessions*`. RBAC `ROLE_NODEFONY_ADMIN`
 * sur l'énumération et les révocations (gating front = affichage ; enforcement
 * réel = firewall serveur).
 *
 * Source de vérité serveur : `http/nodefony/interfaces/ISession.ts`
 * (`ISessionSummary`, `ISessionListFilter`).
 */

/**
 * Vue publique d'une session — miroir de `ISessionSummary`. **Jamais** l'id de
 * session brut (= la valeur du cookie ; le posséder = être connecté) : seul un
 * `ref` HMAC non réversible sort de l'API (standard « appareils connectés »).
 * Jamais non plus `Attributes`/`flashBag` (données métier/flash potentiellement
 * sensibles) — redaction par construction côté serveur.
 */
export interface SessionSummary {
  /** Pseudonyme `HMAC(secret, id)` tronqué (préfixe `sess_…`). JAMAIS l'id brut. */
  ref: string;
  /** Identifiant de l'utilisateur porté par la session (chaîne vide = anonyme). */
  user: string;
  /** Vrai si la session porte un utilisateur authentifié. */
  authenticated: boolean;
  /** IP capturée au login, ou `null` si non capturée / anonyme. */
  ip: string | null;
  /** User-Agent capturé au login, ou `null` si non capturé. */
  ua: string | null;
  /** Création de la session (epoch ms), ou `null` si inconnue. */
  createdAt: number | null;
  /** Dernière persistance (epoch ms), ou `null` si inconnue. */
  updatedAt: number | null;
  /** Réserve multi-tenant (`null` = mono-tenant aujourd'hui — slot coût-0). */
  tenantId: string | null;
  /**
   * Vrai pour LA session d'où l'on regarde (« cet appareil »). Le serveur seul
   * peut le dire : le navigateur ne connaît pas la référence HMAC de son propre
   * cookie. Comparer les utilisateurs ne le remplace pas — dans « Mes sessions »
   * toutes les lignes portent le même.
   */
  current: boolean;
}

/** Réponse paginée de l'énumération — miroir du handler `sessions/list`. */
export interface SessionListResponse {
  items: SessionSummary[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Statut du sous-système session — miroir du handler `sessions` (HttpAdminApi).
 * **« Où on écrit »** : le `driver` de persistance (drizzle/files/redis/mongo),
 * son durcissement anti-résurrection (garde-fou de révocation actif), et le
 * chemin RELATIF si c'est un store fichier.
 */
export interface SessionsStatus {
  enabled: boolean;
  /** Driver configuré (`drizzle`/`files`/`redis`/`mongoose`), `null` si inconnu. */
  driver: string | null;
  /** Classe du store réel décoré (ex. `DrizzleSessionStorage`). */
  storage: string;
  /** Garde-fou de révocation actif (anti-résurrection) — couvre tout backend. */
  revocationHardened: boolean;
  /** Chemin RELATIF du dossier de sessions (store fichier), `null` sinon. */
  savePath: string | null;
  /** Nombre de sessions persistées (store fichier), `null` si non dénombrable. */
  active: number | null;
  strategy?: string | null;
  name?: string | null;
  /** Idle timeout serveur (s) — inactivité max, rafraîchie par l'activité. */
  idleTimeoutS?: number | null;
  /** Absolute timeout serveur (s) — âge max depuis création (re-auth forcée). */
  absoluteTimeoutS?: number | null;
}

// ─── Endpoints du data plane (@nodefony/http, namespace « http ») ─────────────

/** GET — énumération paginée (`?user&tenantId&limit&offset`), RBAC ADMIN. */
export const SESSIONS_LIST_ENDPOINT = "/nodefony/http/api/sessions/list";

/** GET — statut du sous-système (driver de persistance, durcissement révocation). */
export const SESSIONS_STATUS_ENDPOINT = "/nodefony/http/api/sessions";

/**
 * GET — **compteurs de tête**, posés par le serveur sur la collection ENTIÈRE.
 *
 * Endpoint distinct de la liste : ces nombres ne dépendent ni de la fenêtre ni
 * de l'ordre, donc on ne les recharge pas à chaque tour de page — seulement au
 * montage, au changement de filtre, et après une révocation.
 */
export const SESSIONS_STATS_ENDPOINT = "/nodefony/http/api/sessions/stats";

// Les constructeurs d'URL de LISTE ont disparu — avec la fenêtre plafonnée
// qu'ils portaient. Une query string de page ne s'écrit plus qu'à UN endroit
// (`toPageParams`, UI kit) : c'est en la recomposant vue par vue que deux
// dialectes incompatibles étaient nés. Restent ici les URL de MUTATION, qui
// n'ont ni page, ni tri, ni filtre.

/** POST — révoque UNE session par sa référence publique (`sess_…`). Audité. */
export function revokeSessionEndpoint(ref: string): string {
  return `/nodefony/http/api/sessions/${encodeURIComponent(ref)}/revoke`;
}

/** POST — « logout everywhere » : détruit TOUTES les sessions d'un utilisateur. */
export function revokeUserSessionsEndpoint(identifier: string): string {
  return `/nodefony/http/api/sessions/revoke-user/${encodeURIComponent(identifier)}`;
}

// ─── Self-service (« MES sessions ») — tout utilisateur AUTHENTIFIÉ, pas admin ─
// Le périmètre est fermé CÔTÉ SERVEUR par l'identité ALS (anti-IDOR) : aucun
// `?user=` n'est transmis (il serait ignoré). Le back ne liste/révoque QUE les
// sessions de l'appelant → un non-admin ne peut jamais toucher celles d'autrui.

/** GET — self-service paginé : MES sessions (scopées serveur à l'appelant). */
export const SESSIONS_MINE_ENDPOINT = "/nodefony/http/api/sessions/mine";

/** POST — self-service : révoque UNE de MES sessions (404 si elle n'est pas à moi). */
export function revokeSessionMineEndpoint(ref: string): string {
  return `/nodefony/http/api/sessions/mine/${encodeURIComponent(ref)}/revoke`;
}

/** Version de la doc de cette surface (badge des fiches `DocHint`). */
export const SESSIONS_DOC = "v1.1";

/** Rôle requis pour l'administration des sessions — source unique `auth/roles`. */
export { ROLE_NODEFONY_ADMIN as ADMIN_ROLE } from "../../auth/roles";

// ─── Compteurs (KPIs) ────────────────────────────────────────────────────────

/**
 * Les compteurs de tête — miroir exact de ce que rend `sessions/stats`.
 *
 * `null` signifie « le backend ne sait pas le calculer » (un store en curseur
 * comme Redis refuse un comptage exact) et se rend « — » à l'écran. C'est ce
 * qui interdit d'afficher un zéro là où l'on ne sait rien : une carte à zéro se
 * lit comme une absence, pas comme une ignorance.
 */
export interface SessionCounts {
  /** Sessions persistées. */
  total: number | null;
  /** Sessions portant un utilisateur authentifié. */
  authenticated: number | null;
  /** Sessions anonymes (aucun utilisateur). */
  anonymous: number | null;
  /** Nombre d'utilisateurs **distincts** authentifiés. */
  users: number | null;
}

// Le comptage LOCAL a disparu : la table ne charge plus qu'une page, même en
// « Mes sessions », et compter ses lignes décrirait 25 sessions pour qui en a
// 60. Un compteur que le serveur ne rend pas reste `null` → « — » à l'écran.

// ─── User-Agent (parsing léger, 0 dépendance) ────────────────────────────────

/** Résultat du parsing d'un User-Agent : navigateur + système + indice machine. */
export interface ParsedUa {
  /** Navigateur lisible (`Chrome`, `Firefox`, `Safari`, `curl`…). */
  browser: string;
  /** Système d'exploitation lisible (`Windows`, `macOS`, `Linux`…) ou `null`. */
  os: string | null;
  /** Vrai pour un client non-navigateur (script/outil/robot) — repère M2M. */
  machine: boolean;
}

/**
 * Parse un User-Agent en `{ browser, os, machine }` sans dépendance (heuristique
 * par mots-clés, ordre signifiant). But : repérer d'un coup d'œil un navigateur
 * vs un script (`curl`/`wget`/bot). `null` si l'UA n'a pas été capturé.
 */
export function parseUserAgent(ua: string | null): ParsedUa | null {
  if (!ua) return null;
  const machine =
    /\b(curl|wget|python-requests|axios|node-fetch|got|httpie|postman|insomnia|bot|crawler|spider)\b/i.test(
      ua,
    );
  let browser = "Inconnu";
  if (machine) {
    const m = ua.match(
      /\b(curl|wget|python-requests|axios|node-fetch|got|httpie|postman|insomnia)\b/i,
    );
    browser = m ? m[1] : "Robot";
  } else if (/\bEdg\//.test(ua)) browser = "Edge";
  else if (/\bOPR\/|\bOpera\b/.test(ua)) browser = "Opera";
  else if (/\bFirefox\//.test(ua)) browser = "Firefox";
  else if (/\bCriOS\//.test(ua)) browser = "Chrome";
  else if (/\bChrome\//.test(ua)) browser = "Chrome";
  else if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) browser = "Safari";

  let os: string | null = null;
  if (/\bWindows NT\b/.test(ua)) os = "Windows";
  else if (/\b(iPhone|iPad|iPod)\b/.test(ua)) os = "iOS";
  else if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) os = "macOS";
  else if (/\bAndroid\b/.test(ua)) os = "Android";
  else if (/\bLinux\b/.test(ua)) os = "Linux";

  return { browser, os, machine };
}

// ─── Formatage des dates ─────────────────────────────────────────────────────

/** Date absolue lisible (ou « — » si nulle). */
export function fmtDate(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Ancienneté en clair, en **paliers** (jamais de churn d'unité) — « à l'instant »
 * sous ~1,5 s, puis s / min / h / j entières. `—` si la date est inconnue.
 */
export function fmtSince(ms: number | null, now: number = Date.now()): string {
  if (ms === null) return "—";
  const diff = now - ms;
  if (diff < 1500) return "à l'instant";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `il y a ${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}

// ─── Mapping d'erreur (vitrine honnête) ──────────────────────────────────────

/**
 * Traduit une erreur HTTP du data plane des sessions en message FR explicite —
 * même classe que les autres consoles Sécurité. Le **501** est propre aux
 * sessions : le backend de stockage ne sait pas s'énumérer (KV/edge).
 */
export function describeSessionsError(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  if (status === 401) {
    return (
      "Non authentifié — votre session Studio a expiré ou n'est plus reconnue " +
      "par le firewall. Reconnectez-vous."
    );
  }
  if (status === 403) {
    return (
      "Accès refusé — l'administration des sessions est réservée aux " +
      "administrateurs (ROLE_NODEFONY_ADMIN)."
    );
  }
  if (status === 501) {
    return (
      "Énumération non supportée — le backend de stockage de session actuel " +
      "ne sait pas lister les sessions (par ex. un KV sans scan, edge). " +
      "Les stores fichier / SQL / Redis la supportent."
    );
  }
  if (status === 503) {
    return "Service de session indisponible — le sous-système n'est pas provisionné.";
  }
  if (status === 404) {
    return "Endpoint introuvable — le module @nodefony/http n'expose peut-être pas l'admin des sessions.";
  }
  const msg = (e as { message?: string } | null)?.message;
  return msg
    ? `Erreur de chargement des sessions : ${msg}`
    : "Erreur de chargement des sessions.";
}
