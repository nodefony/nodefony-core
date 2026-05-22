import mime from "mime-types";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { extend } from "./Tools";

interface FileClassInterface {
  path: fs.PathOrFileDescriptor;
  name: string;
  ext: string;
  shortName: string;
  type: string | undefined;
  stats: fs.Stats;
  dirName: string;
  parse: path.ParsedPath;
  encoding?: string;
  mimeType?: string | false;
  extention?: string | false;
}

const checkPath = function (myPath: string | fs.PathOrFileDescriptor): string {
  if (!myPath) {
    throw new Error(`Bad path`);
  }
  const abs = path.isAbsolute(<string>myPath);
  if (abs) {
    return <string>myPath;
  }
  return path.resolve(process.cwd(), <string>myPath);
};

const regHidden: RegExp = /^\./;
const defautWriteOption = {
  flags: "w",
  defaultEncoding: "utf8",
};

const defaultEncoding = {
  encoding: "utf8",
  flag: "r",
};

/**
 * Wrapper fs Node.js avec métadonnées pré-parsées (path, name, ext, mime, stats).
 *
 * Utilisé par le Kernel/Module pour résoudre des chemins, par le `Finder` pour représenter
 * un résultat de recherche, et par les Controllers HTTP pour servir des fichiers statiques.
 *
 * @example
 * ```ts
 * import { FileClass } from "nodefony";
 * const file = new FileClass("/path/to/file.txt");
 * file.isFile();       // true
 * file.mimeType;       // "text/plain"
 * const content = file.read();
 * ```
 *
 * @remarks Le constructeur `new FileClass(path)` fait un `fs.lstatSync()` **synchrone**
 *   (bloque l'event-loop) — réservé au boot/CLI. Dans **tout hot path** (requête HTTP,
 *   Finder, upload), utiliser `await FileClass.from(path)` qui résout les stats en async
 *   (`fsp.lstat`/`fsp.realpath`) sans bloquer la loop. Idem `moveAsync()` vs `move()`.
 */
class FileClass {
  public stats!: fs.Stats;
  public type: string | undefined;
  public path: fs.PathOrFileDescriptor;
  public parse!: path.ParsedPath;
  public name!: string;
  public shortName!: string;
  public ext!: string;
  public mimeType: string | false = false;
  public encoding: string = "UTF-8";
  public extention: string | false = false;
  public dirName!: string;
  public match: RegExpExecArray | null = null;

  /**
   * Construit un FileClass à partir d'un chemin (absolu OR relatif à `process.cwd()`).
   *
   * Par défaut : résout `lstatSync` (suit pas les symlinks) + `realpathSync`, parse le
   * path, devine le MIME type — **synchrone, bloque l'event-loop** (boot/CLI uniquement).
   * Passer `{ defer: true }` n'effectue AUCUNE I/O (utilisé par `FileClass.from()` async).
   *
   * @param Path - chemin absolu OR relatif vers le fichier/dossier.
   * @param options - `defer: true` → pas de stat au constructeur (hydrater via `stat()`).
   * @throws Si `Path` est falsy OR si `lstatSync` échoue (fichier inexistant, hors defer).
   */
  constructor(
    Path: string | fs.PathOrFileDescriptor,
    options?: { defer?: boolean },
  ) {
    if (!Path) {
      throw new Error(`error fileClass Path : ${Path}`);
    }
    this.path = checkPath(Path);
    if (!options?.defer) {
      const stats = fs.lstatSync(this.path as string);
      const resolved = stats.isSymbolicLink()
        ? (this.path as string)
        : fs.realpathSync(this.path as string);
      this.hydrate(stats, resolved);
    }
  }

  /**
   * Construit un FileClass SANS I/O synchrone — `fsp.lstat`/`fsp.realpath` async.
   *
   * À utiliser dans tout hot path (Finder, upload, render controller) pour ne PAS
   * bloquer l'event-loop. Équivalent async de `new FileClass(path)`.
   *
   * @param Path - chemin absolu ou relatif à `process.cwd()`.
   * @returns une instance hydratée (stats résolus).
   * @throws Si `Path` est falsy ou si `lstat` échoue (inexistant).
   */
  static async from(
    Path: string | fs.PathOrFileDescriptor,
  ): Promise<FileClass> {
    const file = new FileClass(Path, { defer: true });
    await file.stat();
    return file;
  }

