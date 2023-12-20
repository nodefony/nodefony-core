import mime from "mime";
import crypto from "node:crypto";
import path from "node:path"
import fs from 'node:fs'
import {extend} from './Tools'
import { PathLike } from "node:fs";

interface FileInterface {
  path: fs.PathOrFileDescriptor
  name: string
  ext: string
  shortName: string
  type: string | undefined
  stats: fs.Stats
  dirName: string
  parse: path.ParsedPath
  encoding?: string 
  mimeType? : string | null
  extention? : string | null
}

interface Encoding{
  encoding: null
  flag:string
}

const checkPath = function (myPath: string): string{
  if (!myPath) {
    throw new Error(`Bad path`) ;
  }
  const abs = path.isAbsolute(myPath);
  if (abs) {
    return myPath;
  }
  return path.resolve(process.cwd(), myPath);
};

const regHidden: RegExp = /^\./;
const defautWriteOption = {
  flags: "w",
  defaultEncoding: "utf8"
  // mode: 0o666
};

const defaultEncoding = {
    encoding:"utf8",
    flag:  "w",
}

/*
 *
 *  CLASS FileClass
 *
 *
 */
class FileClass {
  public stats : fs.Stats
  public type : string | undefined
  public path : fs.PathOrFileDescriptor
  public parse :  path.ParsedPath
  public name : string
  public shortName : string
  public ext: string
  public mimeType : string | null = null
  public encoding : string = "UTF-8"
  public extention : string | null = null
  public dirName : string
  public match : RegExpExecArray | null = null


  constructor (Path: string) {
    if (Path) {
      Path = checkPath(Path);
      this.stats = fs.lstatSync(Path);
      this.type = this.checkType();
      if (this.stats.isSymbolicLink()) {
        fs.readlinkSync(Path);
        this.path = Path;
      } else {
        this.path = this.getRealpath(Path);
      }
      this.parse = path.parse(this.path);
      this.name = this.parse.name + this.parse.ext;
      this.ext = this.parse.ext;
      this.shortName = this.parse.name;
      if (this.type === "File") {
        this.mimeType = this.getMimeType(this.name);
        this.encoding = "UTF-8"; // this.getCharset();
        this.extention = this.getExtension(this.mimeType);
      }
      this.dirName = this.parse.dir;
      this.match = null;
    } else {
      throw new Error(`error fileClass Path : ${Path}`);
    }
  }

  toString () {
    return JSON.stringify(this.toJson(), null, "\n");
  }

  toJson () : FileInterface {
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
    return obj;
  }

  checkType () : string | undefined{
    if (this.stats.isDirectory()) {
      return "Directory";
    }
    if (this.stats.isFile()) {
      return "File";
    }
    if (this.stats.isBlockDevice()) {
      return "BlockDevice";
    }
    if (this.stats.isCharacterDevice()) {
      return "CharacterDevice";
    }
    if (this.stats.isSymbolicLink()) {
      return "symbolicLink";
    }
    if (this.stats.isFIFO()) {
      return "Fifo";
    }
    if (this.stats.isSocket()) {
      return "Socket";
    }
  }

  getType () : string | undefined{
    return this.checkType();
  }

  checkSum (type: string, hasOption?:crypto.HashOptions ) : string{
    if (!type) {
      type = "md5";
    }
    return crypto.createHash(type, hasOption).update(this.content())
      .digest("hex");
  }

  getMimeType (name: string) : string | null{
    return mime.getType(name || this.name);
  }

  getExtension (mimeType: string | null) : string | null{
    if( mimeType){
       return mime.getExtension(mimeType);
    }
    return mime.getExtension(<string>this.mimeType);
  }

  /* getCharset (mimeType){
    //return mime.charsets.lookup(mimeType || this.mimeType );
  }*/

  getRealpath (Path: string, options: fs.EncodingOption= {}) {
    return fs.realpathSync(Path, options);
  }

  matchName (ele: RegExp | string): boolean | RegExpExecArray | null{
    if (ele instanceof RegExp) {
      this.match = ele.exec(this.name);
      return this.match;
    }
    if (ele === this.name) {
      return true;
    }
    return false;
  }

  matchType (type: string) : boolean{
    return type === this.type;
  }

  isFile () : boolean{
    return this.type === "File";
  }

  isDirectory () : boolean{
    return this.type === "Directory";
  }

  isSymbolicLink () : boolean{
    return this.type === "symbolicLink";
  }

  dirname () {
    return path.dirname(<string>this.path);
  }

  isHidden () : boolean{
    return regHidden.test(this.name);
  }

  content (encoding?: string) : string | Buffer{
    const encode : fs.ObjectEncodingOptions = extend({}, defaultEncoding, {encoding})
    return fs.readFileSync(this.path, encode);
  }

  read (encoding?: string): string | Buffer {
    const encode : fs.ObjectEncodingOptions = extend({}, defaultEncoding, {encoding})
    if (this.type === "symbolicLink") {
      const Path = fs.readlinkSync(<fs.PathLike>this.path, encode);
      return fs.readFileSync(Path, encode);
    }
    return fs.readFileSync(this.path, encode);
  }

  readAsync (encoding?: string)  : Promise<string | Buffer >{
    const encode : fs.ObjectEncodingOptions = extend({}, defaultEncoding, {encoding})
    if (this.type === "symbolicLink") {
      return new Promise((resolve, reject) => {
        const Path = fs.readlinkSync(<fs.PathLike>this.path, encode);
        try{
           return resolve (fs.readFileSync(Path, encode))
        }catch(e){
          return reject(e);
        }
      });
    }
    return new Promise((resolve, reject) =>{
      fs.readFile(this.path, (err: NodeJS.ErrnoException| null , data:Buffer): void=>{
        if (err) {
          return reject(err)
        }
        return resolve(data)
      })
    })
  }

  readByLine (callback: (line: string, n: number) => void, encoding: string) {
    return new Promise((resolve, reject) => {
      let res = null;
      try {
        res = this.content(encoding);
        let nb = 0;
        res.toString().split("\n")
          .forEach((line: string) => {
            callback(line, ++nb);
          });
      } catch (e) {
        return reject(e);
      }
      return resolve(res);
    });
  }

  write (data: string | NodeJS.ArrayBufferView, options:fs.WriteFileOptions) :void {
    fs.writeFileSync(this.path, data, extend({}, defautWriteOption, options));
  }

  move (target: fs.PathLike) : FileClass{
    try {
      fs.renameSync(<fs.PathLike>this.path, target);
      return new FileClass(<string>target);
    } catch (e) {
      throw e;
    }
  }

  unlink () : void{
    try {
      fs.unlinkSync(<fs.PathLike>this.path);
    } catch (e) {
      throw e;
    }
  }
}

export default FileClass;
