import nodefony, { Entity, Module } from "nodefony";
import { sequelize, Models } from "@nodefony/sequelize";

const {
  Model,
  //ConnectionOptions,
  Transaction,
  //Options,
  DataTypes,
  NOW,
  Sequelize,
} = sequelize;

class Boat extends Entity {
  constructor(module: Module) {
    /*
     *   @param module instance
     *   @param Entity name
     *   @param orm name
     *   @param connector name
     */
    super(module, "boat", "sequelize", "myconnector");
  }

  getSchema() {
    return {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING,
      },
      size: {
        type: DataTypes.STRING,
      },
    };
  }

  override registerModel(db: sequelize.Sequelize): typeof Model {
    class SessionModel extends Model {
      declare is: number;
      declare name: string;
      declare size: JSON;
      public static associate(models: Models): void {}
    }
    SessionModel.init(this.getSchema(), {
      sequelize: db,
      modelName: this.name,
    });
    return SessionModel;
  }
}

export default Boat;
