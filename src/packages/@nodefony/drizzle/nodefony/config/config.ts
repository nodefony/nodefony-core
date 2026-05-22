import path from "node:path";
import { Kernel, Nodefony } from "nodefony";

/** Config d'une connexion Drizzle (driver `better-sqlite3`). */
export interface DrizzleConnectorConfig {
  /** Fichier SQLite. `":memory:"` ou absent → base éphémère en mémoire. */
  filename?: string;
}

/** Config du module `@nodefony/drizzle` : N connexions nommées. */
export interface DrizzleModuleConfig {
  /** Connexions indexées par nom (= clé dans le `ormRegistry`). */
  connectors: Record<string, DrizzleConnectorConfig>;
}

/**
 * Config par défaut : une connexion `default` sur un fichier SQLite local.
 * Surcharge possible côté app via `nodefony/config/modules/drizzle-config.ts`.
 */
const config: DrizzleModuleConfig = {
  connectors: {
    default: {
      // Getter (lazy) : la résolution via le kernel est différée à la LECTURE
      // (au boot/merge de config, le kernel existe). Le module reste ainsi
      // IMPORTABLE sans kernel — indispensable pour tester un module consommateur
      // (`import "@nodefony/drizzle"` n'évalue plus `getKernel().path` à la volée).
      get filename(): string {
        return path.resolve(
          (Nodefony.getKernel() as Kernel).path,
          "nodefony",
          "databases",
          "nodefony-drizzle.db",
        );
      },
    },
  },
};

export default config;
