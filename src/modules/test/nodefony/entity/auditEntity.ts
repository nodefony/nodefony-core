// DataTypes pris via @nodefony/sequelize (externalisé par rollup) — un import
// direct de "sequelize" casse le bundle (paquet CJS/ESM mixte). Idem ex-BoatEntity.
import { sequelize } from "@nodefony/sequelize";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";

const { DataTypes } = sequelize;

/**
 * Entité de **démonstration** du module test (playground) sur l'ORM **Sequelize**
 * (connecteur `"sequelize"`, base `nodefony-sequelize.db`) — remplace l'ancienne
 * `BoatEntity` legacy.
 *
 * `AuditLog` = journal d'audit, domaine **distinct** des stores Drizzle
 * (`default` = User, `mediasoup` = gros schéma) → démo multi-store par ségrégation
 * (ADR-0003) : chaque vendor propriétaire de son domaine, sur sa propre base.
 *
 * `userId` = **référence logique** cross-store vers `User` (Drizzle) : pas de FK,
 * pas de jointure portable (une relation reste intra-ORM). Schéma `DataTypes`
 * Sequelize ; `SequelizeOrm` matérialise la table `AuditLog` au boot.
 *
 * Enregistrement au **top-level** (import side-effect depuis `index.ts`) → avant le
 * `onBoot` du `SequelizeService` qui crée la table depuis le `entityRegistry`.
 */
const auditEntity: IEntity = {
  orm: "sequelize",
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
