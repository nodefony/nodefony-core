import { IssuerMismatchError } from "nodefony";
import type { IOAuthProvider } from "../../contracts/IOAuthProvider";
import {
  generateCodeVerifier,
  generateState,
  OAuth2RequestError,
  type OAuth2ClientAuthMethod,
} from "./oauth2Client";

/**
 * **Diagnostic d'un fournisseur OAuth sans connexion humaine** — dit POURQUOI un
 * branchement échoue, là où le journal ne montre qu'un 401 ou une page d'erreur
 * du fournisseur.
 *
 * Trois sondes, dans l'ordre où l'une éclaire l'autre :
 *
 * 1. **découverte** — le fournisseur se construit comme au premier login
 *    (métadonnées, émetteur identique RFC 8414 §3.3, PKCE S256 annoncé) ;
 * 2. **point d'autorisation** — la requête que le bouton enverrait, sans la
 *    suivre : le serveur accepte-t-il ce client et cette URL de retour ?
 * 3. **point de jeton** — un code INVENTÉ présenté avec le vrai secret :
 *    `invalid_grant` prouve que le client s'est authentifié (seul le code est
 *    refusé), un refus d'authentification prouve le contraire (RFC 6749 §5.2).
 *
 * 🔴 **Rien n'est réécrit ici.** Les sondes passent par le fournisseur que la
 * fabrique construit pour le login — mêmes points d'entrée, même méthode
 * d'authentification, même URL de retour. Un diagnostic qui reconstruirait sa
 * propre requête prouverait que SA requête passe, pas celle du login.
 *
 * @remarks Chemin froid (une commande, un écran d'administration). La sonde
 * d'autorisation ouvre côté fournisseur une session de connexion vide, qui
 * expire seule ; aucun compte n'est touché, aucun jeton n'est émis.
 */

/** Les trois sondes, dans leur ordre. */
export type OAuthCheckName = "discovery" | "authorization" | "token";

/**
 * Verdict d'une sonde. `inconclusive` = le serveur a répondu quelque chose
 * qu'on ne sait pas lire — ni un quitus, ni un manquement ; `skipped` = une
 * sonde précédente a rendu celle-ci impossible.
 */
export type OAuthCheckStatus = "ok" | "failed" | "inconclusive" | "skipped";

/** La cause d'un échec, lisible par une machine (rapport, console, tests). */
export type OAuthFailureKind =
  /** Le document de métadonnées se déclare d'un autre émetteur (RFC 8414 §3.3). */
  | "issuer-mismatch"
  /** Émetteur injoignable, document absent ou incomplet, PKCE S256 non annoncé. */
  | "discovery-failed"
  /** Le point d'autorisation refuse l'URL de retour (non enregistrée). */
  | "redirect-uri-rejected"
  /** Le point d'autorisation refuse la demande pour une autre raison. */
  | "authorization-refused"
  /** Le point d'autorisation n'a pas répondu. */
  | "authorization-unreachable"
  /** Le client existe (le point d'autorisation l'accepte), son secret est refusé. */
  | "secret-rejected"
  /** Authentification du client refusée : client inconnu, ou secret refusé. */
  | "client-rejected"
  /** Le point de jeton refuse pour une autre raison (flux non autorisé…). */
  | "token-refused"
  /** Le point de jeton n'a pas répondu. */
  | "token-unreachable";

/** Le résultat d'une sonde. */
export interface IOAuthCheck {
  readonly name: OAuthCheckName;
  readonly status: OAuthCheckStatus;
  /** Présent si et seulement si `status === "failed"`. */
  readonly kind?: OAuthFailureKind;
  /** Phrase destinée à l'opérateur : le constat, puis le geste. */
  readonly message: string;
}

/** Le diagnostic d'un fournisseur. */
export interface IOAuthDiagnosis {
  /** Nom du fournisseur (`oauth2.providers.<name>`). */
  readonly provider: string;
  /** `true` si aucune sonde n'a échoué. Une sonde non concluante ne l'empêche pas. */
  readonly ok: boolean;
  readonly checks: readonly IOAuthCheck[];
}

/** Ce que le diagnostic d'un fournisseur doit savoir. */
export interface IOAuthDiagnosisInput {
  /** Nom du fournisseur. */
  readonly name: string;
  /** Construit le fournisseur comme pour un login — découverte comprise. */
  readonly build: () => IOAuthProvider | Promise<IOAuthProvider>;
  /** Identifiant du client, tel que configuré. */
  readonly clientId: string;
  /** URL de retour configurée — celle que le fournisseur doit connaître. */
  readonly redirectUri: string;
  /** Méthode d'authentification déclarée ; `"none"` = client public. */
  readonly clientAuthMethod?: OAuth2ClientAuthMethod | undefined;
  /** Portées configurées ; vides = celles du fournisseur. */
  readonly scopes?: readonly string[] | undefined;
  /**
   * Transport de la sonde d'autorisation. Celle du point de jeton passe par le
   * fournisseur, donc par le transport que SA fabrique a reçu.
   */
  readonly fetch?: typeof globalThis.fetch | undefined;
  /** Délai d'attente de la sonde d'autorisation, en millisecondes. */
  readonly timeoutMs?: number | undefined;
}

