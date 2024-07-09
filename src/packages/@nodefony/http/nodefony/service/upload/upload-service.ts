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
import path from "node:path";
import formidable from "formidable";

export class upload extends Service {
  path?: string | fs.PathLike;
  module: Module;
  constructor(
    module: Module,
    @inject("HttpKernel") public httpKernel: HttpKernel
  ) {
    super(
      "upload",
      httpKernel?.container as Container,
      httpKernel.notificationsCenter as Event
    );
    this.module = module;
    this.kernel?.once("onBoot", async () => {
      this.options = this.httpKernel.options;
      const abs = path.isAbsolute(this.options.formidable.uploadDir);
      if (abs) {
        this.path = this.options.formidable.uploadDir;
      } else {
        this.path = path.resolve(
          `${this.kernel?.path}/${this.options.formidable.uploadDir}`
        );
      }
      let res = fs.existsSync(this.path as string);
      if (!res) {
        // create directory
        this.log(`create directory FOR UPLOAD FILE ${this.path}`, "DEBUG");
        try {
          fs.mkdirSync(this.path as string);
        } catch (e) {
          this.path = "/tmp";
          this.options.formidable.uploadDir = this.path;
          this.log(e, "DEBUG");
        }
      }
    });
  }

  createUploadFile(file: formidable.File, name: string): UploadedFile {
    try {
      return new UploadedFile(file, name);
    } catch (error) {
      throw error;
    }
  }
  override log(
    pci: any,
    severity?: Severity,
    msgid?: Msgid,
    msg?: Message
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
  fomiFile: formidable.File;
  size: number;
  prettySize: string;
  filename: string;
  lastModifiedDate: Date | null | undefined;
  hashAlgorithm: false | "sha1" | "md5" | "sha256";
  hash: string | null | undefined;
  constructor(fomiFile: formidable.File, name: string) {
    super(fomiFile.filepath);
    this.fomiFile = fomiFile;
    this.size = this.getSize();
    this.prettySize = this.getPrettySize();
    this.filename = this.realName(name);
    this.mimeType = this.getMimeType();
    this.lastModifiedDate = this.fomiFile.mtime;
    this.hashAlgorithm = this.fomiFile.hashAlgorithm;
    this.hash = this.fomiFile.hash;
  }

  getSize() {
    return this.fomiFile.size;
  }

  getPrettySize() {
    return Cli.niceBytes(this.fomiFile.size);
  }

  realName(name?: string) {
    return this.fomiFile.originalFilename || name || this.fomiFile.newFilename;
  }

  override getMimeType() {
    if (this.fomiFile) {
      return this.fomiFile.mimetype || super.getMimeType(this.filename);
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
}

export default upload;

export { UploadedFile };
