/**
 * Outillage de développement — porte MCP protégée.
 *
 * Fragment du manifeste de l'application : `nodefony.config.ts` l'importe et
 * passe le résultat à `use("@nodefony/devkit", …)`. Rien ne charge ce fichier
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
import type { IDevkitConfigInput } from "@nodefony/devkit";
import type { env } from "../../env";

/** La configuration de `@nodefony/devkit` pour cette application. */
export const devkitConfig = (ctx: ConfigContext<typeof env>) =>
  ({
    // ── Porte MCP PROTÉGÉE (P6.9) ──────────────────────────────────────
    // Un seul réglage commande le rôle : `authorizationServers`. Vide, la
    // porte est anonyme ; non vide, elle exige un jeton et publie où en
    // obtenir un (RFC 9728).
    //
    // Ici l'émetteur, c'est CETTE application : elle signe ses propres
    // jetons et publie ses clés (`/.well-known/jwks.json`), donc son
    // vérificateur sait les relire — exactement comme il relirait ceux
    // d'un Keycloak. C'est ce qui permet un MCP authentifié SANS monter
    // le moindre serveur d'autorisation tiers.
    mcp: {
      authorization: {
        authorizationServers: [
          ctx.env.NF_JWT_ISSUER ?? "https://localhost:5152",
        ],
        // 🔴 L'audience attendue des jetons — elle s'ÉCRIT, jamais dérivée
        // du `Host` : sinon un `Host` forgé obtiendrait un jeton d'audience
        // arbitraire ET passerait la vérification, ce qui viderait la
        // liaison d'audience de son unique raison d'être. C'est l'adresse
        // par laquelle un client entre réellement (cf `.mcp.json`) ; en
        // production, l'URL publique en https.
        resource: "http://localhost:5151/nodefony/mcp",
        // La même porte répond aussi en TLS, sur le second serveur. Sans
        // cette ligne, un jeton demandé pour l'adresse https était refusé
        // ici — la liaison d'audience faisant, à juste titre, son travail.
        // Ces valeurs s'ÉCRIVENT, jamais ne se dérivent du `Host`.
        additionalResources: ["https://localhost:5152/nodefony/mcp"],
        resourceName: "Nodefony — outils de développement",
        // 🔴 LES DEUX MODES À LA FOIS, et c'est un choix de DÉVELOPPEMENT.
        //
        // Un client MCP conforme qui reçoit un `401` veut obtenir un jeton
        // TOUT SEUL : il suit le défi, lit les métadonnées, trouve notre
        // émetteur — et y cherche un `authorization_endpoint` et un
        // `token_endpoint` que cette application n'offre pas (elle n'est pas
        // un serveur d'autorisation OAuth ; cf P6.9d). Il s'arrête donc là,
        // et l'outil devient inutilisable pour qui ne sait pas coller un
        // en-tête à la main.
        //
        // `true` : la porte SERT les outils publics sans jeton, et retient
        // les outils réservés (`IMcpTool.scopes` / `requiresAuth`) tant
        // qu'une identité n'est pas prouvée. L'authentification devient un
        // GAIN, pas un péage — et la vérification de jeton, elle, reste
        // entièrement exercée dès qu'un porteur en présente un.
        //
        // En production, ce drapeau s'écrit `false` : là, une porte ouverte
        // n'a plus d'excuse.
        anonymous: !ctx.isProd,
      },
    },
  }) satisfies IDevkitConfigInput;
