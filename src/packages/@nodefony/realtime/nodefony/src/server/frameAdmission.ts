import type { IJsonRpcNotification, IJsonRpcRequest } from "nodefony";
import type { IRealtimeConnectionState } from "../../interfaces/IRealtimeConnectionState";
import type { RealtimeHub } from "./RealtimeHub";
import type { RealtimeInboundHandler } from "../../interfaces/IRealtimeController";

/**
 * Verdicts du verrou retenus par connexion, au plus (ADR-0022 §6, décision 1 ter).
 *
 * Borne la table qu'un client remplit en poussant sur des canaux entrants : au-delà,
 * le verrou est consulté à chaque trame, il n'est jamais contourné. Une admission
 * par `allow` n'y est pas soumise — elle est déjà bornée par le plafond de canaux
 * de la connexion.
 */
export const MAX_RETAINED_FRAME_VERDICTS = 64;

/**
 * Méthodes du protocole : leurs trames ne sont JAMAIS admises d'office, même si un
 * canal entrant porte ce nom. `subscribe` et `api.request` restent sur le verrou ;
 * `ping` et `unsubscribe` passent sans règle (le verrou n'a rien à en dire).
 */
const PROTOCOL_METHODS: ReadonlySet<string> = new Set([
  "subscribe",
  "unsubscribe",
  "ping",
  "api.request",
]);

/**
 * La connexion peut-elle admettre d'office les trames de ce nom ?
 *
 * Seulement un canal ENTRANT déclaré — une clé PROPRE de la table, jamais une
 * héritée de son prototype —, qui n'est ni une méthode du protocole ni une
 * action : la lecture admise ne regarde que le nom, et une requête d'action du
 * même nom passerait sinon sans le verrou. Cold path (admission, jamais par trame).
 */
function canAdmit(
  state: IRealtimeConnectionState,
  inbound: Record<string, RealtimeInboundHandler>,
  name: string,
): boolean {
  return (
    Object.hasOwn(inbound, name) &&
    !PROTOCOL_METHODS.has(name) &&
    !state.peer.methods.includes(name)
  );
}

/**
 * Table des admis de la connexion, créée à la première admission.
 *
 * Mêmes clés, dans le même ordre, que la table entrante, toutes à `false` :
 * toutes les connexions d'un contrôleur partagent ainsi UNE forme d'objet, et la
 * lecture chaude reste monomorphe. Mesuré sur la trame réelle (médiane de 9) :
 * objet de forme commune ≈ 0 ns, objets de formes diverses +15 ns, `Set` +26 à
 * +30 ns. Une admission passe une clé existante à `true`, un retrait à `false` —
 * jamais d'ajout ni de `delete`, qui changeraient la forme.
 */
function admittedTable(
  state: IRealtimeConnectionState,
  inbound: Record<string, RealtimeInboundHandler>,
): Record<string, boolean> {
  let admitted = state.admitted;
  if (admitted === null) {
    admitted = {};
    for (const name of Object.keys(inbound)) admitted[name] = false;
    state.admitted = admitted;
  }
  return admitted;
}

/**
 * Admet les trames entrantes d'un canal que sa règle `allow` vient d'ouvrir à la connexion.
 *
 * Pas de plafond propre : le nombre de canaux ouverts l'est déjà. Sans effet si le
 * canal n'accepte pas d'entrée client.
 *
 * @param state - état de la connexion.
 * @param channel - canal ouvert par `allow`.
 */
export function admitByRule(
  state: IRealtimeConnectionState,
  channel: string,
): void {
  const inbound = state.inbound;
  if (inbound === null || !canAdmit(state, inbound, channel)) return;
  admittedTable(state, inbound)[channel] = true;
}

/**
 * Retire l'admission d'un canal à la fin de son abonnement — celle de sa règle
 * `allow`, que rien ne justifie plus. Un verdict du verrou, lui, ne tient qu'à
 * l'identité et survit au désabonnement.
 *
 * @param state - état de la connexion.
 * @param channel - canal quitté.
 */
