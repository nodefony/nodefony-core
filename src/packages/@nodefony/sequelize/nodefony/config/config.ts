import path from "node:path";
import { Kernel, Nodefony } from "nodefony";

/**
 * Config du module `@nodefony/sequelize` : N connexions nommées (orm-core).
 *
 * Chaque clé de `connectors` = un nom d'ORM dans le `OrmRegistry` (= la valeur de
 * `entity.orm`). La valeur = des options Sequelize natives (`dialect`, `storage`
 * pour SQLite, ou `host`/`port`/`database`/`username`/`password` pour un serveur).
 * Pour changer de moteur (sqlite → mysql/postgres), on édite ICI — l'entité ne
 * connaît que le NOM du connecteur, jamais le driver.
 *
 * Surcharge possible côté app via `nodefony/config/modules/sequelize-config.ts`.
 */
export default {
  connectors: {
    sequelize: {
      dialect: "sqlite",
      logging: false,
      // Getter lazy : kernel déréférencé à la LECTURE (boot/merge), pas à l'import
      // → le module reste IMPORTABLE sans kernel (testabilité). Runtime inchangé.
      get storage(): string {
        return path.resolve(
          (Nodefony.getKernel() as Kernel).path,
          "nodefony",
          "databases",
          "nodefony-sequelize.db",
        );
      },
    },
  },
};