  /**
   * Résout les stats en async (`fsp.lstat` + `fsp.realpath`) puis hydrate l'instance.
   * Aucune I/O synchrone. Appelé par `FileClass.from()` ; rappelable pour rafraîchir.
   *
   * @returns `this` (chaînable, type polymorphe pour les sous-classes type `File`).
   */
  async stat(): Promise<this> {
    const p = checkPath(this.path as string);
    const stats = await fsp.lstat(p);
    const resolved = stats.isSymbolicLink() ? p : await fsp.realpath(p);
    this.hydrate(stats, resolved);
    return this;
  }

  /**
   * Renseigne stats/type/path/parse/name/mime à partir de stats déjà résolus.
   * Partagé par le constructeur sync et `stat()` async — **aucune I/O ici** (pur).
   *
   * @param stats - résultat d'un `lstat` (sync ou async).
   * @param resolvedPath - path réel (realpath) ou path original si symlink.
   */
  private hydrate(stats: fs.Stats, resolvedPath: string): void {
    this.stats = stats;
    this.type = this.checkType();
    this.path = resolvedPath;
    this.parse = path.parse(this.path as string);
    this.name = this.parse.name + this.parse.ext;
    this.ext = this.parse.ext;
    this.shortName = this.parse.name;
    if (this.type === "File") {
      this.mimeType = this.getMimeType(this.name);
      this.encoding = "UTF-8";
      this.extention = this.getExtension(this.mimeType);
    }
    this.dirName = this.parse.dir;
  }

  /**
   * @returns le path absolu (utile pour les concat string).
   */
  toString() {
    return JSON.stringify(this.toJson(), null, "\n");
  }

  /**
   * Sérialise les métadonnées du fichier en objet plain (compatible JSON.stringify).
   *
   * @returns objet contenant path, name, ext, stats, mime, etc.
   */
  toJson(): FileClassInterface {
    const obj: FileClassInterface = {
      path: this.path,
      name: this.name,
      ext: this.ext,
      shortName: this.shortName,
      type: this.type,
      stats: this.stats,
      dirName: this.dirName,
      parse: this.parse,
    };
    if (this.type === "File") {
      obj.encoding = this.encoding;
      obj.mimeType = this.mimeType;
      obj.extention = this.extention;
    }
    return obj;
  }

  /**
   * Détermine le type — `"File"`, `"Directory"`, `"SymbolicLink"`, etc.
   *
   * @returns nom du type ou `undefined` si stats indéterminé.
   */
  checkType(): string | undefined {
    if (this.stats.isDirectory()) return "Directory";
    if (this.stats.isFile()) return "File";
    if (this.stats.isBlockDevice()) return "BlockDevice";
    if (this.stats.isCharacterDevice()) return "CharacterDevice";
    if (this.stats.isSymbolicLink()) return "symbolicLink";
    if (this.stats.isFIFO()) return "Fifo";
    if (this.stats.isSocket()) return "Socket";
  }

  /**
   * Calcule le hash du contenu du fichier (synchronous).
   *
   * @param type - algorithme (`"md5"` défaut, `"sha1"`, `"sha256"`, etc.).
   * @param hasOption - options crypto.HashOptions.
   * @returns hash hexadécimal.
   */
  checkSum(type: string = "md5", hasOption?: crypto.HashOptions): string {
    return crypto
      .createHash(type, hasOption)
      .update(this.content())
      .digest("hex");
  }

  getMimeType(name?: string): string | false {
    return mime.lookup(name || this.name);
  }

  getExtension(mimeType: string | false): string | false {
    if (mimeType) {
      return mime.extension(mimeType);
    }
    return mime.extension(<string>this.mimeType);
  }

  getRealpath(Path: string, options: fs.EncodingOption = {}) {
    return fs.realpathSync(Path, options);
  }

