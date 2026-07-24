import type { SchemaDefinition } from "mongoose";
import { entity } from "@nodefony/orm-core";

/** ORM cible du stockage de session (connecteur par défaut du module). */
export const SESSION_CONNECTOR = "nodefony";

/**
 * Schéma Mongoose de stockage des sessions (compilé par `MongooseOrm` au boot).
 *
 * Équivalent portable de l'entité session legacy : mêmes champs logiques
 * (`session_id` PK applicative, sacs `Attributes`/`flashBag`/`metaBag`,
 * `user`). Les horodatages sont des **nombres** (ms epoch), comme l'adapter
 * Drizzle, pour que `SessionStorage` reste strictement portable entre les ORM
 * (cutoff GC = `updatedAt < now - ttl`, opérateur riche `$lt` natif Mongo).
 */
const schema: SchemaDefinition = {
  session_id: { type: String, index: true, unique: true },
  Attributes: { type: Object, default: {} },
  flashBag: { type: Object, default: {} },
  metaBag: { type: Object, default: {} },
  user: { type: String, default: null },
  createdAt: { type: Number },
  updatedAt: { type: Number },
};

/** Forme plate d'une ligne de session telle que renvoyée par le repository. */
export interface SessionRow {
  session_id: string;
  Attributes: unknown;
  flashBag: unknown;
  metaBag: unknown;
  user: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Entité session enregistrée dans le `entityRegistry` pour le connecteur
 * `nodefony` — `MongooseOrm` compile le modèle à la connexion (au boot).
 *
 * ⚠️ **`frameworkEntities: false` ne la coupe PAS.** Ce commutateur gouverne les
 * entités déclarées dans le flux de boot (tokens, webauthn, webhooks) ; la
 * session, elle, s'enregistre à l'**import** de ce fichier — le décorateur
 * `@entity` s'exécute au chargement du barrel, avant que la moindre config soit
 * lue. Même chose pour son store (`SessionStorage.ts`, `registerStorage`).
 *
 * Conséquence pratique : couper `frameworkEntities` retire les autres entités,
 * pas la collection `session`. Pour ne pas avoir de session Mongo du tout, il
 * faut ne pas router le store session vers mongoose (`session.store`), pas
 * baisser ce drapeau.
 */
@entity({ connector: SESSION_CONNECTOR, name: "session", schema })
class SessionEntity {}

export default SessionEntity;
export { schema as sessionSchema };
