/**
 * payload — forme admise d'une charge publiée sur un canal realtime, **règle isomorphe**
 * appelée des deux bords de la socket (serveur : `RealtimeHub.publish` ; navigateur :
 * `NodefonySocket.publish`).
 *
 * La charge d'un canal devient le `params` d'une notification JSON-RPC 2.0. La norme
 * (§4.2) exige qu'un `params` présent soit STRUCTURÉ — un objet (paramètres nommés) ou un
 * tableau (paramètres positionnels). Un pair écrit dans un autre langage refuse donc la
 * trame d'un scalaire (ADR-0021 S1, amendement ; scénario S-rt-43). Un scalaire se publie
 * dans un objet : `{ value: 42 }`.
 *
 * Une charge ABSENTE reste admise : JSON-RPC autorise une notification sans `params`, et
 * `publish(canal)` est un signal légitime (« rafraîchis », fin de compilation).
 *
 * Pur, sans allocation : un `typeof` par publication, hors de la boucle de diffusion.
 */

/**
 * Dit si une valeur est une charge realtime admise : absente, un objet, un tableau ou des octets — jamais un nombre, une chaîne, un booléen ni `null`.
 *
 * Les octets (`Uint8Array`, `ArrayBuffer`…) sont des objets, donc admis (ADR-0021 S8).
 * Une fonction est refusée : elle ne se sérialise pas.
 *
 * @param value - la charge proposée à `publish`.
 * @returns `true` si la charge peut partir telle quelle sur le fil.
 */
export function isRealtimePayload(value: unknown): value is object | undefined {
  return value === undefined || (typeof value === "object" && value !== null);
}

/**
 * Construit l'erreur levée quand un producteur publie une charge refusée par {@link isRealtimePayload}.
 *
 * Partagée par les deux bords pour que le message soit le même côté serveur et côté
 * navigateur — il nomme le canal, le type reçu et le geste correctif.
 *
 * @param channel - canal visé par la publication fautive.
 * @param value - la charge refusée.
 * @returns une `TypeError` à lever à la ligne fautive.
 */
export function realtimePayloadError(
  channel: string,
  value: unknown,
): TypeError {
  const kind = value === null ? "null" : typeof value;
  return new TypeError(
    `realtime: le canal « ${channel} » reçoit une charge de type ${kind} — une charge est un objet ou un tableau, ou absente (JSON-RPC 2.0 §4.2) : publier { value } plutôt qu'un scalaire`,
  );
}
