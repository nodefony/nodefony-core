import fs from "node:fs";
import { FileClass, Finder, Result } from "nodefony";
import type sessionService from "../../../service/sessions/sessions-service";
import type {
  ISessionStorage,
  ISerializedSession,
} from "../../../interfaces/ISession";

const finderGC = function (
  this: FileSessionStorage,
  path: string,
  msMaxlifetime: number,
) {
  let nbSessionsDelete = 0;
  return new Finder().in(path, {
    onFile: (file: FileClass) => {
      const mtime = new Date(file.stats.mtime).getTime();
      if (mtime + msMaxlifetime < new Date().getTime()) {
        file.unlink();
        this.manager.log(
          `FILES SESSIONS STORAGE GARBADGE COLLECTOR SESSION ID : ${file.name} DELETED`,
        );
        nbSessionsDelete++;
      }
    },
    onFinish: (/* error, result*/) => {
      this.manager.log(
        `FILES SESSIONS STORAGE GARBADGE COLLECTOR ==> ${nbSessionsDelete} DELETED`,
      );
    },
  });
};

class FileSessionStorage implements ISessionStorage {
  manager: sessionService;
  path: string;
  gc_maxlifetime: number;
  constructor(manager: sessionService) {
    this.manager = manager;
    this.path = manager.options.save_path;
    this.gc_maxlifetime = manager.options.gc_maxlifetime;
    // Racine de stockage garantie (un seul niveau, plus d'aire) — idempotent.
    try {
      fs.mkdirSync(this.path, { recursive: true });
    } catch (e) {
      this.manager.log(e, "WARNING");
    }
  }

  async start(id: string): Promise<ISerializedSession> {
    let fileSession: FileClass;
    const Path = `${this.path}/${id}`;
    try {
      fileSession = new FileClass(Path);
    } catch (e) {
      this.manager.log(`start storage: ${e}`, "ERROR");
      return Promise.resolve({} as ISerializedSession);
    }
    return this.read(fileSession.path as string);
  }

  async open(): Promise<number> {
    return new Promise((resolve, reject) => {
      const Path = this.path;
      if (!fs.existsSync(Path)) {
        this.manager.log(`create directory sessions ${Path}`);
        try {
          fs.mkdirSync(Path, { recursive: true });
        } catch (e) {
          return reject(e);
        }
        return resolve(0);
      }
      this.gc(this.gc_maxlifetime);
      return new Finder().in(Path, {
        recurse: false,
        onFinish: (result: Result) => {
          let total: number = 0;
          if (result[0]) {
            total = result[0].childrens.length;
          }
          this.manager.log(
            `SESSIONS STORAGE ==> ${this.manager.options.handler.toUpperCase()} COUNT SESSIONS : ${total}`,
          );
          return resolve(total);
        },
      });
    });
  }

  close(): boolean {
    this.gc(this.gc_maxlifetime);
    return true;
  }

  async destroy(id: string): Promise<boolean> {
    let fileDestroy: FileClass;
    const Path = `${this.path}/${id}`;
    try {
      fileDestroy = new FileClass(Path);
    } catch (e) {
      this.manager.log(`STORAGE FILE :${Path}`, "DEBUG");
      return true;
    }
    return new Promise((resolve, reject) => {
      try {
        this.manager.log(
          `FILES SESSIONS STORAGE DESTROY SESSION ID : ${fileDestroy.name} DELETED`,
        );
        fileDestroy.unlink();
        return resolve(true);
      } catch (e) {
        return reject(id);
      }
    });
  }

  async gc(maxlifetime?: number): Promise<void> {
    const msMaxlifetime = (maxlifetime || this.gc_maxlifetime) * 1000;
    if (fs.existsSync(this.path)) {
      finderGC.call(this, this.path, msMaxlifetime);
    }
  }

  read(file: string): Promise<ISerializedSession> {
    return new Promise((resolve, reject) => {
      try {
        fs.readFile(file, "utf8", (err, data) => {
          if (err) {
            return reject(err);
          }
          return resolve(JSON.parse(data) as ISerializedSession);
        });
      } catch (e) {
        this.manager.log(`FILES SESSIONS STORAGE READ  ==> ${e}`, "ERROR");
        return reject(e);
      }
    });
  }

  write(
    fileName: string,
    serialize: ISerializedSession,
  ): Promise<ISerializedSession> {
    const Path = `${this.path}/${fileName}`;
    return new Promise((resolve, reject) => {
      try {
        fs.writeFile(Path, JSON.stringify(serialize), "utf8", (err) => {
          if (err) {
            return reject(err);
          }
          return resolve(serialize);
        });
      } catch (e) {
        this.manager.log(`FILES SESSIONS STORAGE : ${e}`, "ERROR");
        return reject(e);
      }
    });
  }
}

export default FileSessionStorage;
