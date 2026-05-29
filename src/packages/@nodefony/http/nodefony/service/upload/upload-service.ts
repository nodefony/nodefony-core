import {
  Service,
  FileClass,
  Container,
  Event,
  Severity,
  Msgid,
  Pdu,
  Message,
  Cli,
  inject,
  Module,
} from "nodefony";
import HttpKernel from "../http-kernel";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { IParsedUploadFile } from "../../interfaces/IUpload";

/** Test d'existence non bloquant (`fsp.access`) — remplace `existsSync`. */
const existsAsync = async (p: string): Promise<boolean> => {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
};

export class upload extends Service {
  path?: string | fs.PathLike;
  module: Module;
  constructor(
    module: Module,
    @inject("HttpKernel") public httpKernel: HttpKernel,
  ) {
    super(
      "upload",
      httpKernel?.container as Container,
      httpKernel.notificationsCenter as Event,
    );
    this.module = module;
    this.kernel?.once("onBoot", async () => {
      this.options = this.httpKernel.options;
      const abs = path.isAbsolute(this.options.upload.uploadDir);
      if (abs) {
        this.path = this.options.upload.uploadDir;
      } else {
        this.path = path.resolve(
          `${this.kernel?.path}/${this.options.upload.uploadDir}`,
        );
      }
      // mkdir recursive idempotent (async, non bloquant) — plus de existsSync
      // préalable ni de mkdirSync. Fallback /tmp si la création échoue.
      try {
        await fsp.mkdir(this.path as string, { recursive: true });
      } catch (e) {
        this.path = "/tmp";
        this.options.upload.uploadDir = this.path;
        this.log(e, "DEBUG");
      }
    });
  }

  /**
   * Construit un `UploadedFile` à partir d'un fichier multipart parsé —
   * **async, non bloquant** (stat via `fsp.lstat`, plus de `lstatSync` par
   * fichier uploadé).
   *
   * @param file - fichier parsé (forme neutre `IParsedUploadFile`, busboy).
   * @param name - nom de champ (fallback si pas de `originalFilename`).
   * @returns le `UploadedFile` hydraté.
   */
  async createUploadFile(
    file: IParsedUploadFile,
    name: string,
  ): Promise<UploadedFile> {
    return UploadedFile.create(file, name);
  }
  override log(
    pci: any,
    severity?: Severity,
    msgid?: Msgid,
    msg?: Message,
  ): Pdu {
    if (this.syslog) {
      if (!msgid) {
        msgid = "HTTP UPLOAD";
      }
      return this.syslog.log(pci, severity, msgid, msg);
    }
    throw new Error(`Syslog not ready`);
  }
}

class UploadedFile extends FileClass {
  parsedFile: IParsedUploadFile;
  size: number;
  prettySize: string;
  filename: string;
  lastModifiedDate: Date | null | undefined;
  hashAlgorithm: false | "sha1" | "md5" | "sha256";
  hash: string | null | undefined;
  constructor(
    parsedFile: IParsedUploadFile,
    name: string,
    options?: { defer?: boolean },
  ) {
    super(parsedFile.filepath, options);
    this.parsedFile = parsedFile;
    this.size = this.getSize();
    this.prettySize = this.getPrettySize();
    this.filename = this.realName(name);
    this.mimeType = this.getMimeType();
    this.lastModifiedDate = this.parsedFile.mtime;
    this.hashAlgorithm = this.parsedFile.hashAlgorithm;
    this.hash = this.parsedFile.hash;
  }

  /**
   * Construit un `UploadedFile` SANS `lstatSync` bloquant — stat résolu en async
   * (`FileClass.stat`). À utiliser dans le pipeline d'upload (per-request).
   *
   * @param parsedFile - fichier multipart parsé (forme neutre busboy).
   * @param name - nom de champ (fallback de nom).
   * @returns le `UploadedFile` hydraté (stats async).
   * @remarks Nommée `create` (pas `from`) pour ne pas entrer en conflit avec la
   *   signature statique de `FileClass.from(path)` (TS2417).
   */
  static async create(
    parsedFile: IParsedUploadFile,
    name: string,
  ): Promise<UploadedFile> {
    const file = new UploadedFile(parsedFile, name, { defer: true });
    await file.stat();
    return file;
  }

  getSize() {
    return this.parsedFile.size;
  }

  getPrettySize() {
    return Cli.niceBytes(this.parsedFile.size);
  }

  realName(name?: string) {
    return (
      this.parsedFile.originalFilename || name || this.parsedFile.newFilename
    );
  }

  override getMimeType() {
    if (this.parsedFile) {
      return this.parsedFile.mimetype || super.getMimeType(this.filename);
    }
    return super.getMimeType();
  }

  override move(target: string): FileClass {
    try {
      if (fs.existsSync(target)) {
        const newFile = new FileClass(target);
        const name = this.filename || this.name;
        if (newFile.isDirectory()) {
          const n = path.resolve(newFile.path as string, name);
          return super.move(n);
        }
      }
      const dirname = path.dirname(target);
      if (fs.existsSync(dirname)) {
        if (target === dirname) {
          const name = path.resolve(target, "/", this.filename || this.name);
          return super.move(name);
        } else {
          return super.move(target);
        }
      }
      throw fs.lstatSync(dirname);
    } catch (e) {
      throw e;
    }
  }

  /**
   * Variante **async** de `move()` — déplace le fichier uploadé sans bloquer
   * l'event-loop (`fsp.access`/`fsp.rename` via `FileClass.moveAsync`).
   * À préférer dans le pipeline (controller).
   *
   * @param target - destination (fichier ou dossier existant).
   * @returns nouvelle instance `FileClass` (hydratée async) sur la destination.
   */
  override async moveAsync(target: fs.PathLike): Promise<FileClass> {
    const dest = target as string;
    if (await existsAsync(dest)) {
      const newFile = await FileClass.from(dest);
      const name = this.filename || this.name;
      if (newFile.isDirectory()) {
        return super.moveAsync(path.resolve(newFile.path as string, name));
      }
    }
    const dirname = path.dirname(dest);
    if (await existsAsync(dirname)) {
      if (dest === dirname) {
        return super.moveAsync(
          path.resolve(dest, "/", this.filename || this.name),
        );
      }
      return super.moveAsync(dest);
    }
    // dossier cible inexistant → throw cohérent avec move() sync
    await fsp.lstat(dirname);
    throw new Error(`upload moveAsync: target dir not found: ${dirname}`);
  }
}

export default upload;

export { UploadedFile };
