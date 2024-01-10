/* eslint-disable @typescript-eslint/no-explicit-any */
import path from "node:path";
import Service from "../Service";
import Container from "../Container";
import Event from "../Event";
import Command from "./Command";
import { extend, typeOf } from "../Tools";
import FileClass from "../FileClass";
import File from "../finder/File";
import Cli from "../Cli";
import { PathLike } from "node:fs";
import fs from "node:fs";
import twig from "twig";
import shelljs from "shelljs";

interface SymlinkParams {
  source: string;
  dest: string;
}

interface CopyParams {
  recurse?: boolean;
}

type FileType = "file" | "directory" | "copy" | "symlink";

interface BuilderObject {
  name: string;
  type: FileType;
  path?: string | PathLike;
  skeleton?: string | PathLike;
  params?:
    | SymlinkParams
    | CopyParams
    | fs.MakeDirectoryOptions
    | Record<string, any>;
  chmod?: string | number;
  parse?: boolean;
  childs?: BuilderObject[];
}

const twigOptions = {
  views: process.cwd(),
  "twig options": {
    async: false,
    cache: false,
  },
};

class Builder extends Service {
  public force: boolean = false;
  public command: Command | undefined;
  public cli: Cli | undefined | null;
  public response: Record<string, any> = {};
  public debug: boolean = false;
  public interactive: boolean = false;
  public location: string = process.cwd();
  private twig: typeof twig = twig;
  constructor(command: Command) {
    super(
      "Builder",
      <Container>command?.container,
      <Event>command?.notificationsCenter
    );
    this.command = command;
    this.getCliOptions();
  }

  private getCliOptions(): void {
    this.cli = this.command?.cli;
    this.debug = this.cli?.commander?.opts().debug;
    this.interactive = this.cli?.commander?.opts().interactive;
    this.response = extend(true, {}, this.cli?.response || {});
  }

  async run(...args: any[]): Promise<any> {
    return Promise.resolve(args);
  }

  generate(response: Record<string, any>, force: boolean = false) {
    return new Promise((resolve, reject) => {
      try {
        // if (this.createBuilder) {
        //   this.build(this.createBuilder(response), this.location, force);
        //   return resolve(this.cli?.response);
        // }
        return resolve(this.cli?.response);
      } catch (e) {
        return reject(e);
      }
    });
  }

  setLocation(location: string | FileClass) {
    if (location instanceof FileClass) {
      return (this.location = <string>location.path);
    }
    return (this.location = path.resolve(location));
  }

  async removeInteractivePath(file: string): Promise<boolean> {
    if (!this.command) {
      throw new Error(`Command not found`);
    }
    return this.command.prompts
      .confirm({
        message: `Do You Want Remove : ${file}?`,
        default: false,
      })
      .then((response) => {
        if (response) {
          if (!fs.existsSync(file)) {
            throw `${file} not exist`;
          }
          shelljs.rm("-rf", file);
          return response;
        }
        return response;
      })
      .catch((e) => {
        throw e;
      });
  }

