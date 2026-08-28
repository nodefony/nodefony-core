/**
 * Adapter Mongoose sur `@nodefony/orm-core` (P5.4).
 *
 * 2ᵉ adapter (store documentaire hétérogène), distinct du service legacy.
 */
export { MongooseOrm } from "./MongooseOrm";
export type { IIndexAudit } from "./MongooseOrm";
export { MongooseRepository } from "./MongooseRepository";
export { MongooseTransaction } from "./MongooseTransaction";
