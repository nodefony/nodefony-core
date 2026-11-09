import type { ISecurityConfigInput } from "@nodefony/security";
import { MCP_GATE_PATH, MCP_WRITE_SCOPE } from "../../frontend/src/mcp/mcpDemo";

/**
 * Chemin de l'API partenaire de la démo. Une seule définition, lue par la zone
 * ci-dessous, par `PartnerController` et par la commande `demo:partner:call` :
 * un chemin recopié finit par différer.
 */
export const PARTNER_PATH = "/demo/api/partner";

/** Nom de la zone du firewall qui protège l'API partenaire. */
export const PARTNER_AREA = "demo-partner";

/** Nom de la zone qui couvre les pages et la socket de la démo. */
export const DEMO_AREA = "demo";

/**
 * Nom de la zone qui porte la RESSOURCE de la porte MCP (`/mcp/demo`) : le
 * firewall la rend absolue contre `jwt.issuer` et l'ajoute aux audiences que
 * l'application peut émettre. Elle n'authentifie personne : la porte juge
 * elle-même le jeton (`@nodefony/ai`).
 */
export const MCP_AREA = "demo-mcp";

/**
 * Ce que la démo apporte à la configuration de `@nodefony/security`, sans
 * toucher à celle de l'application.
 *
 * Le module la passe sous la clé `module-security` de sa config
 * (`./config.ts`). Le Kernel la fusionne dans la config de security AVANT de
 * la valider : la zone s'ajoute aux zones de l'application. Retirer la démo
 * (son dossier et sa ligne du manifeste) retire donc aussi sa zone.
 *
 * La `resource` s'écrit comme un CHEMIN : le module ne connaît pas l'adresse
 * publique de l'application, et security la rend absolue contre `jwt.issuer`
 * (`NF_JWT_ISSUER` en production). Elle devient aussi une audience que
 * l'application peut émettre, sans être recopiée dans `jwt.audiences`.
 */
export const demoSecurity = {
  areas: {
    // #region chat-area
    // Les pages, l'API de la page et les sockets de la démo : PUBLIQUES, mais
    // l'identité y est résolue — sans zone, `this.user` vaut `null` sans un
    // mot, et le chat ne saurait pas qui écrit. Session d'abord (le visiteur
    // connecté est reconnu), anonyme ensuite (les autres passent, en lecture).
    // Écrire reste gardé action par action (`@IsGranted`).
    // `(/|$)` : `/demonstration` n'y entre pas. La zone partenaire, au
    // pattern plus LONG, l'emporte sur `/demo/api/partner`.
    [DEMO_AREA]: {
      pattern: "^/demo(/|$)",
      authenticators: ["session", "anonymous"],
    },
    // #endregion
    // #region partner-area
    // Programme qui présente un JETON d'accès : signé par cette application,
    // OU par Keycloak (flux `client_credentials`). Essai de bout en bout :
    // `npx nodefony demo:partner:call`.
    //
    // Les deux authenticators s'aiguillent sur l'émetteur du jeton (`iss`) :
    // leur ordre ne décide de rien. Tous deux exigent l'audience de la zone,
    // `resource` : un jeton émis pour la porte MCP ne l'ouvre pas. L'émetteur
    // de l'application sait signer pour elle sans toucher à `jwt.audiences`.
    [PARTNER_AREA]: {
      pattern: `^${PARTNER_PATH}`,
      authenticators: ["jwt", "external-jwt"],
      stateless: true,
      resource: PARTNER_PATH,
      // L'appelant Keycloak n'a PAS de compte ici : son `sub` est le compte de
      // service du realm. `ephemeral` l'accepte le temps de la requête, avec
      // les seuls rôles ci-dessous. La politique vaut pour CETTE zone :
      // ailleurs, un jeton tiers exige toujours un compte local (`require`).
      subjectPolicy: "ephemeral",
      ephemeralRoles: ["ROLE_PARTNER"],
    },
    // #endregion
    // #region mcp-area
    // La porte MCP de la démo. Le module ne connaît pas l'adresse publique de
    // l'application : il écrit le CHEMIN de sa ressource, et security le rend
    // absolu contre `jwt.issuer` — c'est aussi ce qui permet d'émettre un jeton
    // pour elle sans toucher à `jwt.audiences`. La zone laisse tout passer en
    // anonyme : la porte vérifie elle-même le jeton, et répond dans SON
    // protocole (JSON-RPC), pas en 401 du firewall.
    [MCP_AREA]: {
      pattern: `^${MCP_GATE_PATH}$`,
      authenticators: ["anonymous"],
      stateless: true,
      resource: MCP_GATE_PATH,
    },
    // #endregion
  },
  // #region mcp-grant
  // Qui peut OBTENIR le scope de l'outil réservé : un administrateur. Un autre
  // compte reçoit un jeton SANS lui — l'outil reste alors invisible.
  grantableScopes: { [MCP_WRITE_SCOPE]: ["ROLE_ADMIN"] },
  // #endregion
} satisfies ISecurityConfigInput;
