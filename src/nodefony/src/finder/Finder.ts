import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import Event from "../Event";
import { extend, typeOf } from "../Tools";
import FileResult from "./FileResult";
import File from "./File";
import FileClass from "../FileClass";
import Result from "./Result";

interface FinderEvents {
  onError: (error: Error) => void;
  onHidden: (info: File, finder: Finder) => void;
  onFinish: (result: Result, totals: TotalInterface, finder: Finder) => void;
}

interface DefaultSettingsInterface {
  recurse?: boolean;
  depth?: number;
  seeHidden?: boolean;
  match?: RegExp | string | null;
  exclude?: string | RegExp | null;
  excludeFile?: string | RegExp | null;
  excludeDir?: string | RegExp | null;
  followSymLink?: boolean;
  matchFile?: string;
  matchDir?: string;
}

interface TotalInterface {
  Directory: number;
  File: number;
  BlockDevice: number;
  CharacterDevice: number;
  symbolicLink: number;
  Fifo: number;
  Socket: number;
  hidden: number;
  [key: string]: number;
}

const defaultSettings: DefaultSettingsInterface = {
  recurse: false,
  depth: 10,
  seeHidden: false,
  match: null,
  exclude: null,
  excludeFile: null,
  excludeDir: null,
  followSymLink: false,
};

const checkExclude = function (info: File, options: DefaultSettingsInterface) {
  const test = options.exclude || options.excludeDir || options.excludeFile;
  if (!test) {
    return false;
  }
  if (options.exclude && info.matchName(options.exclude)) {
    return true;
  }
  if (options.excludeDir && info.isDirectory() && info.matchName(options.excludeDir)) {
    return true;
  }
  if (options.excludeFile && info.isFile() && info.matchName(options.excludeFile)) {
    return true;
  }
  return false;
};

const checkMatch = function (
  this: Finder,
  info: File,
  options: DefaultSettingsInterface = {},
  result: Result,
) {
  let match = false;
  let rec: string | undefined = undefined;
  const test = options.matchFile || options.matchDir || options.match;
  if (!test) {
    result.push(info);
    if (info.type) {
      this.totals[info.type]++;
      this.fire(`on${info.type}`, info, this);
    }
    return true;
  }
  if (options.matchDir) {
    if (info.isDirectory()) {
      if (info.matchName(options.matchDir)) {
        match = true;
      } else {
        return false;
      }
    }
  }
  if (options.matchFile) {
    if (info.isFile()) {
      match = info.matchName(options.matchFile) ? true : false;
    }
  }
  if (options.match) {
    const res = info.matchName(options.match);
    if (res) {
      match = true;
    } else {
      match = false;
      rec = info.type;
    }
  }
  if (match) {
    result.push(info);
    this.totals[info.type as string]++;
    this.fire(`on${info.type}`, info, this);
    return true;
  }
  switch (rec) {
    case "Directory":
    case "symbolicLink":
      result.push(info);
      this.totals[info.type as string]++;
      this.fire(`on${info.type}`, info, this);
      return true;
    default:
      return false;
  }
};

async function parser(
  this: Finder,
  file: FileClass,
  result = new FileResult(),
  options: DefaultSettingsInterface,
  depth: number | null = null,
  parent: File | null = null,
): Promise<FileResult> {
  if (depth === 0) {
    return result;
  }
  if (parent) {
    parent.childrens = result;
  }
  try {
    let res: string[] | string | null = null;
    if (file.type !== "symbolicLink") {
      res = await fsp.readdir(file.path as fs.PathLike, {
        encoding: "utf8",
        withFileTypes: false,
      });
    } else if (options.followSymLink) {
      res = await fsp.readlink(file.path as fs.PathLike);
    }
    if (res && res.length) {
      for (let i = 0; i < res.length; i++) {
        const ret = path.resolve(file.path as string, res[i]);
        const info = new File(ret, parent);
        const hidden = info.isHidden();
        if (hidden && !options.seeHidden) {
          continue;
        }
        if (checkExclude(info, options)) {
          continue;
        }
        let symLink: File | null = null;
        if (info.type === "symbolicLink" && options.followSymLink) {
          try {
            const read = path.resolve(
              info.dirName,
              await fsp.readlink(info.path as fs.PathLike),
            );
            symLink = new File(read, info);
          } catch (e) {
            this.fire("onError", e, this);
            continue;
          }
        }
        const match = checkMatch.call(this, info, options, result);
        if (!match) {
          continue;
        }
        if (hidden) {
          this.totals.hidden++;
          this.fire("onHidden", info, this);
        }
        if (info.type === "File") {
          continue;
        }
        if (!options.recurse) {
          continue;
        }
        switch (info.type) {
          case "Directory": {
            const myDepth: number | null = depth === null ? null : depth - 1;
            await parser.call(this, info, undefined, options, myDepth, info);
            break;
          }
          case "symbolicLink":
            if (symLink?.isDirectory()) {
              const myDepth: number | null = depth === null ? null : depth - 1;
              await parser.call(this, symLink, undefined, options, myDepth, info);
            }
            break;
        }
      }
    }
    return result;
  } catch (e) {
    this.fire("onError", e);
    throw e;
  }
}

class Finder extends Event {
  public settings: DefaultSettingsInterface;
  public totals: TotalInterface;

  constructor(settings: DefaultSettingsInterface = {}) {
    super(settings);
    this.settings = extend({}, defaultSettings, settings);
    this.totals = {
      Directory: 0,
      File: 0,
      BlockDevice: 0,
      CharacterDevice: 0,
      symbolicLink: 0,
      Fifo: 0,
      Socket: 0,
      hidden: 0,
    };
  }

  clean() {
    this.removeAllListeners();
    for (const total of Object.keys(this.totals)) {
      this.totals[total] = 0;
    }
  }

  checkPath(Path: string | FileClass | string[]): Result {
    const type = typeOf(Path);
    const result = new FileResult();
    switch (true) {
      case type === "string":
        result.push(new File(Path as string));
        return result;
      case type === "array": {
        for (const p of Path as string[]) {
          result.push(new File(p));
        }
        return result;
      }
      case Path instanceof FileClass:
        result.push(new File((Path as FileClass).path));
        return result;
      default:
        throw new Error(
          `Bad Path type: ${type} Accept only String, Array or fileClass`,
        );
    }
  }

  async in(
    Path: string | FileClass | string[],
    settings = {},
  ): Promise<Result> {
    let result = null;
    try {
      result = this.checkPath(Path);
      this.settingsToListen(settings);
      const options = extend({}, this.settings, settings);
      for await (const res of result) {
        await parser.call(this, res, undefined, options, options.depth, res);
      }
    } catch (e) {
      this.fire("onError", e);
      throw e;
    }
    this.fire("onFinish", result, this.totals, this);
    this.clean();
    return result;
  }
}

export default Finder;
export { TotalInterface, FinderEvents };
