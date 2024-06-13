import {
  Sequelize,
  DataTypes,
  Model,
  Transaction,
  Op,
  DestroyOptions,
  ModelStatic,
  QueryOptions,
  QueryInterfaceIndexOptions,
  WhereOptions,
  FindOptions,
} from "sequelize";
import { Session } from "@nodefony/http";
import sessionEntity from "../entity/sessionEntity";
import { SessionsService } from "@nodefony/http";
import orm, { sequelize } from "../service/orm";
import { Severity, extend } from "nodefony";

class SessionStorage {
  manager: SessionsService;
  orm: orm;
  entity: ModelStatic<any>;
  userEntity?: ModelStatic<any>;
  dialect: any;
  applyTransaction: boolean = false;
  gc_maxlifetime: number;
  contextSessions: string[] = [];

  constructor(manager: SessionsService) {
    this.manager = manager;
    this.orm = this.manager.get("sequelize");
    this.entity = {} as ModelStatic<any>;
    this.orm.once("onOrmReady", () => {
      this.entity = this.orm.getEntity(
        "session"
      ) as unknown as ModelStatic<any>;
      if (!this.entity) {
        throw new Error("Entity session not ready");
      }
      const seq = this.entity?.sequelize as unknown as orm;
      this.dialect = seq.options.dialect;
      this.applyTransaction = this.manager.options.applyTransaction;
      if (this.applyTransaction === true) {
        this.applyTransaction = this.dialect !== "sqlite";
      }
      this.userEntity = this.orm.getEntity(
        "user"
      ) as unknown as ModelStatic<any>;
    });
    this.gc_maxlifetime = this.manager.options.gc_maxlifetime;
    this.contextSessions = [];
  }

  async finderGC(msMaxlifetime: number, contextSession?: string) {
    if (!this.entity) {
      return Promise.resolve(true);
    }
    let transaction: Transaction | null = null;
    if (this.applyTransaction) {
      transaction =
        (await this.entity?.sequelize?.transaction()) as Transaction;
    }
    const now = new Date();
    const mydate = new Date(now.getTime() - msMaxlifetime);
    const query: DestroyOptions = {};
    if (transaction) {
      query.transaction = transaction;
    }
    //query.attributes = ["context", "updatedAt", "session_id"];
    query.force = true;
    query.where = {
      updatedAt: {
        // $lt: mydate
        [Op.lt]: mydate,
      },
    };
    if (contextSession) {
      query.where.context = contextSession;
    }
    return this.entity
      .destroy(query)
      .then(async (results) => {
        if (transaction) {
          await transaction.commit();
        }
        let severity: Severity = "DEBUG";
        // if (results) {
        //   severity = "INFO";
        // }
        this.manager.log(
          `Context : ${contextSession || "default"} GARBAGE COLLECTOR ==> ${results}  DELETED`,
          severity
        );
        return results;
      })
      .catch(async (error) => {
        //@ts-ignore
        if (transaction && !transaction.finished) {
          await transaction.rollback();
        }
        throw error;
      });
  }

  start(id: string, contextSession: string) {
    try {
      return this.read(id, contextSession);
    } catch (e) {
      throw e;
    }
  }

  async open(contextSession: string) {
    if (this.orm?.kernel?.type !== "CONSOLE") {
      await this.gc(this.gc_maxlifetime, contextSession);
      if (!this.entity) {
        return Promise.resolve(0);
      }
      let transaction: Transaction | null = null;
      if (this.applyTransaction) {
        transaction =
          (await this.entity?.sequelize?.transaction()) as Transaction;
      }
      return this.entity
        .count({
          where: {
            context: contextSession,
          },
          transaction,
        })
        .then(async (sessionCount) => {
          if (transaction) {
            await transaction.commit();
          }
          const log = `CONTEXT ${contextSession ? contextSession : "default"} SEQUELIZE SESSIONS STORAGE ==> ${this.manager.options.handler.toUpperCase()} COUNT SESSIONS : ${sessionCount}`;
          this.manager.log(log, "INFO");
        })
        .catch(async (e) => {
          //@ts-ignore
          if (transaction && !transaction.finished) {
            await transaction.rollback();
          }
          this.manager.log(e, "ERROR", "SESSION Storage");
        });
    }
  }

  close() {
    this.gc(this.gc_maxlifetime);
    return true;
  }

