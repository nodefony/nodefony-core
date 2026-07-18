// Re-export du contrat d'idempotence — la SOURCE DE VÉRITÉ vit désormais au CORE
// (`nodefony/src/types/IIdempotencyStore.ts`). Raison du déplacement : permettre
// à `@nodefony/redis` / `@nodefony/drizzle` (graphe sous orm-core/core, qui NE
// dépendent PAS de @nodefony/framework) d'implémenter une variante distribuée du
// store sans cycle de dépendance. Même motif que `IAdminApi`/`ITokenStore`.
//
// Ce fichier subsiste comme façade pour garder stables les imports relatifs
// internes (`../interfaces/IIdempotencyStore`) du service `IdempotencyStore` et
// de `AdminApiController`, et la ré-export publique de `@nodefony/framework`.
export type {
  IIdempotencyStore,
  IIdempotencyKeyEntry,
  IIdempotencyListQuery,
  IdempotencyOutcome,
  IdempotentResponse,
} from "nodefony";
