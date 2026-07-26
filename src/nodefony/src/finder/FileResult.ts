import Result from "./Result";
import File from "./File";

class FileResult extends Result {
  // oxlint-disable-next-line no-useless-constructor -- pas redondant : il RESSERRE le type accepté (`File[]` au lieu du `any[]` du parent) ; le retirer rendrait la signature permissive
  constructor(res?: File[] | undefined) {
    super(res);
  }

  override toString(): string {
    let txt = "";
    for (const info of this) {
      txt += `${info.name}\n`;
    }
    return txt;
  }

  override toJson(json: unknown[] = []): string {
    for (const info of this as unknown as File[]) {
      switch (info.type) {
        case "File":
          json.push(info.toJson());
          break;
        case "symbolicLink":
        case "Directory": {
          const dir = info.toJson() as unknown as Record<string, unknown>;
          if (info.childrens) {
            dir.childrens = info.childrens.toJson();
          }
          json.push(dir);
          break;
        }
      }
    }
    return JSON.stringify(json);
  }

  uniq(): FileResult {
    const seen = new Set<string>();
    const result = new FileResult();
    for (const info of this as unknown as File[]) {
      const key = info.path as string;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(info);
      }
    }
    return result;
  }

  findByName(
    name: string | RegExp,
    result: FileResult = new FileResult(),
  ): FileResult {
    for (const info of this as unknown as File[]) {
      if (info.matchName(name)) {
        result.push(info);
      }
      info.childrens.findByName(name, result);
    }
    return result.uniq();
  }

  getDirectories(result: FileResult = new FileResult()): FileResult {
    for (const info of this as unknown as File[]) {
      switch (info.type) {
        case "Directory":
          result.push(info);
          info.childrens.getDirectories(result);
          break;
        case "symbolicLink":
          info.childrens.getDirectories(result);
          break;
      }
    }
    return result;
  }

  getFiles(result: FileResult = new FileResult()): FileResult {
    for (const info of this as unknown as File[]) {
      switch (info.type) {
        case "File":
          result.push(info);
          break;
        case "symbolicLink":
        case "Directory":
          info.childrens.getFiles(result);
          break;
      }
    }
    return result;
  }

  sortByName(result: FileResult = new FileResult()): FileResult {
    const res = this.sort((a, b) => {
      if (a.name.toString() > b.name.toString()) return 1;
      if (a.name.toString() < b.name.toString()) return -1;
      return 0;
    });
    if (res) {
      return result.concat(res) as unknown as FileResult;
    }
    return this;
  }

  sortByType(result = new FileResult()): FileResult {
    const res = this.sort((a, b) => {
      if (a.type.toString() > b.type.toString()) return 1;
      if (a.type.toString() < b.type.toString()) return -1;
      return 0;
    });
    if (res) {
      return result.concat(res) as unknown as FileResult;
    }
    return this;
  }
}

export default FileResult;
