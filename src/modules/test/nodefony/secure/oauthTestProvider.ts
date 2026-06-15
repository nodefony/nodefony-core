import { registerOAuthProvider } from "@nodefony/security";
import type { IOAuthProvider } from "@nodefony/security";
import type { IOAuthProfile } from "@nodefony/user";
import type { OAuth2Tokens } from "arctic";

/**
 * Fournisseur OAuth de **TEST** (DEV uniquement — le module test est `policy:
 * "dev"`) : déterministe et **sans réseau**, il prouve le flux social login
 * complet (`authorize` → `callback` → session BFF + provisioning Shadow User)
 * sans dépendre d'un vrai fournisseur (Google/GitHub impossibles à automatiser).
 *
 * `usesPkce: true` exerce la branche PKCE (state + code_verifier en session).
 * `expectedIssuer: null` : pas de validation `iss` ici (déjà couverte par les
 * tests unitaires du service) → le banc n'a pas à fabriquer d'`iss`.
 *
 * Enregistré au **chargement du module** (import top-level dans `index.ts`), donc
 * AVANT le `onBoot` du service `oauth2` qui confronte les providers configurés au
 * registre.
 */
const TEST_PROFILE: IOAuthProfile = {
  provider: "test-oidc",
  providerId: "ext-12345",
  email: "oauth-user@test.local",
  emailVerified: true,
  name: "OAuth Test User",
  raw: { sub: "ext-12345" },
};

registerOAuthProvider("test-oidc", (): IOAuthProvider => {
  return {
    usesPkce: true,
    expectedIssuer: null,
    defaultScopes: ["openid", "email"],
    createAuthorizationURL: (state, codeVerifier, scopes) =>
      new URL(
        `https://test-idp.local/authorize` +
          `?state=${encodeURIComponent(state)}` +
          `&code_challenge=${encodeURIComponent(String(codeVerifier ?? ""))}` +
          `&scope=${encodeURIComponent(scopes.join(" "))}`,
      ),
    // Aucun appel réseau : "échange" symbolique (jetons factices) + profil fixe.
    validateAuthorizationCode: () => Promise.resolve({} as OAuth2Tokens),
    fetchProfile: () => Promise.resolve(TEST_PROFILE),
  };
});
