import nodefony, { Entity, Module } from "nodefony";
import mongoose, { Schema, Document, Model, SchemaDefinition } from "mongoose";

interface ISession extends Document {
  session_id: string;
  context: string;
  user?: string;
  Attributes: JSON;
  flashBag: JSON;
  metaBag: JSON;
}

interface SessionModel extends Model<ISession> {
  fetchAll(
    callback: (error: Error | null, result: Session[] | null) => void
  ): void;
}

const schema: SchemaDefinition = {
  session_id: {
    type: String,
    index: true,
    unique: true,
  },
  context: {
    type: String,
    default: "default",
  },
  // user: {
  //   type: Schema.Types.ObjectId,
  //   ref: "user",
  // },
  Attributes: {
    type: Object,
    default: {},
  },
  flashBag: {
    type: Object,
    default: {},
  },
  metaBag: {
    type: Object,
    default: {},
  },
};

class Session extends Entity {
  constructor(module: Module) {
    super(module, "session", "mongoose", "nodefony");
  }

  registerModel(db: mongoose.Connection) {
    const mySchema: Schema = new Schema(schema, {
      collection: "sessions",
      timestamps: {
        createdAt: "createdAt",
        updatedAt: "updatedAt",
      },
    });

    mySchema.statics.fetchAll = function fetchAll(callback) {
      return this.find()
        .then((result: ISession[]) => callback(null, result))
        .catch((error: Error) => {
          if (error) {
            return callback(error, null);
          }
        });
    };
    return db.model<ISession, SessionModel>(this.name, mySchema);
  }
}

export default Session;
export { SessionModel, ISession };
