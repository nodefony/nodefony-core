/* eslint-disable @typescript-eslint/no-explicit-any */
import path from "node:path"
import Service from '../Service'
import  Container  from '../Container'
import Event from '../Event'
import Command  from './Command'
import {extend, typeOf} from "../Tools"
import FileClass from '../FileClass'
import Cli from '../Cli'
import { PathLike } from "node:fs"
import fs from 'node:fs'
import twig from 'twig'

interface SymlinkParams {
  source: string;
  dest: string;
}

interface CopyParams {
  recurse?: boolean;
}

type FileType = "file" | "directory" | "copy" | "symlink"

interface BuilderObject {
  name: string
  type: FileType
  path?: string | PathLike
  skeleton?: string | PathLike
  params?: SymlinkParams | CopyParams | fs.MakeDirectoryOptions |Record<string, any>
  chmod?: string | number
  parse?: boolean
  childs?: BuilderObject[]
}


const twigOptions = {
  views: process.cwd(),
  "twig options": {
    async: false,
    cache: false
  }
};

class Builder extends Service{
  public force: boolean = false;
  public command : Command | undefined
  public cli  : Cli  | undefined | null
  public response : Record<string, any>  = {}
  public debug : boolean  = false
  public interactive : boolean = false
  public location : string = process.cwd()
  private twig : typeof twig = twig;
  constructor(command: Command ){
    super("Builder", <Container>command?.container, <Event>command?.notificationsCenter)
    this.command = command 
    this.getCliOptions()
    
  }

   private getCliOptions(): void{
    this.cli  = this.command?.cli
    this.debug = this.cli?.commander?.opts().debug
    this.interactive = this.cli?.commander?.opts().interactive
    this.response = extend(true, {}, this.cli?.response)
  }

  run(): void{
     
  }

  setLocation (location: string | FileClass) {
    if (location instanceof FileClass) {
      return this.location = <string>location.path;
    }
    return this.location = path.resolve(location);
  }

  async removeInteractivePath (file: string) : Promise<boolean> {
    if( !this.command){
      throw new Error(`Command not found`)
    }
    return this.command.prompts.confirm({
      message: `Do You Want Remove : ${file}?`,
      default: false
    })
    .then((response) => {
      if (response) {
        if (!this.cli?.exists(file)) {
          throw `${file} not exist`;
        }
          this.cli.rm("-rf", file);
          return response;
      } 
      return response;
    })
    .catch((e) => {
      throw e;
    });
  }


  buildSkeleton(skeleton: string | FileClass, parse: boolean, data:Record<string, any>) : Promise <string | NodeJS.ArrayBufferView> {
     let skelete = null;
    return new Promise((resolve, reject) => {
      try {
        if (skeleton instanceof FileClass) {
          skelete = skeleton;
        } else {
          skelete = new FileClass(skeleton);
        }
        if (skelete.type === "File") {
          if (parse === true) {
            data.settings = twigOptions;
            this.twig.renderFile((<FileClass>skelete).path as string, data, (error, result) => {
              if (error) {
                return reject(error);
              }
              return resolve(result);
            });
          } else {
            fs.readFile(skelete.path, {
              encoding: "utf8"
            }, (error, result) => {
              if (error) {
                return reject(error);
              }
              return resolve(result);
            });
          }
        } else {
          const error = new Error(` skeleton must be file !!! : ${skelete.path}`);
          return reject(error);
        }
      } catch (e) {
        return reject(e);
      }
    });
    

  }


