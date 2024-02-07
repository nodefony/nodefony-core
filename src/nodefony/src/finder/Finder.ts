/* eslint-disable no-async-promise-executor */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { promises as fsPromises } from "fs";
import Event from "../Event";
import { extend, typeOf } from "../Tools";
import FileResult from "./FileResult";
import File from "./File";
import FileClass from "../FileClass";
import Result from "./Result";
import path from "node:path";
import fs from "node:fs";
import _ from "lodash";
const { isNull } = _;

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
  let match = null;
  const test = options.exclude || options.excludeDir || options.excludeFile;
  if (!test) {
    return false;
  }
  if (options.exclude) {
    match = info.matchName(options.exclude);
    if (match) {
      return true;
    }
  }
  if (options.excludeDir) {
    if (info.isDirectory()) {
      match = info.matchName(options.excludeDir);
      if (match) {
        return true;
      }
    }
  }
  if (options.excludeFile) {
    if (info.isFile()) {
      match = info.matchName(options.excludeFile);
      if (match) {
        return true;
      }
    }
  }
  return false;
};

const checkMatch = function (
  this: Finder,
  info: File,
  options: DefaultSettingsInterface = {},
  result: Result
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
      if (info.matchName(options.matchFile)) {
        match = true;
      } else {
        match = false;
      }
    }
  }
  if (options.match) {
    const res = info.matchName(options.match);
    // console.log("match ", info.name, res)
    if (res) {
      match = true;
    } else {
      match = false;
      rec = info.type;
    }
  }
  // state match
  if (match) {
    result.push(info);
    this.totals[<string>info.type]++;
    this.fire(`on${info.type}`, info, this);
    return true;
  }
  switch (rec) {
    // false match
    case "Directory":
    case "symbolicLink":
      result.push(info);
      this.totals[<string>info.type]++;
      this.fire(`on${info.type}`, info, this);
      return true;
    default:
      // false file
      // console.log("bypass ", info.name)
      return false;
  }
};

const parser = function (
  this: Finder,
  file: FileClass,
  result = new FileResult(),
  options: DefaultSettingsInterface,
  depth: number | null = null,
  parent: File | null = null
) {
  return new Promise(async (resolve, reject) => {
    if (depth === 0) {
      return resolve(result);
    }
    let res = null;
    if (parent) {
      parent.childrens = result;
    }

    try {
      if (file.type !== "symbolicLink") {
        res = await fsPromises
          .readdir(<fs.PathLike>file.path, {
            encoding: "utf8",
            withFileTypes: false,
          })
          .catch((e) => reject(e));
      } else if (options.followSymLink) {
        // console.log("symbolicLink First", file.name)
        res = await fsPromises
          .readlink(<fs.PathLike>file.path)
          .catch((e) => reject(e));
      }
      // console.log(res)
      if (res && res.length) {
        for (let i = 0; i < res.length; i++) {
          const ret = path.resolve(<string>file.path, res[i]);
          const info = new File(ret, parent);
          // hidden file
          const hidden = info.isHidden();
          if (hidden) {
            if (!options.seeHidden) {
              continue;
            }
          }
          if (checkExclude(info, options)) {
            // console.log("EXCLUDEEEEE", info.name)
            continue;
          }
          let symLink = null;
          if (info.type === "symbolicLink" && options.followSymLink) {
            try {
              const read = path.resolve(
                info.dirName,
                await fsPromises.readlink(<fs.PathLike>info.path)
              );
              symLink = new File(read, info);
            } catch (e) {
              this.fire("onError", e, this);
              continue;
            }
          }
          const match = checkMatch.call(this, info, options, result);
          // console.log("match state", !match, info.name, info.type)
          if (!match) {
            continue;
          }

          if (hidden) {
            this.totals.hidden++;
            this.fire("onHidden", info, this);
          }
          // console.log("PASSSS ", info.name, info.type)
          if (info.type === "File") {
            continue;
          }
          // recurse
          if (!options.recurse) {
            continue;
          }
          // console.log("RECCCCCC", info.type, info.name)
          switch (info.type) {
            case "Directory": {
              const myDeph: null | number = isNull(depth) ? null : depth - 1;
              await parser.call(this, info, undefined, options, myDeph, info);
              break;
            }
            case "symbolicLink":
              if (symLink) {
                if (symLink.isDirectory()) {
                  // info.children = await parser.call(this, symLink, undefined, options, depth - 1, info);
                  const myDeph: null | number = isNull(depth)
                    ? null
                    : depth - 1;
                  await parser.call(
                    this,
                    symLink,
                    undefined,
                    options,
                    myDeph,
                    info
                  );
                }
              }
              break;
          }
        }
      }
      // console.log("resolve ", file.name, result.length)
      return resolve(result);
    } catch (e) {
      this.fire("onError", e);
      return reject(e);
    }
  });
};

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
    for (const total in this.totals) {
      this.totals[total] = 0;
    }
  }

  ckeckPath(Path: string | FileClass | string[]): Result {
    const type = typeOf(Path);
    const result = new FileResult();
    switch (true) {
      case type === "string":
        result.push(new File(<string>Path));
        return result;
      case type === "array": {
        const length: number = (<string[]>Path).length;
        for (let i = 0; i < length; i++) {
          result.push(new File((<string>Path)[i]));
        }
        return result;
      }
      case Path instanceof FileClass:
        result.push(new File((<FileClass>Path).path));
        return result;
      default:
        throw new Error(
          `Bad Path type: ${type} Accept only String, Array or fileClass`
        );
    }
  }

  async in(
    Path: string | FileClass | string[],
    settings = {}
  ): Promise<Result> {
    let result = null;
    try {
      result = this.ckeckPath(Path);
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
