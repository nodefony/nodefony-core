import { defineMcpGate } from "@nodefony/ai";
<% if (it.oauth) { %>import { env } from "../../env";
import { publicBaseUrl } from "../config/security";
<% } %>import { <%= it.camel %>Tools } from "./<%= it.kebab %>-tools";
<% if (it.oauth) { %>

/**
 * L'URI publique de la porte — l'audience que ses jetons doivent porter
 * (RFC 8707), et l'adresse que publie son document RFC 9728.
 *
 * 🔴 Elle s'ÉCRIT, jamais ne se dérive du `Host` : un en-tête forgé obtiendrait
 * sinon un jeton d'audience arbitraire ET passerait la vérification. Elle suit
 * `NF_JWT_ISSUER` — en production, l'URL que voient les clients : pose-la, sans
 * quoi la porte annonce l'adresse de développement.
 *
 * Pour qu'un jeton émis par CETTE application l'ouvre en développement
 * (`npx nodefony security:mcp:token`), ajoute-la à `jwt.audiences` dans
 * `nodefony/config/security.ts`, écrite sur place :
 * `` `${publicBaseUrl(ctx.env)}<%= it.route %>` ``. Sans elle, l'émetteur refuse de
 * signer (`invalid_target`) — et à juste titre. ⚠️ N'y importe PAS cette
 * fonction : ce fichier importe `security.ts`, et le cycle ferait lire
 * `publicBaseUrl` avant sa définition (`ReferenceError` au démarrage).
 */
export const <%= it.camel %>GateResource = (
  e: Parameters<typeof publicBaseUrl>[0],
): string => `${publicBaseUrl(e)}<%= it.route %>`;
<% } %>

/**
 * La porte MCP `<%= it.route %>` — définie UNE fois, validée au chargement : une clé
 * mal écrite, un outil mal formé ou un nom en double arrêtent le démarrage en
 * nommant la faute, jamais la première requête.
 *
<% if (it.anonymous) { %> * Exposition : MIXTE, derrière un serveur d'autorisation. Un appel SANS jeton
 * est servi avec les seuls outils publics (`anonymous: true`) ; un outil qui
 * porte `scopes` n'est listé et appelable qu'avec un jeton émis pour cette
 * ressource ET porteur de ces scopes. Un jeton refusé (expiré, autre
 * audience, révoqué) est servi comme un anonyme — jamais mieux — et le refus
 * part au journal. Les appels distants sont admis : ce qui est public l'est
 * pour tout le monde, ce qui est réservé l'est par le jeton.
<% } else if (it.oauth) { %> * Exposition : PRODUCTION, derrière un serveur d'autorisation. Un appel sans
 * jeton reçoit `401` et l'en-tête `WWW-Authenticate` qui dit à l'agent où
 * l'obtenir ; un jeton émis pour une autre ressource est refusé (audience) ;
 * les rôles de l'appelant viennent des scopes du jeton. Les appels distants
 * sont admis — c'est le jeton qui protège, plus l'adresse.
 *
 * Le serveur d'autorisation est l'application elle-même (`@nodefony/security`,
 * émetteur `NF_JWT_ISSUER`). Un serveur externe (Keycloak…) se nomme ici, à la
 * place ou en plus — il doit alors émettre l'audience de la porte.
<% } else { %> * Exposition : LOCALE. Seule la machine où tourne l'application peut frapper
 * (toute adresse distante reçoit `403`), aucune page web ne le peut (un en-tête
 * `Origin` hors de `allowedOrigins` reçoit `403` — c'est ce qui ferme le DNS
 * rebinding), et aucun jeton n'est demandé. En production derrière un relais,
 * la porte refuse donc tout le monde : c'est voulu.
 *
 * Pour l'ouvrir en production, régénère-la derrière un serveur d'autorisation
 * (`npx nodefony create controller <nom> --kind mcp --expose oauth`), ou lis
 * `node_modules/@nodefony/ai/docs/mcp.md` § « Monter une porte ».
<% } %> *
 * Une porte publie ce qu'elle CHOISIT : la liste ci-dessous, et rien d'autre.
 * `tools: "modules"` servirait en plus tout outil qu'un module installé déclare
 * (`getMcpTools()`), aujourd'hui ou demain — à réserver à l'outillage.
 */
export const <%= it.camel %>Gate = defineMcpGate({
  instructions:
    "Outils de l'application. Appelle `<%= it.toolPrefix %>_echo` pour vérifier " +
    "que la porte répond.",
  tools: <%= it.camel %>Tools,
<% if (it.oauth) { %>  allowRemote: true,
  authorization: {
    authorizationServers: [publicBaseUrl(env)],
    resource: <%= it.camel %>GateResource(env),
<% if (it.anonymous) { %>    // Sans jeton : les outils publics, et eux seuls. Retirer cette ligne
    // fait de la porte une porte de production (401 sans jeton).
    anonymous: true,
<% } %>  },
<% } %>});
