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
 * Retire TOUTE admission d'un canal à la connexion — marque de sa règle ET verdict retenu du verrou — quand le serveur l'en éjecte ou le termine (ADR-0022 §6 décision 3).
 *
 * Plus fort que {@link releaseRuleAdmission}, qui garde le verdict du verrou :
 * après une éjection, une trame entrante sur ce canal repasse par le verrou.
 *
 * @param state - état de la connexion.
 * @param channel - canal dont la connexion est retirée.
 */
export function revokeAdmission(
  state: IRealtimeConnectionState,
  channel: string,
): void {
  const retained = state.retained;
  if (retained !== null) {
    const at = retained.indexOf(channel);
    if (at !== -1) {
      retained.splice(at, 1);
      if (retained.length === 0) state.retained = null;
    }
  }
  const admitted = state.admitted;
  if (admitted?.[channel] === true) admitted[channel] = false;
}

/**
 * Retire l'admission d'un canal à la fin de son abonnement quand elle en dépendait — celle d'un canal à `allow`, dont l'abonnement est la condition.
 *
 * Un verdict du verrou sur un canal SANS `allow` ne tient qu'à l'identité et
 * survit au désabonnement ; sur un canal à `allow`, il ne valait que le temps
 * de l'abonnement (ADR-0022 §6, décisions 1 et 1 quater).
 *
 * @param state - état de la connexion.
 * @param channel - canal quitté.
 * @param hub - hub qui porte les règles d'admission.
 */
export function releaseRuleAdmission(
  state: IRealtimeConnectionState,
  channel: string,
  hub: RealtimeHub,
): void {
  if (state.admitted?.[channel] !== true) return;
  if (hub.resolveChannelAdmission(channel) !== null) {
    revokeAdmission(state, channel);
  }
}

/**
 * Retient le « oui » du verrou pour un canal entrant (jamais un refus).
 *
 * Au plus {@link MAX_RETAINED_FRAME_VERDICTS} par connexion, sauf sur un canal
 * à `allow` (`bySubscription`) : ceux-là sont déjà bornés par le plafond de
 * canaux ouverts. La première retenue inscrit la connexion auprès du hub, qui
 * pourra la vider si une politique arrive après coup.
 */
function retainVerdict(
  state: IRealtimeConnectionState,
  method: string,
  hub: RealtimeHub,
  bySubscription: boolean,
): void {
  const retained = state.retained;
  if (
    !bySubscription &&
    retained !== null &&
    retained.length >= MAX_RETAINED_FRAME_VERDICTS
  )
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
 * de changer. Ceux des canaux à `allow` compris : une écriture inscrite après
 * coup doit être jugée à la trame suivante, abonnement ou pas. `allow`, lui,
 * n'est pas redemandé — l'abonnement reste.
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
 * - un canal entrant à `allow` exige l'abonnement de CETTE connexion (`allow`
 *   n'est jamais rappelé), puis passe par le verrou comme les autres ;
 * - un canal entrant passe par le verrou — lecture ET écriture —, dont le « oui »
 *   est retenu ;
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
  // Canal à `allow` : l'abonnement fait foi de l'admission. Le verrou juge
  // ensuite lecture ET écriture — une admission ne vaut pas droit d'écrire.
  const bySubscription = hub.resolveChannelAdmission(method) !== null;
  if (bySubscription && !state.channels.has(method)) return false;
  if (!hub.runAuthorizer(frame, state.peer)) return false;
  retainVerdict(state, method, hub, bySubscription);
  return true;
}