  async destroy(id: string, contextSession: string) {
    if (!this.entity) {
      throw new Error("Entity Session not ready");
    }
    let transaction: Transaction | null = null;
    if (this.applyTransaction) {
      transaction =
        (await this.entity?.sequelize?.transaction()) as Transaction;
    }
    const where: WhereOptions = {
      session_id: id,
    };
    if (contextSession) {
      where.context = contextSession;
    }
    return this.entity
      .findOne({
        where,
        transaction,
      })
      .then((result) => {
        if (result) {
          return result
            .destroy({
              force: true,
              transaction,
            })
            .then(async (session: any) => {
              if (transaction) {
                await transaction.commit();
              }
              this.manager.log(
                `DB DESTROY SESSION context : ${session.context} ID : ${session.session_id} DELETED`,
                "DEBUG"
              );
            })
            .catch(async (error: Error) => {
              //@ts-ignore
              if (transaction && !transaction.finished) {
                await transaction.rollback();
              }
              this.manager.log(
                `DB DESTROY SESSION context : ${contextSession} ID : ${id}`,
                "ERROR"
              );
              throw error;
            });
        }
      })
      .catch(async (error) => {
        //@ts-ignore
        if (transaction && !transaction.finished) {
          await transaction.rollback();
        }
        throw error;
      });
  }

  async gc(maxlifetime: number, contextSession?: string) {
    const msMaxlifetime = (maxlifetime || this.gc_maxlifetime) * 1000;
    if (contextSession) {
      await this.finderGC(msMaxlifetime, contextSession);
    } else if (this.contextSessions.length) {
      for (let i = 0; i < this.contextSessions.length; i++) {
        await this.finderGC(msMaxlifetime, this.contextSessions[i]);
      }
    }
  }

  async read(id: string, contextSession: string) {
    if (!this.entity) {
      throw new Error("Entity Session not ready");
    }
    let myWhere: FindOptions;
    let transaction: Transaction | null = null;
    if (this.applyTransaction) {
      transaction =
        (await this.entity?.sequelize?.transaction()) as Transaction;
    }
    const include = [];
    if (this.userEntity) {
      include.push({
        model: this.userEntity,
        required: false,
      });
    }
    if (contextSession) {
      myWhere = {
        where: {
          session_id: id,
          context: contextSession,
        },
        include,
        transaction,
      };
    } else {
      myWhere = {
        where: {
          session_id: id,
        },
        include,
        transaction,
      };
    }
    return this.entity
      .findOne(myWhere)
      .then(async (result) => {
        if (result) {
          if (transaction) {
            await transaction.commit();
          }
          return {
            id: result.session_id,
            flashBag: result.flashBag,
            metaBag: result.metaBag,
            Attributes: result.Attributes,
            created: result.createdAt,
            updated: result.updatedAt,
            username: result.username,
          };
        }
        return {};
      })
      .catch(async (error) => {
        //@ts-ignore
        if (transaction && !transaction.finished) {
          await transaction.rollback();
        }
        this.manager.log(error, "ERROR");
        throw error;
      });
  }

  async write(id: string, serialize: any, contextSession: string) {
    if (!this.entity) {
      throw new Error("Entity Session not ready");
    }
    let transaction: Transaction | null = null;
    if (this.applyTransaction) {
      transaction =
        (await this.entity?.sequelize?.transaction()) as Transaction;
    }
    const data = extend({}, serialize, {
      session_id: id,
      context: contextSession || "default",
    });
    if (data.username) {
      data.username = data.username.username;
    }
    const opt: FindOptions = {
      where: {
        session_id: id,
        context: contextSession || "default",
      },
      transaction,
    };
    return this.entity
      .findOne(opt)
      .then((result) => {
        if (result) {
          return result
            .update(data, {
              where: {
                session_id: id,
                context: contextSession || "default",
              },
              transaction,
            })
            .then(async (session: Session) => {
              if (transaction) {
                await transaction.commit();
              }
              return session;
            })
            .catch(async (error: Error) => {
              //@ts-ignore
              if (transaction && !transaction.finished) {
                await transaction.rollback();
              }
              throw error;
            });
        }
        return this.entity
          .create(data, {
            isNewRecord: true,
            transaction,
          })
          .then(async (session) => {
            if (transaction) {
              await transaction.commit();
            }
            this.manager.log(
              `ADD SESSION : ${session.session_id}${session.username ? ` username :${session.username}` : ""}`,
              "DEBUG"
            );
            return session;
          })
          .catch(async (error) => {
            //@ts-ignore
            if (transaction && !transaction.finished) {
              await transaction.rollback();
            }
            throw error;
          });
      })
      .catch(async (error) => {
        //@ts-ignore
        if (transaction && !transaction.finished) {
          await transaction.rollback();
        }
        if (error) {
          throw error;
        }
      });
  }
}

export default SessionStorage;
