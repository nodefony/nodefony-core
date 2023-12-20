/* eslint-disable @typescript-eslint/no-unnecessary-type-constraint */
/* eslint-disable @typescript-eslint/no-explicit-any */
import Result from './Result'
import File from './File'


class FileResult extends Result {

  constructor (res?:  File[] | undefined) {
    super(res);
     Array.prototype.find
  }

  toString () : string {
    let txt = "";
    for (let index = 0; index < this.length; index++) {
      const info = this[index];
      txt += `${info.name}\n`;
    }
    return txt;
  }

  toJson (json :any[]= []) : string{
    for (let index = 0; index < this.length; index++) {
      const info :File = this[index];
      switch (info.type) {
      case "File":
        json.push(info.toJson());
        break;
      case "symbolicLink":
      case "Directory":{
        const dir = info.toJson();
        if (info.children) {
          dir.children = info.children.toJson();
        }
        json.push(dir);
        break;
      }
      }
    }
    return JSON.stringify(json);
  }

  uniq () {
    return this;
  }

  find <S>(predicate: (value: any, index: number, obj: any[]) => value is S, result : FileResult = new FileResult()) : FileResult {
    for (let index = 0; index < this.length; index++) {
      const info: File = this[index];
      const unknownType : unknown= predicate
      const match = info.matchName(<string>unknownType);
      if (match) {
        result.push(info);
      }
      info.children.find(predicate, result);
    }
    return result.uniq();
  }

  getDirectories (result :FileResult  = new FileResult()) :FileResult {
    for (let index = 0; index < this.length; index++) {
      const info: File = this[index];
      switch (info.type) {
      case "Directory":
        result.push(info);
        info.children.getDirectories(result);
        break;
      case "symbolicLink":
        info.children.getDirectories(result);
        break;
      }
    }
    return result;
  }

  getFiles (result  :FileResult  = new FileResult()) : FileResult{
    for (let index = 0; index < this.length; index++) {
      const info :File= this[index];
      switch (info.type) {
      case "File":
        result.push(info);
        break;
      case "symbolicLink":
      case "Directory":
        info.children.getFiles(result);
        break;
      }
    }
    return result;
  }

  sortByName (result : FileResult = new FileResult()) : FileResult{
    const res = this.sort((a, b) => {
      if (a.name.toString() > b.name.toString()) {
        return 1;
      }
      if (a.name.toString() < b.name.toString()) {
        return -1;
      }
      return 0;
    });
    if (res) {
      const unknownResult: unknown = result.concat(res);
      return  <FileResult>unknownResult;
    }
    return this;
  }

  sortByType (result = new FileResult()) : FileResult{
    const res = this.sort((a, b) => {
      if (a.type.toString() > b.type.toString()) {
        return 1;
      }
      if (a.type.toString() < b.type.toString()) {
        return -1;
      }
      return 0;
    });
    if (res) {
      const unknownResult: unknown = result.concat(res);
      return <FileResult>unknownResult;
    }
    return this;
  }
}

export default FileResult
