import type { ConnectOptions } from "mongoose";

/**
 * Config d'une connexion Mongoose.
 *
 * Soit une `uri` complète (`mongodb://…` / `mongodb+srv://…`), soit les
 * composants `host`/`port`/`dbname` (assemblés en `mongodb://host:port/dbname`).
 * Les credentials et options de pool passent par `options` (`ConnectOptions`
 * Mongoose : `user`/`pass`/`maxPoolSize`/`serverSelectionTimeoutMS`…).
 */
export interface MongooseConnectorConfig {
  /** URI complète (prioritaire sur `host`/`port`/`dbname` si fournie). */
  uri?: string;
  /** Hôte du serveur MongoDB (défaut `localhost`). */
  host?: string;
  /** Port du serveur (défaut `27017`). */
  port?: number;
  /** Nom de la base (défaut `nodefony`). */
  dbname?: string;
  /** Options de connexion Mongoose (auth, pool, timeouts). */
  options?: ConnectOptions;
}

/** Config du module `@nodefony/mongoose` : N connexions nommées. */
export interface MongooseModuleConfig {
  /** Active le mode debug Mongoose (trace des requêtes). */
  debug?: boolean;
  /** Connexions indexées par nom (= clé dans le `ormRegistry`). */
  connectors: Record<string, MongooseConnectorConfig>;
}

/**
 * Config par défaut : un connecteur `nodefony` sur `localhost:27017/nodefony`.
 *
 * Le nom `nodefony` (≠ `default` de Drizzle) évite toute collision d'entité
 * dans le `entityRegistry` (process-wide) si les deux modules ORM cohabitent —
 * chaque store de session cible son propre connecteur. Surcharge côté app via
 * `use("@nodefony/mongoose", { connectors: { … } })` dans `nodefony.config.ts`.
 */
const config: MongooseModuleConfig = {
  debug: false,
  connectors: {
    nodefony: {
      host: "localhost",
      port: 27017,
      dbname: "nodefony",
    },
  },
};

export default config;