export function releaseRuleAdmission(
  state: IRealtimeConnectionState,
  channel: string,
): void {
  const admitted = state.admitted;
  if (admitted === null || admitted[channel] !== true) return;
  if (state.retained?.includes(channel) === true) return;
  admitted[channel] = false;
}

/**
 * Retient le « oui » du verrou pour un canal entrant à politique fixe (jamais un refus).
 *
 * Au plus {@link MAX_RETAINED_FRAME_VERDICTS} par connexion. La première retenue
 * inscrit la connexion auprès du hub, qui pourra la vider si une politique arrive
 * après coup.
 */
function retainVerdict(
  state: IRealtimeConnectionState,
  method: string,
  hub: RealtimeHub,
): void {
  const retained = state.retained;
  if (retained !== null && retained.length >= MAX_RETAINED_FRAME_VERDICTS)
    return;
  const inbound = state.inbound;
  if (inbound === null || !canAdmit(state, inbound, method)) return;
  admittedTable(state, inbound)[method] = true;
  if (retained === null) {
    state.retained = [method];
    hub.trackRetainedVerdicts(state);
  } else retained.push(method);
}

/**
 * Oublie les verdicts du verrou retenus par la connexion — leur politique vient
 * de changer. Les admissions par `allow` restent : elles valent autant que
 * l'abonnement qui les porte.
 *
 * @param state - état de la connexion.
 */
export function dropRetainedVerdicts(state: IRealtimeConnectionState): void {
  const retained = state.retained;
  if (retained === null) return;
  const admitted = state.admitted;
  if (admitted !== null) for (const name of retained) admitted[name] = false;
  state.retained = null;
}

/**
 * Juge une trame entrante que la connexion n'a pas admise d'office (ADR-0022 §6, décision 1 ter).
 *
 * Dans l'ordre :
 * - une REQUÊTE (action, `api.request`) passe par le verrou, toujours ;
 * - `ping` et `unsubscribe` passent sans règle ;
 * - `subscribe` passe par le verrou (`allow` est jugé après, à l'ouverture) ;
 * - un nom hérité du prototype de la table entrante est refusé ;
 * - un canal entrant à `allow` que l'abonnement n'a pas admis est refusé ;
 * - un canal entrant à politique fixe passe par le verrou, dont le « oui » est retenu ;
 * - toute autre notification passe par le verrou.
 *
 * Le premier test du contrôleur (`admitted[method] === true`) a déjà écarté les trames
 * admises : rien ici n'est sur le chemin d'une trame chaude.
 *
 * @param state - état de la connexion.
 * @param frame - trame déjà classée par le pair.
 * @param hub - hub qui porte le verrou et les règles.
 * @returns `true` si la trame peut être distribuée.
 */
export function gateFrame(
  state: IRealtimeConnectionState,
  frame: IJsonRpcRequest | IJsonRpcNotification,
  hub: RealtimeHub,
): boolean {
  if ("id" in frame) return hub.runAuthorizer(frame, state.peer);
  const method = frame.method;
  if (method === "ping" || method === "unsubscribe") return true;
  const inbound = state.inbound;
  if (method === "subscribe" || inbound === null) {
    return hub.runAuthorizer(frame, state.peer);
  }
  if (!Object.hasOwn(inbound, method)) {
    // `__proto__`, `toString`… : la distribution lit la table par ce nom et y
    // trouverait une fonction que personne n'a déclarée (`hasOwnProperty`, appelée
    // sans receveur, lève hors de tout `try`).
    if (method in inbound) return false;
    return hub.runAuthorizer(frame, state.peer);
  }
  if (hub.resolveChannelAdmission(method) !== null) return false;
  if (!hub.runAuthorizer(frame, state.peer)) return false;
  retainVerdict(state, method, hub);
  return true;
}