  buildSkeleton(
    skeleton: string | FileClass,
    parse: boolean,
    data: Record<string, any>
  ): Promise<string | NodeJS.ArrayBufferView> {
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
            this.twig.renderFile(
              (<FileClass>skelete).path as string,
              data,
              (error, result) => {
                if (error) {
                  return reject(error);
                }
                return resolve(result);
              }
            );
          } else {
            fs.readFile(
              skelete.path,
              {
                encoding: "utf8",
              },
              (error, result) => {
                if (error) {
                  return reject(error);
                }
                return resolve(result);
              }
            );
          }
        } else {
          const error = new Error(
            ` skeleton must be file !!! : ${skelete.path}`
          );
          return reject(error);
        }
      } catch (e) {
        return reject(e);
      }
    });
  }

  async build(
    obj: BuilderObject | BuilderObject[],
    parent: FileClass | string | File = new File(process.cwd()),
    force: boolean = false
  ): Promise<FileClass | null | File> {
    let child: FileClass | File | null = null;
    try {
      if (parent) {
        if (!(parent instanceof File)) {
          if (parent instanceof FileClass) {
            parent = new File(parent.path);
          } else {
            parent = new File(parent);
          }
        }
      }
      switch (typeOf(obj)) {
        case "array": {
          const elements = obj as BuilderObject[];
          for (const element of elements) {
            const res = await this.build(element, <File>parent, force);
            if (parent && res) {
              //(parent as File).childrens.push(res)
            }
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
              case "type": {
                switch (value as FileType) {
                  case "directory": {
                    const directoryPath = path.resolve(
                      (parent as File)?.path as string,
                      name
                    );
                    child = <FileClass>await this.createDirectory(
                      directoryPath,
                      (myobj.params as fs.MakeDirectoryOptions) || {
                        mode: 0o755,
                      },
                      force
                    ).catch((e) => {
                      throw e;
                    });
                    if (parent) {
                      (parent as File).childrens.push(<File>child);
                    }
                    if (force) {
                      this.log(`Force Create Directory: ${child?.name}`);
                    } else {
                      this.log(`Create Directory: ${child?.name}`);
                    }
                    break;
                  }
                  case "file": {
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
                      shelljs.chmod((myobj.chmod as string) || 644, filePath);
                    }
                    child = new File(filePath, <File>parent);
                    if (parent) {
                      (parent as File).childrens.push(child);
                    }
                    break;
                  }
                  case "symlink": {
                    const symlinkParams = myobj.params as SymlinkParams;
                    const parentPath = (parent as FileClass).path as string;
                    const sourcePath = path.resolve(
                      parentPath,
                      symlinkParams.source
                    );
                    const destPath = path.resolve(
                      parentPath,
                      symlinkParams.dest
                    );
                    const symlinkArgs = force
                      ? ["-sf", sourcePath, destPath]
                      : ["-s", sourcePath, destPath];
                    shelljs.ln(...(symlinkArgs as [string, string, string]));
                    this.log(`Create symbolic link: ${myobj.name}`);
                    child = new File(destPath, <File>parent);
                    if (parent) {
                      (parent as File).childrens.push(child);
                    }
                    break;
                  }
                  case "copy": {
                    const copyParams = myobj.params as CopyParams;
                    const copyFilePath = path.resolve(
                      (parent as FileClass).path as string,
                      name
                    );
                    const copyArgs = copyParams.recurse
                      ? ["-R", myobj.path as string, copyFilePath]
                      : ["-f", myobj.path as string, copyFilePath];
                    shelljs.cp(...(copyArgs as [string, string, string]));
                    this.log(`Copy: ${myobj.name}`);
                    if (myobj.chmod) {
                      shelljs.chmod(
                        (myobj.chmod as string) || 0o644,
                        copyFilePath
                      );
                    }
                    child = new File(copyFilePath, <File>parent);
                    if (parent) {
                      (parent as File).childrens.push(child);
                    }
                    break;
                  }
                }
                break;
              }
              case "childs":
                await this.build(
                  value as BuilderObject[],
                  child as FileClass,
                  force
                );
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
    return Promise.resolve(child as File);
  }

  createFile(
    myPath: string,
    skeleton: string,
    parse: boolean = true,
    params: Record<string, any> = {}
  ): File | Promise<File> {
    return new Promise((resolve, reject) => {
      if (skeleton) {
        return this.buildSkeleton(skeleton, parse, params)
          .then((file) => {
            fs.writeFile(
              myPath,
              file,
              {
                mode: params.mode || "644",
              },
              (err) => {
                if (err) {
                  return reject(err);
                }
                return resolve(new File(myPath));
              }
            );
          })
          .catch((e: Error) => reject(e));
      }
      const data = "";
      fs.writeFile(
        myPath,
        data,
        {
          mode: params.mode || "644",
        },
        (err) => {
          if (err) {
            return reject(err);
          }
          return resolve(new File(myPath));
        }
      );
    });
  }

  async createDirectory(
    myPath: fs.PathLike,
    mode?: fs.MakeDirectoryOptions | fs.Mode | null,
    force: boolean = false
  ): Promise<File> {
    try {
      await fs.promises.mkdir(myPath, mode);
      return new File(myPath);
    } catch (e: any) {
      switch (e.code) {
        case "EEXIST":
          if (force) {
            return new File(myPath);
          }
          break;
      }
      throw e;
    }
  }
}

export default Builder;
export { FileType, SymlinkParams, CopyParams, BuilderObject };
