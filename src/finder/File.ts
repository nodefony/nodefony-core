import FileClass, {FileClassInterface} from '../FileClass'
import FileResult from './FileResult'
import fs from 'node:fs'


interface FileInterface extends FileClassInterface {
  children?: string;
}

class File extends FileClass {

  public parent : File | null = null
  public children : FileResult  = new FileResult()

  constructor (path: string | fs.PathOrFileDescriptor, parent :File | null = null) {
    super(path);
    this.parent = parent;
  }

  get length () : number{
    return this.children.length;
  }

  toJson () : FileInterface{
    const obj : FileInterface= {
      path: this.path,
      name: this.name,
      ext: this.ext,
      shortName: this.shortName,
      type: this.type,
      stats: this.stats,
      dirName: this.dirName,
      parse: this.parse
    };
    if (this.type === "File") {
      obj.encoding = this.encoding;
      obj.mimeType = this.mimeType;
      obj.extention = this.extention;
    }
    obj.children = this.children.toJson();
    return obj;
  }
}

export default File;
