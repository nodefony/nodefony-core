import { Severity, extend } from "nodefony";
import { SessionsService } from "@nodefony/http";
import mongoose, { Model } from "mongoose";
import SessionEntity, { SessionModel, ISession } from "../entity/sessionEntity";
import orm from "../service/orm";

const finderGC = function finderGC(
  this: SessionStorage,
  msMaxlifetime: number,
  contextSession: string
) {
  const where: mongoose.FilterQuery<any> = {
    context: contextSession,
    updatedAt: {
      $lt: new Date(new Date().getDate() - msMaxlifetime),
    },
  };
  if (this.entity)
    return this.entity
      .deleteMany(where)
      .then((results) => {
        let severity = "DEBUG";
        if (!results) {
          throw new Error("session.storage finderGC no result ");
        }
        if (results && results.deletedCount) {
          severity = "INFO";
          this.manager.log(
            `Context : ${contextSession || "default"} GARBADGE COLLECTOR ==> ${results.deletedCount}  DELETED`,
            "INFO"
          );
        }
        return results;
      })
      .catch((error) => {
        this.manager.log(error, "ERROR");
        throw error;
      });
};

class SessionStorage {
  manager: SessionsService;
  gc_maxlifetime: number;
  contextSessions: string[];
  entity?: Model<ISession, SessionModel>;
  userEntity?: Model<any>;
  orm: orm;
  constructor(manager: SessionsService) {
    this.manager = manager;
    this.orm = this.manager.get("mongoose");
    this.orm.on("onOrmReady", () => {
      this.entity = this.orm.getEntity("session") as Model<
        ISession,
        SessionModel
      >;
      this.userEntity = this.orm.getEntity("user") as Model<any>;
    });
    this.gc_maxlifetime = this.manager.options.gc_maxlifetime;
    this.contextSessions = [];
  }

  start(id: string, contextSession: string) {
    try {
      return this.read(id, contextSession);
    } catch (e) {
      throw e;
    }
  }

  open(contextSession: string) {
    if (this.orm?.kernel?.type !== "CONSOLE") {
      this.gc(this.gc_maxlifetime, contextSession);
      if (this.entity)
        return this.entity
          .countDocuments({
            context: contextSession,
          })
          .then((sessionCount: number) => {
            this.manager.log(
              `CONTEXT ${contextSession ? contextSession : "default"} MONGODB SESSIONS STORAGE  ==>  ${this.manager.options.handler.toUpperCase()} COUNT SESSIONS : ${sessionCount}`,
              "INFO"
            );
          });
    }
  }

  close() {
    this.gc(this.gc_maxlifetime);
    return true;
  }

  destroy(id: string, contextSession: string) {
    if (this.entity)
      return this.entity
        .findOne({
          session_id: id,
          context: contextSession,
        })
        .then((result) => {
          if (result) {
            return result
              .deleteOne({
                force: true,
              })
              .then((session) => {
                this.manager.log(
                  `DB DESTROY SESSION context : ${result.context} ID : ${result.session_id} DELETED`
                );
                return session;
              })
              .catch((error) => {
                this.manager.log(
                  `DB DESTROY SESSION context : ${contextSession} ID : ${id}`,
                  "ERROR"
                );
                throw error;
              });
          }
        })
        .catch((error) => {
          this.manager.log(
            `DB DESTROY SESSION context : ${contextSession} ID : ${id}`,
            "ERROR"
          );
          throw error;
        });
  }

  gc(maxlifetime: number, contextSession?: string) {
    const msMaxlifetime = (maxlifetime || this.gc_maxlifetime) * 1000;
    if (contextSession) {
      finderGC.call(this, msMaxlifetime, contextSession);
    } else if (this.contextSessions.length) {
      for (let i = 0; i < this.contextSessions.length; i++) {
        finderGC.call(this, msMaxlifetime, this.contextSessions[i]);
      }
    }
  }

  read(id: string, contextSession: string) {
    let where: mongoose.FilterQuery<SessionEntity> | null = null;
    if (contextSession) {
      where = {
        session_id: id,
        context: contextSession,
      };
    } else {
      where = {
        session_id: id,
      };
    }
    if (this.entity)
      return this.entity
        .findOne(where)
        .populate([{ path: "user", strictPopulate: false }])
        .then((session) => {
          if (session) {
            return {
              id: session.session_id,
              flashBag: session.flashBag,
              metaBag: session.metaBag,
              Attributes: session.Attributes,
              //username: session.username,
            };
          }
          return {};
        })
        .catch((error) => {
          this.manager.log(error, "ERROR");
          throw error;
        });
  }

  async write(id: string, serialize: any, contextSession?: string) {
    const data = extend({}, serialize, {
      session_id: id,
      context: contextSession || "default",
    });
    if (this.userEntity && data.username) {
      const myuser = await this.userEntity.findOne({
        username: data.username.username,
      });
      data.user = myuser._id;
    }
    if (this.entity)
      return this.entity
        .updateOne(
          {
            session_id: id,
            context: contextSession || "default",
          },
          data,
          {
            upsert: true,
          }
        )
        .then((result) => {
          if (result.modifiedCount) {
            this.manager.log(`UPDATE SESSION : ${data.session_id}`, "DEBUG");
          }
          if (result.upsertedCount) {
            this.manager.log(`ADD SESSION : ${data.session_id}`, "DEBUG");
          }
          return data;
        })
        .catch((error: Error) => {
          throw error;
        });
  }
}

export default SessionStorage;
