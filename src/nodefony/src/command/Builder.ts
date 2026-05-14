/* eslint-disable @typescript-eslint/no-explicit-any */
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { PathLike } from "node:fs";
import Service from "../Service";
import Container from "../Container";
import Event from "../Event";
import Command from "./Command";
import { extend, typeOf } from "../Tools";
import FileClass from "../FileClass";
import File from "../finder/File";
import Cli from "../Cli";
import twig from "twig";

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
      <Event>command?.notificationsCenter,
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

  async generate(): Promise<any> {
    return this.cli?.response;
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
    const response = await this.command.prompts.confirm({
      message: `Do You Want Remove : ${file}?`,
      default: false,
    });
    if (response) {
      if (!fs.existsSync(file)) {
        throw new Error(`${file} not exist`);
      }
      await fsp.rm(file, { recursive: true, force: true });
    }
    return response;
  }

  async buildSkeleton(
    skeleton: string | FileClass,
    parse: boolean,
    data: Record<string, any>,
  ): Promise<string | NodeJS.ArrayBufferView> {
    const skelete =
      skeleton instanceof FileClass ? skeleton : new FileClass(skeleton);
    if (skelete.type !== "File") {
      throw new Error(` skeleton must be file !!! : ${skelete.path}`);
    }
    const skelPath = skelete.path as string;
    if (parse) {
      data.settings = twigOptions;
      return new Promise<string>((resolve, reject) => {
        this.twig.renderFile(skelPath, data, (error, result) => {
          if (error) return reject(error);
          resolve(result);
        });
      });
    }
    return fsp.readFile(skelPath, { encoding: "utf8" });
  }

  async createFile(
    myPath: string,
    skeleton: string,
    parse: boolean = true,
    params: Record<string, any> = {},
  ): Promise<File> {
    const mode = params.mode || "644";
    const data = skeleton
      ? await this.buildSkeleton(skeleton, parse, params)
      : "";
    await fsp.writeFile(myPath, data, { mode });
    return new File(myPath);
  }

  async createDirectory(
    myPath: fs.PathLike,
    mode?: fs.MakeDirectoryOptions | fs.Mode | null,
    force: boolean = false,
  ): Promise<File> {
    try {
      await fsp.mkdir(myPath, mode);
      return new File(myPath);
    } catch (e: any) {
      if (e.code === "EEXIST" && force) {
        return new File(myPath);
      }
      throw e;
    }
  }

  async build(
    obj: BuilderObject | BuilderObject[],
    parent: FileClass | string | File = new File(process.cwd()),
    force: boolean = false,
  ): Promise<FileClass | null | File> {
    let child: FileClass | File | null = null;
    try {
      if (!(parent instanceof File)) {
        parent = new File(
          parent instanceof FileClass ? parent.path : parent,
        );
      }

      if (typeOf(obj) === "array") {
        for (const element of obj as BuilderObject[]) {
          await this.build(element, parent as File, force);
        }
        return child;
      }

      if (typeOf(obj) !== "object") {
        this.log("generate build error arguments: ", "ERROR");
        return child;
      }

      const myobj = obj as BuilderObject;
      const name = myobj.name;
      const parentPath = (parent as File).path as string;

      switch (myobj.type) {
        case "directory": {
          const dirPath = path.resolve(parentPath, name);
          child = await this.createDirectory(
            dirPath,
            (myobj.params as fs.MakeDirectoryOptions) || { mode: 0o755 },
            force,
          );
          (parent as File).childrens.push(child as File);
          this.log(
            `${force ? "Force Create" : "Create"} Directory: ${child?.name}`,
          );
          break;
        }
        case "file": {
          const filePath = path.resolve(parentPath, name);
          await this.createFile(
            filePath,
            myobj.skeleton as string,
            myobj.parse,
            myobj.params as Record<string, any>,
          );
          this.log(`Create File: ${filePath}`);
          if (myobj.chmod) {
            await fsp.chmod(filePath, myobj.chmod as fs.Mode);
          }
          child = new File(filePath, parent as File);
          (parent as File).childrens.push(child);
          break;
        }
        case "symlink": {
          const { source, dest } = myobj.params as SymlinkParams;
          const sourcePath = path.resolve(parentPath, source);
          const destPath = path.resolve(parentPath, dest);
          if (force && fs.existsSync(destPath)) {
            await fsp.unlink(destPath);
          }
          await fsp.symlink(sourcePath, destPath);
          this.log(`Create symbolic link: ${name}`);
          child = new File(destPath, parent as File);
          (parent as File).childrens.push(child);
          break;
        }
        case "copy": {
          const copyParams = myobj.params as CopyParams;
          const destPath = path.resolve(parentPath, name);
          await fsp.cp(myobj.path as string, destPath, {
            recursive: copyParams?.recurse ?? false,
            force: true,
          });
          this.log(`Copy: ${name}`);
          if (myobj.chmod) {
            await fsp.chmod(destPath, myobj.chmod as fs.Mode);
          }
          child = new File(destPath, parent as File);
          (parent as File).childrens.push(child);
          break;
        }
      }

      if (myobj.childs?.length) {
        await this.build(myobj.childs, child as FileClass, force);
      }
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
    return child;
  }
}

export default Builder;
export { FileType, SymlinkParams, CopyParams, BuilderObject };