  // async build (obj : BuilderObject | BuilderObject[] , parent? : FileClass | null , force: boolean =false) : Promise<FileClass | null> {
  //   let child: FileClass | null  = null;
  //   try {
  //     if (parent && !(parent instanceof FileClass) ) {
  //       parent = new FileClass(parent);
  //     }
  //     switch (typeOf(obj)) {
  //     case "array":{
  //       try {
  //         const ele = obj as  BuilderObject[]
  //         for (let i = 0; i < ele.length; i++) {
  //           await this.build(ele[i] as BuilderObject , parent, force);
  //         }
  //       } catch (e) {
  //         this.log(e, "ERROR");
  //         throw e;
  //       }
  //       break;
  //     }
  //     case "object":{
  //       let name :string  ='';
  //       //const keys = Object.keys(obj) as (keyof BuilderObject)[];
  //       const myobj =  obj as BuilderObject
  //       for (const ele  in obj ) {
  //         const value = (obj as BuilderObject)[ele as string] as any;
  //         switch (ele as string ) {
  //         case "name":
  //           name = value;
  //           break;
  //         case "type":
  //           switch (value as FileType) {
  //           case "directory":{
  //             try {
  //               const directory = path.resolve((parent as FileClass)?.path as string , <string>name);
  //               child  = await this.cli?.createDirectory(directory, 0o755, force) as FileClass;
  //               if (force) {
  //                 this.log(`Force Create Directory :${child?.name}`);
  //               } else {
  //                 this.log(`Create Directory :${child?.name}`);
  //               }
  //                this.cli?.chmod((<BuilderObject>obj).chmod as string, directory);
  //             } catch (e) {
  //               this.log(e, "ERROR");
  //               throw e;
  //             }
  //             break;
  //           }
  //           case "file":
  //             try {
  //               const file = path.resolve((parent as FileClass)?.path as string, <string>name);
  //               await this.createFile(file, (<BuilderObject>obj).skeleton as string , (<BuilderObject>obj).parse, (<BuilderObject>obj).params)
  //               this.log(`Create File      :${file}`);
  //               if ((<BuilderObject>obj).chmod) {
  //                 this.cli?.chmod((<BuilderObject>obj).chmod as string, file);
  //               }
  //             } catch (e) {
  //               this.log(e, "ERROR");
  //               throw e;
  //             }
  //             break;
  //           case "symlink":
  //             try {
  //               const params = (<BuilderObject>obj).params
  //               const mypath = (parent as FileClass).path as string
  //               if (force) {
  //                 this.cli?.ln("-sf", 
  //                   path.resolve(mypath, (params as SymlinkParams).source), 
  //                   path.resolve(mypath, (params as SymlinkParams).dest)
  //                 );
  //               } else {
  //                 this.cli?.ln("-s", 
  //                   path.resolve(mypath, (params as SymlinkParams).source), 
  //                   path.resolve(mypath, (params as SymlinkParams).dest)
  //                 );
  //               }
  //               this.log(`Create symbolic link :${(<BuilderObject>obj).name}`);
  //             } catch (e) {
  //               this.log(e, "ERROR");
  //               throw e;
  //             }
  //             break;
  //           case "copy":
  //             try {
  //               const params = (<BuilderObject>obj).params
  //               const file = path.resolve((parent as FileClass).path as string, <string>name);
  //               if (params && (params as CopyParams ).recurse) {
  //                 this.cli?.cp("-R", (<BuilderObject>obj).path as string, file);
  //               } else {
  //                 this.cli?.cp("-f", (<BuilderObject>obj).path as string , file);
  //               }
  //               this.log(`Copy             :${(<BuilderObject>obj).name}`);
  //               if ((<BuilderObject>obj).chmod) {
  //                 this.cli?.chmod((<BuilderObject>obj).chmod as string , file);
  //               }
  //             } catch (e) {
  //               this.log(e, "ERROR");
  //               throw e;
  //             }
  //             break;
  //           }
  //           break;
  //         case "childs":
  //           try {
  //             await this.build(value as BuilderObject[], <FileClass>child , force);
  //           } catch (e) {
  //             this.log(e, "ERROR");
  //             throw e;
  //           }
  //           break;
  //         }
  //       }
  //       break;
  //     }
  //     default:
  //       this.log("generate build error arguments : ", "ERROR");
  //     }
  //   } catch (e) {
  //     this.log(obj, "ERROR");
  //     throw e;
  //   }
  //   return Promise.resolve(<FileClass>child);
  // }

