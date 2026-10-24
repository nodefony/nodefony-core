/**
 * `nodefony/syslog` — règles de LECTURE des journaux, pures et isomorphes :
 * classer une ligne par protocole et par étape, reconnaître le trafic de la
 * console, lire une ligne d'accès, la famille d'un statut, l'indice d'une frame
 * WebSocket.
 *
 * Seuls les visualiseurs de journaux s'en servent (la console d'administration,
 * la barre de débogage) : hors de `nodefony/client`, une application ordinaire
 * ne les télécharge pas. Le serveur les lit toujours depuis `nodefony` — mêmes
 * fonctions, une seule définition. L'ÉMISSION des journaux du navigateur
 * (`installSyslogUplink`, `installErrorCapture`) reste dans `nodefony/client` :
 * toute page peut en avoir besoin.
 */
export { pduProtocol } from "../../syslog/drivers/pduProtocol";
export type { LogProtocol } from "../../syslog/drivers/pduProtocol";
export {
  accessStatusFamily,
  consoleRequestIds,
  parseAccessLine,
  pduIsConsoleRequest,
  pduIsConsoleTraffic,
  pduIsModuleExcluded,
} from "../../syslog/drivers/pduConsole";
export type { IAccessLine } from "../../syslog/drivers/pduConsole";
export { pduFlowStep, FLOW_STEPS } from "../../syslog/drivers/pduFlow";
export type { FlowStepId, FlowStepMeta } from "../../syslog/drivers/pduFlow";
export { frameIndexOf } from "../../runtime/frameRequestId";
