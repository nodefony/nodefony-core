import nodefony, { Entity, Module } from "nodefony";

import sequelize, {
  Model,
  ConnectionOptions,
  Transaction,
  Options,
  DataTypes,
  NOW,
  Sequelize,
  Optional,
  ModelStatic,
} from "sequelize";

type Models = {
  [key: string]: ModelStatic<Model<{}, {}>>;
};

class Session extends Entity {
  constructor(module: Module) {
    /*
     *   @param module instance
     *   @param Entity name
     *   @param orm name
     *   @param connector name
     */
    super(module, "session", "sequelize", "nodefony");
  }

  getSchema() {
    return {
      session_id: {
        type: DataTypes.STRING(126),
        primaryKey: true,
      },
      context: {
        type: DataTypes.STRING(126),
        defaultValue: "default",
      },
      /* username: {
        type: DataTypes.STRING(126),
        defaultValue: "",
        allowNull: true
      },*/
      Attributes: {
        type: DataTypes.JSON,
      },
      flashBag: {
        type: DataTypes.JSON,
      },
      metaBag: {
        type: DataTypes.JSON,
      },
      createdAt: {
        type: DataTypes.DATE,
        defaultValue: NOW,
      },
      updatedAt: {
        type: DataTypes.DATE,
        defaultValue: NOW,
      },
    };
  }

  override registerModel(db: Sequelize): typeof Model {
    class SessionModel extends Model {
      declare session_id: string;
      declare context: string;
      declare Attributes: JSON;
      declare flashBag: JSON;
      declare metaBag: JSON;
      declare createdAt: Date;
      declare updatedAt: Date;

      public static associate(models: Models): void {
        if (models.User) {
          models.User.hasMany(SessionModel, {
            foreignKey: {
              allowNull: true,
              name: "username",
            },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
          });
          SessionModel.belongsTo(models.User, {
            foreignKey: {
              allowNull: true,
              name: "username",
            },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
          });
        } else {
          nodefony.kernel?.log(
            "ENTITY ASSOCIATION user NOT AVAILABLE",
            "WARNING",
            `ENTITY ${this.name}`
          );
        }
      }
    }
    SessionModel.init(this.getSchema(), {
      sequelize: db,
      modelName: this.name,
    });
    return SessionModel;
  }
}

export default Session;
