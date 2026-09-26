import Result from "./Result";
import File from "./File";
import type FileClass from "../FileClass";

class FileResult extends Result {
  // oxlint-disable-next-line no-useless-constructor -- pas redondant : il RESSERRE le type accepté (`File[]` au lieu du `any[]` du parent) ; le retirer rendrait la signature permissive
  constructor(res?: File[]) {
    super(res);
  }

  override toString(): string {
    let txt = "";
    for (const info of this as FileClass[]) {
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
        case undefined:
          // Entrée sans type (non stat-ée) : rien à sérialiser.
          break;
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
        case "File":
        case undefined:
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
        case undefined:
          break;
      }
    }
    return result;
  }

  sortByName(result: FileResult = new FileResult()): FileResult {
    // Entrées de type fichier (le `Builder` y range aussi des `FileClass`).
    const res = this.sort((a: FileClass, b: FileClass) => {
      if (a.name > b.name) return 1;
      if (a.name < b.name) return -1;
      return 0;
    });
    if (res) {
      return result.concat(res) as unknown as FileResult;
    }
    return this;
  }

  sortByType(result = new FileResult()): FileResult {
    // `type` est posé à la lecture du fichier ; comparé tel quel.
    const res = this.sort((a: FileClass, b: FileClass) => {
      if ((a.type as string) > (b.type as string)) return 1;
      if ((a.type as string) < (b.type as string)) return -1;
      return 0;
    });
    if (res) {
      return result.concat(res) as unknown as FileResult;
    }
    return this;
  }
}

export default FileResult;
