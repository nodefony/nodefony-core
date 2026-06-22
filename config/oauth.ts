/**
 * Configuration OAuth 2.0 (social login) — EXTRAITE de `nodefony.config.ts` pour
 * garder la racine lisible (recette #6 : « extraire un domaine de config »).
 *
 * Niveau APPLICATION (PAS dans le package `@nodefony/studio`) : le CHOIX des
 * fournisseurs + leurs SECRETS est une décision de déploiement, pas du package
 * admin générique. Les secrets viennent de `./env.ts` (catalogue typé) →
 * `.env.local`, jamais committés (cf `.env.example`).
 *
 * Chaque fournisseur n'est monté QUE si SES deux secrets sont présents (spread
 * conditionnel) → sinon le bouton n'apparaît pas sur le login (UI honnête).
 *
 * `successRedirect` / `failureRedirect` / `defaultRoles` sont posés PAR
 * FOURNISSEUR (le module test garde ses propres valeurs globales pour le banc
 * E2E `test-oidc` → aucune collision).
 */
import type { env } from "../env";

/** Contexte minimal consommé ici (env typé + drapeau d'environnement). */
type Ctx = { env: typeof env; isDev: boolean };

export function oauth2Config(ctx: Ctx) {
  const base = ctx.env.OAUTH_REDIRECT_BASE;
  // OAuth = AUTHENTIFICATION, JAMAIS autorisation : se connecter via Google/GitHub
  // ne rend JAMAIS administrateur — ni en dev, ni en prod. Le compte social
  // provisionné (JIT « Shadow User ») reçoit `ROLE_USER` seul. L'accès admin passe
  // par un compte seedé (`provisionUsers`) ou une élévation explicite côté base —
  // jamais par le simple fait de se connecter avec un compte externe.
  const roles = ["ROLE_USER"];
  // Après login → console Studio ; après échec → login avec un marqueur lu par la
  // page (zone d'erreur réservée, sans saut de mise en page).
  const perProvider = {
    successRedirect: "/nodefony",
    failureRedirect: "/nodefony/login?error=oauth",
    defaultRoles: roles,
  };
  return {
    enabled: true,
    providers: {
      ...(ctx.env.GITHUB_CLIENT_ID && ctx.env.GITHUB_CLIENT_SECRET
        ? {
            github: {
              clientId: ctx.env.GITHUB_CLIENT_ID,
              clientSecret: ctx.env.GITHUB_CLIENT_SECRET,
              redirectUri: `${base}/nodefony/security/api/oauth2/github/callback`,
              ...perProvider,
            },
          }
        : {}),
      ...(ctx.env.GOOGLE_CLIENT_ID && ctx.env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: ctx.env.GOOGLE_CLIENT_ID,
              clientSecret: ctx.env.GOOGLE_CLIENT_SECRET,
              redirectUri: `${base}/nodefony/security/api/oauth2/google/callback`,
              ...perProvider,
            },
          }
        : {}),
    },
  };
}
