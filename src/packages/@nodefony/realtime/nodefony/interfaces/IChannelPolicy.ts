/**
 * Politique d'autorisation d'un **canal** WebSocket — exigences à satisfaire
 * pour s'y abonner (`subscribe`) ou y pousser (canal inbound full-duplex).
 *
 * Déclarée côté métier via {@link RealtimeChannel}/{@link RealtimeInbound}
 * (`@RealtimeChannel("admin:x", { roles: ["ROLE_ADMIN"] })`), agrégée par le
 * {@link RealtimeHub} et **lue par `@nodefony/security`** (P6) au moment de la
 * frame via le seam `resolveChannelPolicy`. Le module realtime NE décide PAS de
 * l'autorisation (il ne connaît ni la hiérarchie de rôles ni l'identité réelle) :
 * il ne fait que **transporter la déclaration** jusqu'au décideur (le firewall).
 *
 * ⚠️ Cette interface est un **miroir structurel** de `IChannelPolicy` côté
 * `@nodefony/security` (`realtimeContracts.ts`) — les deux modules ne s'importent
 * pas (`package.json` disjoints). Le typage structurel de TS fait le pont à
 * l'exécution. Toute dérive de forme casserait le seam silencieusement.
 *
 * Champs cumulatifs (ET) ; un champ absent = pas de contrainte sur cet axe ;
 * objet entièrement vide = canal libre (équivaut à « pas de politique »).
 */
export interface IChannelPolicy {
  /** Exige une connexion authentifiée (token non anonyme). */
  readonly authenticated?: boolean;
  /** Un de ces rôles suffit (évalué AVEC la hiérarchie de rôles, côté security). */
  readonly roles?: readonly string[];
  /** Un de ces scopes suffit (axe API : JWT/clé API ; session BFF n'en porte pas). */
  readonly scopes?: readonly string[];
}

export default IChannelPolicy;