  async build(
  obj: BuilderObject | BuilderObject[],
  parent: FileClass | string  = new FileClass(process.cwd()),
  force: boolean = false
): Promise<FileClass | null> {
  let child: FileClass | null = null;
  try {
    if (parent && !(parent instanceof FileClass)) {
      parent = new FileClass(parent);
    }
    switch (typeOf(obj)) {
      case "array": {
        const elements = obj as BuilderObject[];
        for (const element of elements) {
          await this.build(element, parent, force);
        }
        break;
      }
      case "object": {
        const myobj = obj as BuilderObject;
        let name = "";
        for (const [key, value] of Object.entries(myobj)) {
          switch (key) {
            case "name":
              name = value as string;
              break;
            case "type":{
              switch (value as FileType) {
                case "directory":{
                  const directoryPath = path.resolve(
                    (parent as FileClass)?.path as string,
                    name
                  );
                  child = <FileClass>await this.createDirectory(
                    directoryPath,
                    myobj.params as fs.MakeDirectoryOptions  || {mode: 0o755},
                    force
                  ) 
                  .catch(e=>{
                    throw e
                  });
                  if (force) {
                    this.log(`Force Create Directory: ${child?.name}`);
                  } else {
                    this.log(`Create Directory: ${child?.name}`);
                  }
                  //this.cli?.chmod((myobj.chmod as string) || 755, directoryPath);
                  break;
                }
                case "file":{
                  const filePath = path.resolve(
                    (parent as FileClass)?.path as string,
                    name
                  );
                   await this.createFile(
                    filePath,
                    myobj.skeleton as string,
                    myobj.parse,
                    myobj.params as SymlinkParams
                  );
                  this.log(`Create File: ${filePath}`);
                  if (myobj.chmod) {
                    this.cli?.chmod((myobj.chmod as string) || 644, filePath);
                  }
                  break;
                }
                case "symlink":{
                  const symlinkParams = myobj.params as SymlinkParams;
                  const parentPath = (parent as FileClass).path as string;
                  const sourcePath = path.resolve(parentPath, symlinkParams.source);
                  const destPath = path.resolve(parentPath, symlinkParams.dest);
                  const symlinkArgs = force ? ["-sf", sourcePath, destPath] : ["-s", sourcePath, destPath];
                  this.cli?.ln(...(symlinkArgs as [string, string, string]));
                  this.log(`Create symbolic link: ${myobj.name}`);
                  break;
                }
                case "copy":{
                    const copyParams = myobj.params as CopyParams;
                    const copyFilePath = path.resolve(
                      (parent as FileClass).path as string,
                      name
                    );
                    const copyArgs = copyParams.recurse ? ["-R", myobj.path as string, copyFilePath] : ["-f", myobj.path as string, copyFilePath];
                    this.cli?.cp(...(copyArgs as [string, string, string]));
                    this.log(`Copy: ${myobj.name}`);
                    if (myobj.chmod) {
                      this.cli?.chmod((myobj.chmod as string) || 0o644, copyFilePath);
                    }
                    break;
                 }
              }
              break;
            }
            case "childs":
              await this.build(value as BuilderObject[], child as FileClass, force);
              break;
          }
        }
        break;
      }
      default:
        this.log("generate build error arguments: ", "ERROR");
    }
  } catch (e) {
    this.log(e, "ERROR");
    throw e;
  }
  return Promise.resolve(child as FileClass);
}

createFile (
  myPath: string , 
  skeleton: string, 
  parse: boolean = true, 
  params: Record<string, any> = {} ) : FileClass | Promise<FileClass> { 
    return new Promise((resolve, reject) => {
      if (skeleton) {
        return this.buildSkeleton(skeleton, parse, params)
          .then((file) => {
            fs.writeFile(myPath, file, {
              mode: params.mode || "644"
            }, (err) => {
              if (err) {
                return reject(err);
              }
              return resolve(new FileClass(myPath));
            });
          })
          .catch((e: Error) => reject(e));
      }
      const data = "";
      fs.writeFile(myPath, data, {
        mode: params.mode || "644"
      }, (err) => {
        if (err) {
          return reject(err);
        }
        return resolve(new FileClass(myPath));
      });
    });
  }

  async createDirectory(
    myPath: fs.PathLike,
    mode?: fs.MakeDirectoryOptions | fs.Mode | null,
    force: boolean = false
    ): Promise<FileClass> {
      try {
        await fs.promises.mkdir(myPath, mode);
        return new FileClass(myPath);
      } catch (e: any) {
        switch (e.code) {
          case "EEXIST":
            if (force) {
              return new FileClass(myPath);
            }
            break;
        }
        throw e
      }
    }

  }


export default Builder
export {
  FileType,
  SymlinkParams,
  CopyParams,
  BuilderObject
}