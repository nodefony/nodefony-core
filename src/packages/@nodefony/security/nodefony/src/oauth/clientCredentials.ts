import { discoverAuthorizationServer } from "./metadata";
import { postTokenRequest } from "./oauth2Client";
import type { OAuth2ClientAuthMethod, OAuth2Tokens } from "./oauth2Client";

/**
 * Ce qu'un programme présente pour obtenir un jeton EN SON PROPRE NOM
 * (RFC 6749 §4.4) — un script, un service partenaire, un agent : aucun
 * utilisateur, aucun navigateur.
 */
export interface IClientCredentialsRequest {
  /**
   * Identifiant de l'émetteur (claim `iss`), en https. Le point de jeton en est
   * DÉCOUVERT (RFC 8414), jamais écrit à côté : un point de jeton recopié
   * survit au déménagement de l'émetteur et envoie le secret ailleurs.
   */
  readonly issuer: string;
  /** Identifiant du client confidentiel (ex. `<app>-machine` chez Keycloak). */
  readonly clientId: string;
  /** Secret du client — obligatoire : ce flux n'existe que pour un client confidentiel. */
  readonly clientSecret: string;
  /**
   * Comment le client s'authentifie. Défaut `client_secret_basic`, la méthode
   * que la RFC 6749 §2.3.1 rend obligatoire côté serveur. `none` n'existe pas
   * ici : un client public ne peut pas obtenir de jeton en son nom.
   */
  readonly clientAuthMethod?: Exclude<OAuth2ClientAuthMethod, "none">;
  /** Portées demandées ; aucune par défaut (le serveur applique les siennes). */
  readonly scopes?: readonly string[];
  /**
   * Ressource visée (RFC 8707 §2) — l'audience que le jeton doit porter. Un
   * serveur qui ne la connaît pas l'ignore ; Keycloak, lui, inscrit l'audience
   * par un mapper déclaré sur le client.
   */
  readonly resource?: string;
  /** Adresse où lire les métadonnées, si elle diffère de l'émetteur (cf `IDiscoveryOptions`). */
  readonly discoveryUrl?: string | undefined;
  /** Implémentation de `fetch` (banc sans réseau). */
  readonly fetch?: typeof globalThis.fetch;
  /** Délai d'attente de CHAQUE requête (découverte, puis jeton), en millisecondes. */
  readonly timeoutMs?: number;
}

/**
 * Obtient un jeton d'accès pour un programme, par le flux `client_credentials`
 * (RFC 6749 §4.4), auprès d'un émetteur découvert (RFC 8414).
 *
 * C'est la voie de l'appelant MACHINE : il s'authentifie avec son propre
 * secret, et le jeton rendu le désigne lui, pas un utilisateur. La même
 * authentification de client que l'échange de code ({@link postTokenRequest}) —
 * une seule implémentation, pour qu'aucune règle ne diverge d'un flux à l'autre.
 *
 * @param request - émetteur, identité du client, portées et ressource.
 * @returns Les jetons rendus ; `accessToken()` est celui à présenter en `Bearer`.
 * @throws Error - secret vide, émetteur invalide ou injoignable, métadonnées discordantes.
 * @throws OAuth2RequestError - le serveur a refusé (`invalid_client` : secret
 *   faux ; `unauthorized_client` : le client n'a pas droit à ce flux).
 */
export async function requestClientCredentialsToken(
  request: IClientCredentialsRequest,
): Promise<OAuth2Tokens> {
  if (request.clientSecret.length === 0) {
    // Refusé AVANT tout appel : un secret vide partirait au serveur, qui
    // répondrait `invalid_client` — vrai, mais muet sur la cause réelle, qui est
    // une variable d'environnement absente chez l'appelant.
    throw new Error(
      `client « ${request.clientId} » : secret vide — le flux client_credentials ` +
        `n'existe que pour un client confidentiel (RFC 6749 §4.4).`,
    );
  }
  const server = await discoverAuthorizationServer(request.issuer, {
    discoveryUrl: request.discoveryUrl,
    ...(request.fetch ? { fetch: request.fetch } : {}),
    ...(request.timeoutMs !== undefined
      ? { timeoutMs: request.timeoutMs }
      : {}),
  });
  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  if (request.scopes !== undefined && request.scopes.length > 0) {
    body.set("scope", request.scopes.join(" "));
  }
  if (request.resource !== undefined) body.set("resource", request.resource);
  return postTokenRequest(
    {
      tokenEndpoint: server.tokenEndpoint,
      clientId: request.clientId,
      clientSecret: request.clientSecret,
      clientAuthMethod: request.clientAuthMethod ?? "client_secret_basic",
      fetch: request.fetch,
      timeoutMs: request.timeoutMs,
    },
    body,
  );
}
