import fs from "node:fs";
import { resolve } from "node:path";
import { FileClass, Finder, Result } from "nodefony";
import type sessionService from "../../../service/sessions/sessions-service";
import type {
  ISessionStorage,
  ISerializedSession,
  ISessionRecord,
  ISessionListFilter,
} from "../../../interfaces/ISession";

const finderGC = function (
  this: FileSessionStorage,
  path: string,
  idleMs: number,
  absoluteMs: number,
  onDone?: () => void,
) {
  let nbSessionsDelete = 0;
  const now = Date.now();
  return new Finder().in(path, {
    onFile: (file: FileClass) => {
      // Deux bornes NIST/OWASP portées par le FILESYSTEM : `mtime` = dernière
      // activité (idle, rafraîchi par le touch via `utimes`) ; `birthtime` =
      // création (absolute, JAMAIS prolongé). Purge dès qu'une borne ACTIVE est
      // dépassée. Garde anti-FS-sans-birthtime (`birth > 0`) : sinon un FS qui
      // renvoie l'epoch purgerait TOUTES les sessions → l'absolute est ignoré.
      const mtime = new Date(file.stats.mtime).getTime();
      const birth = new Date(file.stats.birthtime).getTime();
      const idleExpired = idleMs > 0 && mtime + idleMs < now;
      const absoluteExpired =
        absoluteMs > 0 &&
        Number.isFinite(birth) &&
        birth > 0 &&
        birth + absoluteMs < now;
      if (idleExpired || absoluteExpired) {
        file.unlink();
        this.manager.log(
          `FILES SESSIONS STORAGE GARBAGE COLLECTOR SESSION ID : ${file.name} DELETED`,
        );
        nbSessionsDelete++;
      }
    },
    onFinish: (/* error, result*/) => {
      this.manager.log(
        `FILES SESSIONS STORAGE GARBAGE COLLECTOR ==> ${nbSessionsDelete} DELETED`,
      );
      onDone?.();
    },
  });
};

class FileSessionStorage implements ISessionStorage {
  manager: sessionService;
  path: string;
  idleTimeoutS: number;
  absoluteTimeoutS: number;

  /** Dossier physique (absolu) des fichiers de session — introspection Studio. */
  get location(): string {
    return resolve(this.path);
  }
  constructor(manager: sessionService) {
    this.manager = manager;
    this.path = manager.options.savePath;
    this.idleTimeoutS = manager.options.idleTimeoutS;
    this.absoluteTimeoutS = manager.options.absoluteTimeoutS;
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
      this.gc();
      return new Finder().in(Path, {
        recurse: false,
        onFinish: (result: Result) => {
          let total: number = 0;
          if (result[0]) {
            total = result[0].childrens.length;
          }
          this.manager.log(
            `SESSIONS STORAGE ==> ${this.manager.options.store.toUpperCase()} COUNT SESSIONS : ${total}`,
          );
          return resolve(total);
        },
      });
    });
  }

  close(): boolean {
    this.gc();
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

  async gc(idleSeconds?: number, absoluteSeconds?: number): Promise<void> {
    const idleMs = (idleSeconds ?? this.idleTimeoutS) * 1000;
    const absoluteMs = (absoluteSeconds ?? this.absoluteTimeoutS) * 1000;
    if (!fs.existsSync(this.path)) {
      return;
    }
    // Attendre la fin du scan (Finder async) — `gc` est DÉTERMINISTE : le
    // `GcScheduler` (anti-chevauchement) et un worker cron peuvent compter sur sa
    // résolution = passe terminée. (Avant : fire-and-forget → la passe « finissait »
    // avant la purge réelle.) Robuste : une exception synchrone résout quand même.
    await new Promise<void>((resolve) => {
      try {
        finderGC.call(this, this.path, idleMs, absoluteMs, resolve);
      } catch (e) {
        this.manager.log(e, "WARNING");
        resolve();
      }
    });
  }

  /**
   * Prolonge l'idle d'une session (timeout glissant) en rafraîchissant le `mtime`
   * du fichier (`utimes`) — SANS réécrire le blob. Le `birthtime` (= borne
   * absolute) reste intact. Fichier absent (session purgée entre-temps) → no-op.
   */
  async touch(id: string): Promise<void> {
    const now = new Date();
    try {
      await fs.promises.utimes(`${this.path}/${id}`, now, now);
    } catch {
      // Session déjà supprimée (GC concurrent / expiration) → rien à prolonger.
    }
  }

  read(file: string): Promise<ISerializedSession> {
    return new Promise((resolve, reject) => {
      try {
        fs.readFile(file, "utf8", (err, data) => {
          if (err) {
            return reject(err);
          }
          let parsed: ISerializedSession;
          try {
            parsed = JSON.parse(data) as ISerializedSession;
          } catch (e) {
            return reject(e);
          }
          // Le blob `files` ne stocke PAS les horodatages — ils sont portés par le
          // filesystem : `birthtime` = création (absolute), `mtime` = dernière
          // activité (idle, rafraîchi par le touch). On les injecte ici pour rendre
          // `created`/`updated` cohérents avec les stores SQL → l'idle ET l'absolute
          // à la lecture (`isValidSession`) + le throttle du touch marchent pour
          // `files`. Stat best-effort : un échec laisse les horodatages absents
          // (comportement legacy : pas d'expiration à la lecture, GC seul).
          fs.stat(file, (statErr, st) => {
            if (!statErr) {
              const birth = st.birthtime.getTime();
              parsed.createdAt =
                Number.isFinite(birth) && birth > 0 ? st.birthtime : st.mtime;
              parsed.updatedAt = st.mtime;
            }
            return resolve(parsed);
          });
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

  /**
   * Énumération admin : un fichier = une session (stockées à plat sous
   * `this.path`, le nom de fichier EST l'id). Lecture best-effort — un fichier
   * illisible/partiel/non-JSON (ou un sous-dossier : `EISDIR`) est ignoré, jamais
   * fatal. Le filtre `user` est appliqué en mémoire.
   */
  async listAll(filter?: ISessionListFilter): Promise<ISessionRecord[]> {
    const records: ISessionRecord[] = [];
    let names: string[];
    try {
      names = await fs.promises.readdir(this.path);
    } catch {
      return records; // dossier absent = aucune session
    }
    for (const id of names) {
      try {
        const raw = await fs.promises.readFile(`${this.path}/${id}`, "utf8");
        const data = JSON.parse(raw) as ISerializedSession;
        if (filter?.user !== undefined && data.user !== filter.user) continue;
        records.push({ id, data });
      } catch {
        // fichier illisible / sous-dossier / JSON corrompu → on saute
      }
    }
    return records;
  }
}

export default FileSessionStorage;
