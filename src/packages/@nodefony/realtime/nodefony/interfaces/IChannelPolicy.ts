/**
 * Politique d'autorisation d'un canal — déclaration UNIQUE, au cœur (`nodefony`).
 *
 * Réexportée ici pour que `import type { IChannelPolicy } from "@nodefony/realtime"`
 * continue de compiler. Elle n'est plus recopiée : `@nodefony/security`, qui la
 * juge, lit la même déclaration — deux copies dérivaient en silence.
 */
export type { IChannelPolicy, IChannelPolicy as default } from "nodefony";
