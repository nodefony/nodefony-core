/**
 * Surface temps réel FIGÉE par la publication de 10.0 — ce qu'une application
 * lit dans un `switch`, une alerte ou un tableau de bord, et qu'aucune version
 * de la série ne peut plus renommer ni retirer (ADR-0021 §S9 et §S11, ADR-0022 §6).
 *
 * Une entrée porte `ticket` tant que le code ne la tient pas encore : le ticket
 * nommé l'ajoute, et retire `ticket` de cette fixture dans le même commit — le
 * test `frozenSurface.test.ts` l'exige. Ajouter une entrée ici, c'est décider
 * une rupture : on ne le fait qu'en amendant l'ADR d'abord.
 */

/** Codes de fermeture de la socket, registre `src/nodefony/src/realtime/closeCodes.ts` (S11). */
export const FROZEN_CLOSE_CODES = [
  { code: 4001, name: "IDENTITY_DEAD_CLOSE_CODE" },
  { code: 4003, name: "ORIGIN_REFUSED_CLOSE_CODE" },
  { code: 4004, name: "NOT_FOUND_CLOSE_CODE" },
  { code: 4005, name: "IDENTITY_REFRESH_CLOSE_CODE" },
  { code: 4006, name: "TOKEN_EXPIRED_CLOSE_CODE" },
  { code: 4007, name: "BACKPRESSURE_CLOSE_CODE" },
  { code: 1013, name: "TRY_AGAIN_LATER_CLOSE_CODE" },
] as const;

/** Motifs fermés de `realtime:denied` (`RealtimeDeniedReason`, S10 bis point 3). */
export const FROZEN_DENIED_REASONS = [
  { name: "forbidden" },
  { name: "limit" },
  { name: "unknown" },
  { name: "unavailable" },
] as const;

/** Motifs fermés de `realtime:closed` (`RealtimeClosedReason`, ADR-0021 S4, ADR-0022 §6 décision 3). */
export const FROZEN_CLOSED_REASONS = [
  { name: "ended" },
  { name: "evicted" },
] as const;

/** Compteurs de REFUS, un par cause, ensemble fermé (S9) — sonde du hub. */
export const FROZEN_REFUSAL_COUNTERS = [
  { name: "ingressRejectedTotal" },
  { name: "ingressUnknownDiscardedTotal" },
  { name: "systemFloorDeniedTotal" },
  { name: "sealRejectedTotal" },
  { name: "frameRateRejectedTotal" },
  { name: "allowTimedOutTotal" },
  { name: "allowSaturatedTotal" },
  { name: "authenticateTimedOutTotal" },
  { name: "binaryDiscardedTotal" },
  { name: "malformedDiscardedTotal" },
] as const;

/**
 * Porte du CONTRAT temps réel côté serveur (ADR-0022 §4) — les noms qu'une
 * application écrit dans son code. Règle de nommage : `Contract…<C>` = la même
 * chose que sa forme libre, lue à travers le contrat.
 */
export const FROZEN_CONTRACT_VALUES = [
  { name: "ContractRealtimeController" },
  { name: "getRealtimeHub" },
] as const;

/**
 * Arrêt propre de la présence répartie (ADR-0025 P5) — ce qu'une application qui
 * fournit son propre bus appelle à l'arrêt.
 */
export const FROZEN_PRESENCE_VALUES = [
  { name: "shutdownRealtime", kind: "function" },
  { name: "BACKPLANE_STOP_TIMEOUT_MS", kind: "number" },
] as const;

/** Types de la même porte : vérifiés à la compilation par `frozenSurface.test.ts`. */
export const FROZEN_CONTRACT_TYPES = [
  { name: "ContractRealtimePublish" },
  { name: "IContractRealtimeHub" },
  { name: "ContractRealtimeMethodHandlers" },
  { name: "ContractPolicyNames" },
  { name: "RealtimeContractOf" },
] as const;

/**
 * Canal personnel (ADR-0022 §6, D1, #710) — ce qu'une application appelle pour
 * livrer à une personne, et le compteur qui rend visible un canal oublié du bus.
 */
