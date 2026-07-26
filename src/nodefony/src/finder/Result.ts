import { Severity } from "../syslog/Pdu";

/* eslint-disable @typescript-eslint/no-explicit-any */
class Result extends Array {
  constructor(res?: any[]) {
    if (res) {
      if (Array.isArray(res)) {
        super();
        for (const item of res) {
          this.push(item);
        }
        if (res instanceof Result) {
          res.clean();
        }
      } else {
        throw new Error(`Result bad type must be an array : ${res}`);
      }
    } else {
      super();
    }
  }

  toJson(json: any[] = []): string {
    for (const ele of this) {
      json.push(ele);
    }
    return JSON.stringify(json);
  }

  override toString(): string {
    const json: any[] = [];
    for (const ele of this) {
      json.push(ele);
    }
    return JSON.stringify(json, null, "\n");
  }

  clean(callback?: (ele: any) => void) {
    if (callback) {
      Array.prototype.forEach.call(this, (ele: any) => {
        return callback(ele);
      });
    }
    this.length = 0;
  }

  query(
    query: string,
    logger: boolean = false,
    options = {},
    sevrity: Severity = "INFO",
    clean: boolean = false,
  ): Result {
    const res = new Result(
      this.filter((data: Result) => {
        const found = data.query(query, logger, options, sevrity);
        if (found) {
          return data;
        }
        return null;
      }),
    );
    if (clean) {
      this.clean();
    }
    return res;
  }

  queryGrep(query: string, grep: string, clean: boolean = false): Result {
    const res = new Result(
      this.filter((data: Result) => {
        const found = data.queryGrep(query, grep);
        if (found) {
          return data;
        }
        return null;
      }),
    );
    if (clean) {
      this.clean();
    }
    return res;
  }
}

export default Result;
