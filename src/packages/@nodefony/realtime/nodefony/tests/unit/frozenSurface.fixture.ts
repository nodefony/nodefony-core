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
