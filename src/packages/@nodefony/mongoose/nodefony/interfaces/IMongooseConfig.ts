import type { z } from "zod";
import type { mongooseConfigSchema } from "../config/schema";

/**
 * Configuration normalisée et gelée de `@nodefony/mongoose` (sortie du builder
 * {@link defineMongooseConfig}, consommée par le `MongooseService`).
 *
 * Type **dérivé du schéma Zod** — NE PAS redéclarer les champs à la main (ils
 * divergeraient silencieusement de la source de vérité `config/schema.ts`).
 */
export type IMongooseConfig = z.infer<typeof mongooseConfigSchema>;

/**
 * Entrée du builder `defineMongooseConfig` — tous les champs portant un défaut
 * sont optionnels (l'app ne fournit que ce qu'elle surcharge dans `use()`).
 */
export type IMongooseConfigInput = z.input<typeof mongooseConfigSchema>;

/** Définition d'une connexion Mongoose nommée (sous-objet de `connectors`). */
export type IMongooseConnectorConfig = IMongooseConfig["connectors"][string];
