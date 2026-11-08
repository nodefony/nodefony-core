import type { NodefonySocket } from "../client/realtime/NodefonySocket";

/**
 * Socket double des tests de la barre de debug — UNE définition, complète.
 *
 * Trois copies partielles vivaient dans trois fichiers : la première lecture
 * d'un membre qu'aucune n'avait (l'instantané de l'onglet Realtime lit
 * `subscribedChannels`, `frameLog`…) faisait tomber 53 tests pour une raison
 * qui n'appartenait à aucun d'eux. Un fichier surcharge ce qu'il observe.
 *
 * @param over - membres remplacés (écouteurs gardés, ouvertures comptées…).
 * @returns une socket déconnectée qui n'émet ni ne reçoit rien.
 */
export function fakeSocket(over: Record<string, unknown> = {}): NodefonySocket {
  return {
    url: null,
    state: "disconnected",
    codec: "nodefony.jsonrpc.v1",
    identity: null,
    serverChannels: null,
    serverMethods: null,
    subscribedChannels: [],
    framesReceived: 0,
    framesUnsent: 0,
    framesDropped: 0,
    binaryFramesDiscarded: 0,
    malformedFramesDiscarded: 0,
    lastFrameMethod: null,
    lastFrameAt: null,
    reconnectAttempts: 0,
    nextRetryAt: null,
    frameLogSince: null,
    frameLog: [],
    on: () => () => {},
    off: () => {},
    onState: () => () => {},
    onIdentity: () => () => {},
    onNotice: () => () => {},
    onFrame: () => () => {},
    onStats: () => () => {},
    onReconnect: () => () => {},
    subscribe: () => {},
    unsubscribe: () => {},
    connect: () => Promise.resolve(),
    disconnect: () => {},
    request: () => Promise.resolve({}),
    ping: () => Promise.resolve({ rtt: 0 }),
    getStats: () => [],
    channel: () => ({
      on: () => () => {},
      send: () => {},
      open: () => {},
      close: () => {},
    }),
    ...over,
  } as unknown as NodefonySocket;
}
