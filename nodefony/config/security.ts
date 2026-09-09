/**
 * Sécurité applicative — social login, rôles, jetons, 2FA, CSRF, webhooks.
 *
 * Fragment du manifeste de l'application : `nodefony.config.ts` l'importe et
 * passe le résultat à `use("@nodefony/security", …)`. Rien ne charge ce fichier
 * tout seul — c'est l'import du manifeste qui le monte, et lui seul.
 *
 * 🔴 `satisfies` n'est PAS décoratif. Écrit dans le manifeste, ce littéral
 * était vérifié au point d'appel : une clé inconnue y était refusée. Rendu par
 * une fonction, il ne l'est plus — la clé compile, puis Zod la retire EN
 * SILENCE au boot, et le module démarre sur son défaut. `satisfies` rétablit
 * ce contrôle, et `nodefony doctor` refuse un fragment qui s'en passe.
 *
 * @module
 */
import type { ConfigContext } from "nodefony";
import type { ISecurityConfigInput } from "@nodefony/security";
import type { env } from "../../env";

/**
 * Redirections et rôles communs à tous les fournisseurs OAuth de CETTE app.
 *
 * Posés par fournisseur plutôt qu'en global : le module test garde ainsi ses
 * propres valeurs pour le banc E2E `test-oidc`, sans collision. Ne dépend pas
 * de `ctx`, donc hors de la fonction de config.
 */
const oauthPerProvider = {
  successRedirect: "/nodefony",
  failureRedirect: "/nodefony/login?error=oauth",
  defaultRoles: ["ROLE_USER"],
};

/**
 * La configuration de `@nodefony/security` pour cette application.
 *
 * Zones (firewall) : chaque zone = motif d'URL + chaîne d'authenticators,
 * validées par Zod au boot — une configuration invalide ferme le firewall
 * (fail-closed), tout est rejeté. Les zones se déclarent au plus près de leurs
 * routes : un module porte la sienne via l'override `module-security` dans SA
 * config (ex. la zone `test-secure` du banc P6 vit dans
 * `src/modules/test/nodefony/config/config.ts`).
 */
