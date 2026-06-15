import type { OAuth2Tokens } from "arctic";
import type { IOAuthProfile } from "@nodefony/user";

/**
 * Adaptateur d'**un fournisseur OAuth/OIDC**, façade UNIFORME au-dessus d'une
 * classe `arctic` — masque les divergences entre fournisseurs derrière un contrat
 * stable consommé par `OAuth2Service` :
 *
 * - **PKCE ou non** : Google attend `createAuthorizationURL(state, codeVerifier,
 *   scopes)` ; GitHub `createAuthorizationURL(state, scopes)` (pas de
 *   `codeVerifier`). Le flag {@link usesPkce} dit au service s'il doit générer un
 *   `code_verifier` (RFC 7636).
 * - **Extraction du profil** : OIDC décode l'ID token (Google) ; non-OIDC appelle
 *   l'API du fournisseur (GitHub `/user`). Le résultat est toujours normalisé en
 *   {@link IOAuthProfile}.
 *
 * @remarks `arctic` n'est référencé ici qu'en **type** (`import type`, effacé à la
 * compilation) — l'instance runtime est chargée paresseusement par le service et
 * injectée aux fabriques. Aucune dépendance runtime n'entre par ce contrat.
 */
export interface IOAuthProvider {
  /**
   * `true` si le fournisseur exige PKCE (RFC 7636) — le service génère alors un
   * `code_verifier` et le transmet aux deux méthodes ci-dessous.
   */
  readonly usesPkce: boolean;

  /**
   * Identifiant d'émetteur attendu pour la défense anti-mix-up (RFC 9207), ou
   * `null` si le fournisseur n'émet pas le paramètre `iss` (ex. GitHub, non-OIDC).
   * Quand non-`null`, le service **rejette** une réponse dont l'`iss` diffère ou
   * manque.
   */
  readonly expectedIssuer: string | null;

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
