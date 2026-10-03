import type {
  IAuthorizationRequest,
  ITokenRequest,
  OAuth2Tokens,
} from "../src/oauth/oauth2Client";
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
 * Ce que porte une déconnexion initiée par l'application
 * (OpenID Connect RP-Initiated Logout 1.0 §2).
 */
export interface ILogoutRequest {
  /**
   * ID token reçu au login (`id_token_hint`) : il dit au fournisseur QUELLE
   * session fermer, et lui évite de demander une confirmation à l'utilisateur.
   */
  readonly idTokenHint: string;
  /** Adresse de retour, enregistrée chez le fournisseur (`post_logout_redirect_uri`). */
  readonly postLogoutRedirectUri: string;
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
   *
   * @remarks La forme est un OBJET pour que les paramètres normalisés encore
   * absents — `resource` (RFC 8707), `nonce`, `prompt`… — s'ajoutent plus tard
   * sans rupture. Ce contrat est EXPORTÉ, donc gelé à la publication : une
   * signature positionnelle y aurait figé l'impossibilité de les accueillir.
   */
  createAuthorizationURL(request: IAuthorizationRequest): URL;

  /**
   * Échange le `code` d'autorisation contre des jetons (étape 2, canal serveur).
   * `codeVerifier` doit correspondre à celui de l'étape 1 si {@link usesPkce}.
   */
  validateAuthorizationCode(request: ITokenRequest): Promise<OAuth2Tokens>;

  /**
   * Récupère et **normalise** le profil de l'utilisateur à partir des jetons.
   *
   * @throws Si le fournisseur ne renvoie pas d'identifiant stable.
   */
  fetchProfile(tokens: OAuth2Tokens): Promise<IOAuthProfile>;

  /**
   * Construit l'adresse de déconnexion chez le fournisseur (RP-Initiated
   * Logout). ABSENTE quand le fournisseur n'en publie aucune (GitHub, OIDC sans
   * `end_session_endpoint`) : la déconnexion reste alors locale, et l'ID token
   * n'est pas conservé.
   */
  createLogoutURL?(request: ILogoutRequest): URL;

  /**
   * Vérifie un jeton de déconnexion reçu sur le canal arrière (OpenID Connect
   * Back-Channel Logout 1.0 §2.6) et rend ce qu'il désigne. ABSENTE quand le
   * fournisseur ne sait pas en émettre (GitHub, OAuth sans OpenID Connect).
   *
   * @param logoutToken - le paramètre `logout_token` reçu, brut.
   * @returns les claims qui désignent les sessions à fermer, ou `null` si le
   *   jeton est refusé (signature, émetteur, audience, expiration, forme).
   * @throws Error si la vérification est IMPOSSIBLE (jeu de clés injoignable) —
   *   une panne n'est pas un jeton invalide.
   */
  verifyLogoutToken?(logoutToken: string): Promise<ILogoutTokenClaims | null>;
}

/**
 * Ce qu'un jeton de déconnexion VÉRIFIÉ désigne (OpenID Connect Back-Channel
 * Logout 1.0 §2.4) : au moins l'un de `subject` et `sid`.
 */
export interface ILogoutTokenClaims {
  /** Émetteur canonique — celui de la liste fermée qui a servi à vérifier. */
  readonly issuer: string;
  /** `sub` : l'utilisateur chez le fournisseur, ou `null`. */
  readonly subject: string | null;
  /** `sid` : LA session du fournisseur à fermer, ou `null` (= toutes celles de `subject`). */
  readonly sid: string | null;
  /** `jti` : identifiant unique du jeton, la clé de l'anti-rejeu. */
  readonly tokenId: string;
  /** `exp` : fin de validité, en secondes depuis l'époque. */
  readonly expiresAt: number;
}
