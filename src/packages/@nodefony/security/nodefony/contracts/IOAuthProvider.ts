import type { OAuth2Tokens } from "../src/oauth/oauth2Client";
import type { IOAuthProfile } from "@nodefony/user";

/**
 * Ce qu'on exige du paramètre `iss` renvoyé par le serveur d'autorisation
 * (RFC 9207).
 *
 * @remarks La règle a **trois** états, pas deux — et c'est ce que le booléen
 * seul ne pouvait pas dire. La RFC §2.4 impose au client d'extraire `iss`
 * « **if the parameter is present** », et son §2.3 fait annoncer le support par
 * les métadonnées de l'émetteur. Refuser une réponse sans `iss` d'un serveur qui
 * n'a jamais promis de l'émettre revient donc à refuser un serveur CONFORME —
 * Microsoft Entra en est un.
 *
 * La défense anti-mix-up ne repose d'ailleurs pas sur ce seul paramètre : chaque
 * fournisseur a son URL de redirection propre (`…/{provider}/callback`) et le
 * flux vérifie que le fournisseur de retour est celui qui a démarré, ce que la
 * RFC 9700 §4.4.2.2 donne comme défense principale. `iss` est la seconde ceinture.
 */
export interface IIssuerPolicy {
  /** Émetteur attendu, sous sa forme canonique. */
  readonly issuer: string;
  /**
   * `true` si le serveur ANNONCE émettre `iss`
   * (`authorization_response_iss_parameter_supported`) : son absence est alors
   * une promesse non tenue, donc un refus. `false` : absent, on continue ;
   * présent, il doit correspondre.
   */
  readonly requireIssParameter: boolean;
}

/**
 * Adaptateur d'**un fournisseur OAuth/OIDC**, façade UNIFORME au-dessus d'un client
 * OAuth 2.0 — masque les divergences entre fournisseurs derrière un contrat stable
 * consommé par `OAuth2Service` :
 *
 * - **PKCE ou non** : Google attend `createAuthorizationURL(state, codeVerifier,
 *   scopes)` ; GitHub `createAuthorizationURL(state, scopes)` (pas de
 *   `codeVerifier`). Le flag {@link usesPkce} dit au service s'il doit générer un
 *   `code_verifier` (RFC 7636).
 * - **Extraction du profil** : OIDC décode l'ID token (Google) ; non-OIDC appelle
 *   l'API du fournisseur (GitHub `/user`). Le résultat est toujours normalisé en
 *   {@link IOAuthProfile}.
 *
 * @remarks Ce contrat n'introduit aucune dépendance : le client OAuth 2.0 sous-jacent
 * est écrit dans le module même, et un fournisseur maison peut l'implémenter sans
 * rien installer.
 */
export interface IOAuthProvider {
  /**
   * `true` si le fournisseur exige PKCE (RFC 7636) — le service génère alors un
   * `code_verifier` et le transmet aux deux méthodes ci-dessous.
   */
  readonly usesPkce: boolean;

  /**
   * Politique de vérification du paramètre `iss` (anti-mix-up, RFC 9207), ou
   * `null` pour un fournisseur qui ne relève pas de cette défense (GitHub,
   * non-OIDC).
   */
  readonly issuerPolicy: IIssuerPolicy | null;

  /** Scopes appliqués quand la configuration n'en précise aucun. */
  readonly defaultScopes: string[];

  /**
   * Construit l'URL d'autorisation (étape 1). `codeVerifier` est non-`null`
   * lorsque {@link usesPkce} ; les fournisseurs sans PKCE l'ignorent.
   */
  createAuthorizationURL(
    state: string,
    codeVerifier: string | null,
    scopes: string[],
  ): URL;

  /**
   * Échange le `code` d'autorisation contre des jetons (étape 2, canal serveur).
   * `codeVerifier` doit correspondre à celui de l'étape 1 si {@link usesPkce}.
   */
  validateAuthorizationCode(
    code: string,
    codeVerifier: string | null,
  ): Promise<OAuth2Tokens>;

  /**
   * Récupère et **normalise** le profil de l'utilisateur à partir des jetons.
   *
   * @throws Si le fournisseur ne renvoie pas d'identifiant stable.
   */
  fetchProfile(tokens: OAuth2Tokens): Promise<IOAuthProfile>;
}
