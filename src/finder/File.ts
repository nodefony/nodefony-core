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
    parent: File | null = null
  ) {
    super(path);
    this.parent = parent;
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
