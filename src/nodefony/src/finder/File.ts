import FileClass, { FileClassInterface } from "../FileClass";
import FileResult from "./FileResult";
import fs from "node:fs";

interface FileInterface extends FileClassInterface {
  childrens?: string;
  parent?: FileInterface;
}

class File extends FileClass {
  public parent: File | null = null;
  public childrens: FileResult = new FileResult();

  constructor(
    path: string | fs.PathOrFileDescriptor,
    parent: File | null = null,
    options?: { defer?: boolean },
  ) {
    super(path, options);
    this.parent = parent;
  }

  /**
   * Construit un `File` SANS `lstatSync` bloquant — stat résolu en async.
   * À utiliser dans le Finder pour ne pas bloquer l'event-loop par entrée.
   *
   * @param path - chemin du fichier/dossier.
   * @param parent - `File` parent (arborescence Finder), `null` à la racine.
   * @returns instance `File` hydratée (stats async).
   */
  static async from(
    path: string | fs.PathOrFileDescriptor,
    parent: File | null = null,
  ): Promise<File> {
    const file = new File(path, parent, { defer: true });
    await file.stat();
    return file;
  }

  get length(): number {
    return this.childrens.length;
  }

  override toJson(): FileInterface {
    const obj: FileInterface = {
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
    obj.childrens = this.childrens.toJson();
    obj.parent = this.parent?.toJson();
    return obj;
  }
}

export default File;