/** Le code présenté au point de jeton : il n'a jamais été émis, il sera refusé. */
const PROBE_CODE = "nodefony-doctor-probe";

const AUTHORIZATION_TIMEOUT_MS = 10_000;

/**
 * Lu au plus sur une page d'erreur : de quoi y trouver le nom du paramètre en
 * cause, pas de quoi charger une page entière.
 */
const MAX_ERROR_PAGE_BYTES = 64 * 1024;

/** Ce que la sonde d'autorisation a établi sur l'existence du client. */
type ClientEvidence = "known" | "unknown";

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause: unknown = error.cause;
  if (cause instanceof Error) return `${error.message} (${cause.message})`;
  return error.message;
}

/** Les premiers octets d'une page, en texte — le reste est abandonné. */
async function readHead(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    seen += value.byteLength;
    if (seen >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** `true` si `location` désigne l'URL de retour (même origine, même chemin). */
function pointsTo(location: URL, redirectUri: string): boolean {
  let target: URL;
  try {
    target = new URL(redirectUri);
  } catch {
    return false;
  }
  return (
    location.origin === target.origin && location.pathname === target.pathname
  );
}

/**
 * Sonde 1 — construit le fournisseur.
 *
 * @returns le fournisseur, ou la sonde en échec.
 */
async function probeDiscovery(
  input: IOAuthDiagnosisInput,
): Promise<{ check: IOAuthCheck; provider: IOAuthProvider | null }> {
  try {
    const provider = await input.build();
    // Ce que la construction a VRAIMENT établi : un fournisseur à points
    // d'entrée fixes (GitHub) n'a rien découvert, et le dire serait faux.
    const pkce = provider.usesPkce ? ", PKCE S256" : ", sans PKCE";
    return {
      provider,
      check: {
        name: "discovery",
        status: "ok",
        message:
          provider.issuerPolicy === null
            ? `fournisseur construit — points d'entrée fixes, sans découverte${pkce}`
            : `métadonnées lues, émetteur « ${provider.issuerPolicy.issuer} » identique${pkce}`,
      },
    };
  } catch (error) {
    if (error instanceof IssuerMismatchError) {
      return {
        provider: null,
        check: {
          name: "discovery",
          status: "failed",
          kind: "issuer-mismatch",
          message:
            `l'émetteur se déclare « ${error.declaredIssuer} », la configuration ` +
            `écrit « ${error.expectedIssuer} » (RFC 8414 §3.3) — reprends l'adresse ` +
            `EXACTE que le serveur annonce (hôte, port, chemin du realm)`,
        },
      };
    }
    return {
      provider: null,
      check: {
        name: "discovery",
        status: "failed",
        kind: "discovery-failed",
        message: errorMessage(error),
      },
    };
  }
}

/**
 * Sonde 2 — la requête du bouton de connexion, sans la suivre.
 *
 * Un serveur qui refuse l'URL de retour ne doit PAS y renvoyer (RFC 6749
 * §4.1.2.1) : il répond lui-même, en erreur. Un renvoi vers l'URL de retour
 * prouve donc qu'elle est acceptée ; une page de connexion aussi.
 */
async function probeAuthorization(
  input: IOAuthDiagnosisInput,
  provider: IOAuthProvider,
): Promise<{ check: IOAuthCheck; client: ClientEvidence | null }> {
  const url = provider.createAuthorizationURL({
    state: generateState(),
    codeVerifier: provider.usesPkce ? generateCodeVerifier() : null,
    scopes:
      input.scopes !== undefined && input.scopes.length > 0
        ? input.scopes
        : provider.defaultScopes,
  });
  let response: Response;
  try {
    response = await (input.fetch ?? globalThis.fetch)(url, {
      headers: { Accept: "text/html", "User-Agent": "nodefony" },
      redirect: "manual",
      signal: AbortSignal.timeout(input.timeoutMs ?? AUTHORIZATION_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      client: null,
      check: {
        name: "authorization",
        status: "failed",
        kind: "authorization-unreachable",
        message: `point d'autorisation injoignable : ${errorMessage(error)}`,
      },
    };
  }

  if (response.status >= 200 && response.status < 300) {
    await response.body?.cancel();
    return {
      client: "known",
      check: {
        name: "authorization",
        status: "ok",
        message: "client et URL de retour acceptés (page de connexion servie)",
      },
    };
  }

  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    const raw = response.headers.get("location");
    const location = raw === null ? null : new URL(raw, url);
    if (location !== null && pointsTo(location, input.redirectUri)) {
      const refused = location.searchParams.get("error");
      if (refused === null) {
        return {
          client: "known",
          check: {
            name: "authorization",
            status: "ok",
            message: "client et URL de retour acceptés",
          },
        };
      }
      const description = location.searchParams.get("error_description");
      return {
        client: "known",
        check: {
          name: "authorization",
          status: "failed",
          kind: "authorization-refused",
          message:
            `URL de retour acceptée, mais la demande est refusée : « ${refused} »` +
            (description === null ? "" : ` — ${description}`),
        },
      };
    }
    return {
      client: null,
      check: {
        name: "authorization",
        status: "inconclusive",
        message:
          `le point d'autorisation renvoie vers ${location?.origin ?? "une adresse absente"} ` +
          `— l'URL de retour ne se juge alors qu'après une connexion`,
      },
    };
  }

  // Une erreur rendue par le serveur lui-même. Le NOM du paramètre ne se
  // traduit pas — « Paramètre invalide : redirect_uri » chez Keycloak en
  // français — c'est donc lui qu'on cherche, jamais la phrase.
  const page = await readHead(response, MAX_ERROR_PAGE_BYTES).catch(() => "");
  if (page.includes("redirect_uri")) {
    return {
      client: null,
      check: {
        name: "authorization",
        status: "failed",
        kind: "redirect-uri-rejected",
        message:
          `URL de retour refusée (HTTP ${response.status}) : « ${input.redirectUri} » ` +
          `n'est pas enregistrée sur le client « ${input.clientId} » — ` +
          `ajoute-la telle quelle aux URL de retour du client`,
      },
    };
  }
  return {
    client: null,
    check: {
      name: "authorization",
      status: "failed",
      kind: "authorization-refused",
      message:
        `le point d'autorisation refuse la demande (HTTP ${response.status}) ` +
        `sans renvoyer vers l'application — client « ${input.clientId} » ` +
        `inconnu ou désactivé, ou URL de retour non enregistrée`,
    },
  };
}

/**
 * Sonde 3 — un code inventé, présenté avec les vrais identifiants.
 *
 * @param client - ce que la sonde 2 a établi : un client CONNU qui échoue à
 *   s'authentifier ne peut avoir qu'un secret faux.
 */
async function probeToken(
  input: IOAuthDiagnosisInput,
  provider: IOAuthProvider,
  client: ClientEvidence | null,
): Promise<IOAuthCheck> {
  const publicClient = input.clientAuthMethod === "none";
  try {
    await provider.validateAuthorizationCode({
      code: PROBE_CODE,
      codeVerifier: provider.usesPkce ? generateCodeVerifier() : null,
    });
    return {
      name: "token",
      status: "inconclusive",
      message:
        "le point de jeton a ACCEPTÉ un code inventé — ce serveur ne se " +
        "comporte pas comme un serveur OAuth 2.0, rien ne peut en être conclu",
    };
  } catch (error) {
    if (!(error instanceof OAuth2RequestError)) {
      return {
        name: "token",
        status: "failed",
        kind: "token-unreachable",
        message: `point de jeton injoignable : ${errorMessage(error)}`,
      };
    }
    if (error.code === "invalid_grant") {
      return {
        name: "token",
        status: "ok",
        message: publicClient
          ? "client public reconnu (le code de sonde est refusé, comme prévu)"
          : "secret accepté (le code de sonde est refusé, comme prévu)",
      };
    }
    // RFC 6749 §5.2 : `invalid_client` nomme l'échec d'authentification du
    // client, et `401` le signale quel que soit le code — Keycloak répond
    // `unauthorized_client` en 401 sur un secret faux.
    if (error.code === "invalid_client" || error.status === 401) {
      if (client === "known" && !publicClient) {
        return {
          name: "token",
          status: "failed",
          kind: "secret-rejected",
          message:
            `secret refusé : le client « ${input.clientId} » existe (le point ` +
            `d'autorisation l'accepte), mais son secret n'est pas celui que ` +
            `le serveur attend — recopie-le depuis le fournisseur`,
        };
      }
      return {
        name: "token",
        status: "failed",
        kind: "client-rejected",
        message:
          `authentification du client « ${input.clientId} » refusée ` +
          `(${error.code}) : client inconnu de ce serveur, ou secret faux`,
      };
    }
    return {
      name: "token",
      status: "failed",
      kind: "token-refused",
      message:
        `le point de jeton refuse le client : « ${error.code} »` +
        (error.description === null ? "" : ` — ${error.description}`),
    };
  }
}

/**
 * Diagnostique un fournisseur OAuth sans connexion humaine.
 *
 * Ne lève jamais : un serveur muet ou hostile devient une sonde en échec, et
 * les sondes que l'échec rend impossibles sont DITES sautées — un silence ne
 * vaut pas quitus.
 *
 * @param input - fournisseur à construire et configuration à confronter.
 * @returns les trois sondes et leur verdict.
 */
export async function diagnoseOAuthProvider(
  input: IOAuthDiagnosisInput,
): Promise<IOAuthDiagnosis> {
  const discovery = await probeDiscovery(input);
  const checks: IOAuthCheck[] = [discovery.check];
  if (discovery.provider === null) {
    const reason =
      "impossible sans fournisseur construit (découverte en échec)";
    checks.push(
      { name: "authorization", status: "skipped", message: reason },
      { name: "token", status: "skipped", message: reason },
    );
  } else {
    const authorization = await probeAuthorization(input, discovery.provider);
    checks.push(
      authorization.check,
      await probeToken(input, discovery.provider, authorization.client),
    );
  }
  return {
    provider: input.name,
    ok: checks.every((c) => c.status !== "failed"),
    checks,
  };
}