  matchName(ele: RegExp | string): boolean | RegExpExecArray | null {
    if (ele instanceof RegExp) {
      this.match = ele.exec(this.name);
      return this.match;
    }
    return ele === this.name;
  }

  matchType(type: string): boolean {
    return type === this.type;
  }

  /** @returns `true` si le path pointe vers un fichier régulier. */
  isFile(): boolean {
    return this.type === "File";
  }

  /** @returns `true` si le path pointe vers un dossier. */
  isDirectory(): boolean {
    return this.type === "Directory";
  }

  /** @returns `true` si le path est un lien symbolique. */
  isSymbolicLink(): boolean {
    return this.type === "symbolicLink";
  }

  dirname() {
    return path.dirname(<string>this.path);
  }

  /** @returns `true` si le nom commence par `.` (fichier caché Unix). */
  isHidden(): boolean {
    return regHidden.test(this.name);
  }

  content(encoding?: string): string | Buffer {
    const encode: fs.ObjectEncodingOptions = extend({}, defaultEncoding, {
      encoding,
    });
    return fs.readFileSync(this.path, encode);
  }

  /**
   * Lit le contenu du fichier (synchronous).
   *
   * @param encoding - encoding (défaut `"utf8"`). Si non fourni → retourne Buffer.
   * @returns contenu sous forme de string OR Buffer.
   */
  read(encoding?: string): string | Buffer {
    const encode: fs.ObjectEncodingOptions = extend({}, defaultEncoding, {
      encoding,
    });
    if (this.type === "symbolicLink") {
      const linked = fs.readlinkSync(<fs.PathLike>this.path, encode);
      return fs.readFileSync(linked, encode);
    }
    return fs.readFileSync(this.path, encode);
  }

  async readAsync(encoding?: string): Promise<string | Buffer> {
    if (this.type === "symbolicLink") {
      const linked = await fsp.readlink(<fs.PathLike>this.path);
      return fsp.readFile(linked, encoding as BufferEncoding);
    }
    return fsp.readFile(<fs.PathLike>this.path, encoding as BufferEncoding);
  }

  readByLine(callback: (line: string, n: number) => void, encoding?: string) {
    try {
      const res = this.content(encoding);
      let nb = 0;
      res
        .toString()
        .split("\n")
        .forEach((line: string) => {
          callback(line, ++nb);
        });
      return res;
    } catch (e) {
      throw e;
    }
  }

  /**
   * Écrit du contenu dans le fichier (synchronous).
   *
   * @param data - contenu à écrire (string OR Buffer).
   * @param options - options fs.write (encoding, flags).
   * @returns this (chaînable).
   */
  write(
    data: string | NodeJS.ArrayBufferView,
    options: fs.WriteFileOptions,
  ): void {
    fs.writeFileSync(this.path, data, extend({}, defautWriteOption, options));
  }

  /**
   * Déplace/renomme le fichier (synchronous).
   *
   * @param target - chemin de destination.
   * @returns nouvelle instance FileClass pointant vers `target`.
   */
  move(target: fs.PathLike): FileClass {
    fs.renameSync(<fs.PathLike>this.path, target);
    return new FileClass(<string>target);
  }

  /**
   * Déplace/renomme le fichier en **async** (`fsp.rename`) — variante non bloquante
   * de `move()`. À préférer dans le pipeline (upload, controller).
   *
   * @param target - chemin de destination.
   * @returns nouvelle instance FileClass (hydratée async) sur `target`.
   */
  async moveAsync(target: fs.PathLike): Promise<FileClass> {
    await fsp.rename(<fs.PathLike>this.path, target);
    return FileClass.from(<string>target);
  }

  /** Supprime le fichier du filesystem (synchronous, irréversible). */
  unlink(): void {
    fs.unlinkSync(<fs.PathLike>this.path);
  }

  /** Supprime le fichier du filesystem en **async** (`fsp.unlink`). */
  async unlinkAsync(): Promise<void> {
    await fsp.unlink(<fs.PathLike>this.path);
  }
}

export default FileClass;
export { FileClassInterface };
