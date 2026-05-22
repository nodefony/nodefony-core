// DataTypes pris via @nodefony/sequelize (externalisé par le rollup racine) — un
// import direct de "sequelize" casse le bundle app (paquet CJS/ESM mixte non
// externalisé). Même approche que demo.ts avec @nodefony/drizzle.
import { sequelize } from "@nodefony/sequelize";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";

const { DataTypes } = sequelize;

/**
 * Entité de **démonstration multi-store** (ségrégation, ADR-0003) sur l'ORM
 * **Sequelize** (connecteur `"sequelize"`, base `nodefony-sequelize.db`).
 *
 * `AuditLog` = journal d'audit — un domaine **distinct** de l'app principale
 * (`User` vit sur Drizzle `default`, le gros schéma sur `mediasoup`). C'est le cas
 * où deux vendors ORM cohabitent **légitimement** dans le même kernel : chacun
 * propriétaire de son domaine, sur sa propre base (≠ deux ORM en doublon pour les
 * mêmes données, écarté par l'ADR).
 *
 * `userId` = **référence logique** cross-store vers `User` (Drizzle) : pas de FK
 * enforced, pas de jointure portable (une relation reste intra-ORM). Schéma en
 * `DataTypes` Sequelize ; `SequelizeOrm` le matérialise en table `AuditLog` au boot.
 *
 * Enregistrement au **top-level** (import depuis `index.ts`) → avant le `onBoot`
 * du `SequelizeService` qui crée la table depuis le `entityRegistry`.
 */
const ORM = "sequelize";

const auditEntity: IEntity = {
  orm: ORM,
  name: "AuditLog",
  schema: {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // Action auditée, ex. "user.login", "orm.connect", "post.delete".
    action: { type: DataTypes.STRING, allowNull: false },
    // Cible de l'action (id/nom de ressource), libre.
    target: { type: DataTypes.STRING, allowNull: true },
    // Auteur : référence logique vers User (Drizzle), sans FK cross-store.
    userId: { type: DataTypes.UUID, allowNull: true },
    // IP source (audit sécurité).
    ip: { type: DataTypes.STRING, allowNull: true },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
};

entityRegistry.register(auditEntity);