export const securityConfig = (ctx: ConfigContext<typeof env>) =>
  ({
    // Social login OAuth 2.0 — un fournisseur n'est monté que si SES deux
    // secrets sont présents (spread conditionnel) : pas de bouton mort sur
    // l'écran de connexion. Les secrets viennent d'`env.ts`, seul lecteur de
    // `process.env`, et ne sont JAMAIS journalisés.
    //
    // OAuth = AUTHENTIFICATION, JAMAIS autorisation : se connecter via
    // Google/GitHub ne rend JAMAIS administrateur — ni en dev, ni en prod. Le
    // compte social provisionné (JIT « Shadow User ») reçoit `ROLE_USER` seul.
    // L'accès admin passe par un compte seedé (`provisionUsers`) ou une
    // élévation explicite côté base.
    //
    // Les redirections et rôles sont posés PAR FOURNISSEUR : le module test
    // garde ainsi ses propres valeurs globales pour le banc E2E `test-oidc`,
    // sans collision. Pour retirer un bouton SANS fermer le flux (fixture,
    // fournisseur réservé à un autre point d'entrée) : `hidden: true`.
    oauth2: {
      enabled: true,
      providers: {
        ...(ctx.env.GITHUB_CLIENT_ID && ctx.env.GITHUB_CLIENT_SECRET
          ? {
              github: {
                clientId: ctx.env.GITHUB_CLIENT_ID,
                clientSecret: ctx.env.GITHUB_CLIENT_SECRET,
                redirectUri: `${ctx.env.OAUTH_REDIRECT_BASE}/nodefony/security/api/oauth2/github/callback`,
                ...oauthPerProvider,
              },
            }
          : {}),
        ...(ctx.env.GOOGLE_CLIENT_ID && ctx.env.GOOGLE_CLIENT_SECRET
          ? {
              google: {
                clientId: ctx.env.GOOGLE_CLIENT_ID,
                clientSecret: ctx.env.GOOGLE_CLIENT_SECRET,
                redirectUri: `${ctx.env.OAUTH_REDIRECT_BASE}/nodefony/security/api/oauth2/google/callback`,
                ...oauthPerProvider,
              },
            }
          : {}),
      },
    },
    // Hiérarchie de rôles (RBAC, niveau A de l'autorisation) — ROLE_X hérite
    // des rôles listés (résolu au boot en DFS ; cycle → throw). Additif :
    // un rôle gagne les droits des rôles couverts, jamais l'inverse.
    // Surfacé dans Studio → /nodefony/roles (Hiérarchie + Graphe).
    //
    // DEUX ÉCHELLES — frontière = convention de NOM (multi-tenant-ready) :
    //  • PLATEFORME `ROLE_NODEFONY_*` — l'OPÉRATEUR de l'instance (hébergeur
    //    SaaS, le « landlord »). GLOBAL, cross-tenant, JAMAIS scopé ni
    //    assigné à un client. Le SEUL à transcender l'isolation tenant
    //    (opt-out du scope auto). NE confondez JAMAIS avec un « admin de
    //    tenant » (= ROLE_ADMIN, scopé à son organisation).
    //  • TENANT `ROLE_*` — exercés DANS le tenant de l'acteur. Mono-tenant
    //    aujourd'hui = rôles plats (`user.roles`). En multi-tenant (P17), ils
    //    viendront du membership user×tenant, PAS de `user.roles` global
    //    (modif INTERNE de UserToken.getRoles, additive — cf
    //    project_multitenant_chantier_kit §2bis). La hiérarchie ci-dessous
    //    reste valable : seule la SOURCE des rôles tenant changera.
    roleHierarchy: {
      // PLATEFORME — couvre tous les rôles métier (et, transitivement, USER)
      // → un seul rôle pour « voit/fait tout » sur l'instance entière.
      ROLE_NODEFONY_ADMIN: [
        "ROLE_ADMIN",
        "ROLE_SECURITY_AUDITOR",
        "ROLE_DEV",
        "ROLE_SUPERVISOR",
      ],
      // TENANT (scopables) — chacun couvre l'utilisateur de base.
      ROLE_ADMIN: ["ROLE_USER"], // admin applicatif (gestion des utilisateurs)
      ROLE_SECURITY_AUDITOR: ["ROLE_USER"], // audit sécurité (journal, firewall lecture)
      ROLE_DEV: ["ROLE_USER"], // développeur (ORM, modules, routes, doc technique)
      ROLE_SUPERVISOR: ["ROLE_USER"], // exploitant / SRE (supervision, cluster, logs)
    },
    // Rôle ÉMETTEUR (RFC 8414) — l'URL publique sous laquelle cette app
    // signe ses jetons. Elle ne se devine PAS (derrière un relais, `Host`
    // vient du client) : c'est l'exploitant qui l'écrit. Renseignée, elle
    // ouvre `/.well-known/oauth-authorization-server` et
    // `/.well-known/jwks.json` — sans quoi aucun tiers ne peut vérifier une
    // signature émise ici. En dev, l'adresse publique EST connue.
    jwt: {
      issuer:
        ctx.env.NF_JWT_ISSUER ??
        (ctx.isProd ? undefined : "https://localhost:5152"),
      // Clés de signature PERSISTANTES (dossier gitignoré, chmod 600).
      //
      // 🔴 Sans elles, chaque process génère la sienne au démarrage : un
      // jeton émis par la CLI (`nodefony security:token`) porte un `kid`
      // que le serveur en marche ne connaît pas, et il est refusé en
      // « autorisation requise ». Mesuré : trois `kid` distincts pour la
      // même application, un par process et un de plus après redémarrage.
      // Elles survivent aussi aux redémarrages — les jetons en vol ne sont
      // plus invalidés à chaque rebuild du serveur de développement.
      //
      // En PRODUCTION, ce dossier n'a pas de sens (pods jetables, système
      // de fichiers éphémère) : la clé y vient de l'environnement
      // (`keySetJson`), partagée par tous les pods.
      keystore: ctx.isProd ? {} : { dir: "var/keys" },
      // Les ressources qu'un client peut NOMMER en demandant un jeton
      // (`resource`, RFC 8707) — une liste BLANCHE, décidée par
      // l'APPLICATION. La première est l'audience par défaut : garder
      // l'émetteur en tête laisse inchangé tout jeton demandé sans
      // `resource`.
      //
      // 🔴 Ces quatre lignes vivaient dans le module `test`, et c'était un
      // défaut de placement aux conséquences invisibles : le dépôt savait
      // émettre un jeton pour sa porte MCP grâce à un module de BANC, si
      // bien qu'aucun essai ici ne pouvait montrer qu'une application
      // générée, elle, se voyait refuser le jeton de sa propre porte.
      audiences: ctx.isProd
        ? []
        : [
            ctx.env.NF_JWT_ISSUER ?? "https://localhost:5152",
            // Audience du banc : la zone `test-foreign-audience` du module
            // `test` l'exige, pour prouver qu'un jeton n'ouvre QUE la porte
            // pour laquelle il a été demandé.
            "https://api.foreign.example/v1",
            // La porte MCP, en clair et en TLS : la même ressource répond
            // sur les deux serveurs, et un jeton demandé pour l'une était
            // refusé sur l'autre — la liaison d'audience faisant son
            // travail. Ces valeurs s'ÉCRIVENT, jamais ne se dérivent du
            // `Host`.
            "http://localhost:5151/nodefony/mcp",
            "https://localhost:5152/nodefony/mcp",
          ],
    },
    // 2FA TOTP (P6) — secret 2FA chiffré au repos (AES-256-GCM). Clé prod via
    // env (absente en prod = 2FA OFF, fail-safe : un secret chiffré par une clé
    // éphémère serait illisible après redémarrage / sur les autres pods ; dev =
    // clé éphémère + warning). MÊME pont env que les webhooks.
    totp: {
      encryptionKey: ctx.env.NF_TOTP_KEY,
    },
    // Jetons anti-CSRF (synchronizer) — le secret DOIT être partagé entre
    // les process : en cluster, un secret par pod ferait rejeter un jeton
    // émis par un autre pod. Absent en dev = secret éphémère + warning,
    // comme les deux clés voisines. `npx nodefony security:secrets`.
    csrf: {
      secret: ctx.env.NF_CSRF_SECRET,
    },
    // Webhooks sortants (P6.13) — secret de signature chiffré au repos. Clé
    // prod via env (absente en prod = webhooks OFF, fail-safe ; dev = clé
    // éphémère + warning). `enabled`/SSRF/livraison gardent leurs défauts.
    webhooks: {
      encryptionKey: ctx.env.NF_WEBHOOK_KEY,
      // Backend du registre : memory (défaut) | drizzle (durable). Le câblage
      // de la fabrique + l'entité vit dans `nodefony/security/webhookStore.ts`.
      store: ctx.env.NF_WEBHOOK_STORE,
      // DEV : autorise les cibles localhost + http:// pour le récepteur de
      // test local (module test → /test/webhooks/sink). PROD : SSRF strict
      // (défauts) — un webhook prod ne doit JAMAIS viser une IP privée/du http.
      denyPrivateIps: ctx.isProd,
      allowHttp: !ctx.isProd,
    },
  }) satisfies ISecurityConfigInput;