export const FROZEN_PERSONAL_CHANNEL = [
  { name: "publishToUser", on: "RealtimeHub" },
  { name: "onUser", on: "NodefonySocket" },
  { name: "localOnlyTotal", on: "IRealtimeProbe" },
] as const;

/**
 * PRÉSENCE répartie d'un canal (ADR-0025, #760 étape 6) — tout ce qu'un pod d'une
 * AUTRE version lit sur le bus, ce qu'un navigateur lit dans la trame, ce qu'une
 * application écrit dans sa politique et appelle. Deux pods de versions voisines
 * coexistent pendant un déploiement progressif : un champ renommé ici casse la
 * présence entre eux, sans une erreur.
 */

/** Canaux du bus entre pods (`PLATFORM_BUS_CHANNELS`, cœur). */
export const FROZEN_PRESENCE_BUS_CHANNELS = [
  { key: "presence", value: "nodefony:bus:presence" },
  { key: "presenceAlive", value: "nodefony:bus:presence:alive" },
] as const;

/** Champs des messages entre pods (`backplane/presenceMessage.ts`), par message — ensembles FERMÉS. */
export const FROZEN_PRESENCE_BUS_FIELDS = {
  batch: ["op", "incarnation", "seq", "prev", "channels"],
  request: ["op", "incarnation", "seq", "channels", "to"],
  state: ["op", "incarnation", "seq", "last", "i", "n", "channels"],
  alive: ["incarnation", "seq", "last", "interval", "final"],
  channelDelta: ["channel", "set", "gone", "unnamed"],
  channelState: ["channel", "members", "unnamed"],
} as const;

/** Trame navigateur `realtime:presence` (`RealtimeEventMap.ts`, cœur) — ensembles FERMÉS. */
export const FROZEN_PRESENCE_FRAME = {
  method: "realtime:presence",
  head: ["channel", "version", "count", "unnamed", "partial"],
  list: ["members", "states", "changes"],
  changes: ["set", "states", "gone"],
  entry: ["tabs", "states"],
} as const;

/** Clé de politique et ses options (`IChannelPolicy.presence`, `IChannelPresenceOptions`) — options FERMÉES. */
export const FROZEN_PRESENCE_POLICY = {
  key: "presence",
  options: ["grace", "maxNamed"],
} as const;

/** API : valeurs exportées, par paquet. */
export const FROZEN_PRESENCE_API = [
  { name: "PresenceView", from: "nodefony", kind: "function" },
  { name: "isPresenceFrame", from: "nodefony", kind: "function" },
  { name: "EMPTY_PRESENCE", from: "nodefony", kind: "object" },
  { name: "PRESENCE_RESYNC_MS", from: "nodefony", kind: "number" },
  { name: "PRESENCE_RESYNC_JITTER", from: "nodefony", kind: "number" },
  { name: "REALTIME_PRESENCE_METHOD", from: "nodefony", kind: "string" },
  { name: "observePresence", from: "nodefony/client", kind: "function" },
  { name: "PRESENCE_WINDOW_MS", from: "@nodefony/realtime", kind: "number" },
  {
    name: "DEFAULT_PRESENCE_MAX_NAMED",
    from: "@nodefony/realtime",
    kind: "number",
  },
] as const;

/** Méthodes, par type qui les porte (dont les quatre liaisons de vue). */
export const FROZEN_PRESENCE_METHODS = [
  { name: "presence", on: "RealtimeHub" },
  { name: "endPresence", on: "RealtimeHub" },
  { name: "onPresence", on: "NodefonySocket" },
  { name: "presence", on: "NodefonySocket" },
  { name: "useNodefonyPresence", on: "react" },
  { name: "useNodefonyPresence", on: "vue" },
  { name: "injectNodefonyPresence", on: "angular" },
  { name: "nodefonyPresence", on: "svelte" },
] as const;

/** Compteurs de REFUS de la présence (`IPresenceProbe`), un par cause — ensemble FERMÉ. */
export const FROZEN_PRESENCE_COUNTERS = [
  { name: "presenceRejectedTotal" },
  { name: "presenceStaleDiscardedTotal" },
] as const;
