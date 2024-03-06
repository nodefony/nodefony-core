import { mkdirp } from "mkdirp";
import fs from "node:fs";
import nodefony, {
  extend,
  Service,
  Kernel,
  Container,
  Event,
  Module,
  FamilyType,
  FileClass,
  Finder,
  Result,
} from "nodefony";
import sessionService, {
  sessionStorageInterface,
  SerializeSessionType,
} from "../../../service/sessions/sessions-service";
import HttpKernel, {
  ProtocolType,
  ServerType,
  ContextType,
} from "../../../service/http-kernel";

const finderGC = function (
  this: FileSessionStorage,
  path: string,
  msMaxlifetime: number,
  context: string
) {
  let nbSessionsDelete = 0;
  return new Finder().in(path, {
    onFile: (file: FileClass) => {
      const mtime = new Date(file.stats.mtime).getTime();
      if (mtime + msMaxlifetime < new Date().getTime()) {
        file.unlink();
        this.manager.log(
          `FILES SESSIONS STORAGE GARBADGE COLLECTOR SESSION context : ${context} ID : ${file.name} DELETED`
        );
        nbSessionsDelete++;
      }
    },
    onFinish: (/* error, result*/) => {
      this.manager.log(
        `FILES SESSIONS STORAGE context : ${context || "default"} GARBADGE COLLECTOR ==> ${nbSessionsDelete} DELETED`
      );
    },
  });
};

class FileSessionStorage implements sessionStorageInterface {
  manager: sessionService;
  path: string;
  gc_maxlifetime: number;
  contextSessions: string[];
  constructor(manager: sessionService) {
    this.manager = manager;
    this.path = manager.options.save_path;
    this.gc_maxlifetime = manager.options.gc_maxlifetime;
    this.contextSessions = [];
  }

  async start(
    id: string,
    contextSession: string
  ): Promise<SerializeSessionType> {
    let fileSession: FileClass;
    let Path: string = "";
    if (contextSession) {
      const dir = `${this.path}/${contextSession}`;
      try {
        new FileClass(dir);
      } catch (error) {
        try {
          mkdirp.sync(dir);
        } catch (e) {
          console.warn(e);
          return Promise.reject(e);
        }
      }
      Path = `${this.path}/${contextSession}/${id}`;
    } else {
      Path = `${this.path}/default/${id}`;
    }
    try {
      fileSession = new FileClass(Path);
    } catch (e) {
      console.trace("start storage", e);
      return Promise.resolve({} as SerializeSessionType);
    }
    try {
      return this.read(fileSession.path as string);
    } catch (e) {
      throw e;
    }
  }

  async open(contextSession: string): Promise<number> {
    return new Promise((resolve, reject) => {
      let Path = null;
      if (contextSession) {
        Path = `${this.path}/${contextSession}`;
        this.contextSessions.push(contextSession);
      } else {
        Path = this.path;
      }
      const res = fs.existsSync(Path);
      let result: Result;
      if (!res) {
        this.manager.log(`create directory context sessions ${Path}`);
        try {
          mkdirp.sync(Path);
        } catch (e) {
          return reject(e);
        }
      } else {
        this.gc(this.gc_maxlifetime, contextSession);
        return new Finder().in(Path, {
          recurse: false,
          onFinish: (result: Result) => {
            let total: number = 0;
            if (result[0]) {
              total = result[0].childrens.length;
            }
            this.manager.log(
              `CONTEXT ${contextSession ? contextSession : "GLOBAL"} SESSIONS STORAGE  ==>  ${this.manager.options.handler.toUpperCase()} COUNT SESSIONS : ${total}`
            );

            return resolve(total);
          },
        });
      }
      return resolve(0);
    });
  }

  close(): boolean {
    this.gc(this.gc_maxlifetime);
    return true;
  }

  async destroy(id: string, contextSession: string): Promise<boolean> {
    let fileDestroy: FileClass;
    let Path = null;
    if (contextSession) {
      Path = `${this.path}/${contextSession}/${id}`;
    } else {
      Path = `${this.path}/default/${id}`;
    }
    try {
      fileDestroy = new FileClass(Path);
    } catch (e) {
      this.manager.log(`STORAGE FILE :${Path}`, "DEBUG");
      return true;
    }
    return new Promise((resolve, reject) => {
      try {
        this.manager.log(
          `FILES SESSIONS STORAGE DESTROY SESSION context : ${contextSession} ID : ${fileDestroy.name} DELETED`
        );
        fileDestroy.unlink();
        return resolve(true);
      } catch (e) {
        return reject(id);
      }
    });
  }

  async gc(maxlifetime?: number, contextSession?: string): Promise<void> {
    const msMaxlifetime = (maxlifetime || this.gc_maxlifetime) * 1000;
    if (contextSession) {
      const Path = `${this.path}/${contextSession}`;
      finderGC.call(this, Path, msMaxlifetime, contextSession);
    } else if (this.contextSessions.length) {
      for (let i = 0; i < this.contextSessions.length; i++) {
        finderGC.call(
          this,
          `${this.path}/${this.contextSessions[i]}`,
          msMaxlifetime,
          this.contextSessions[i]
        );
      }
    }
  }

  read(file: string): Promise<SerializeSessionType> {
    return new Promise((resolve, reject) => {
      // let id = file.name;
      try {
        fs.readFile(file, "utf8", (err, data) => {
          if (err) {
            return reject(err);
          }
          return resolve(JSON.parse(data) as SerializeSessionType);
        });
      } catch (e) {
        this.manager.log(`FILES SESSIONS STORAGE READ  ==> ${e}`, "ERROR");
        return reject(e);
      }
    });
  }

  write(
    fileName: string,
    serialize: SerializeSessionType,
    contextSession: string
  ): Promise<SerializeSessionType> {
    let Path: string = "";
    if (contextSession) {
      Path = `${this.path}/${contextSession}/${fileName}`;
    } else {
      Path = `${this.path}/default/${fileName}`;
    }
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
