import HttpRequest from "./Request";
import Http2Request from "../http2/Request";
import QS from "qs";
import { extend } from "nodefony";
import xml2js from "xml2js";

class Parser {
  request: HttpRequest | Http2Request;
  chunks: Buffer[];
  constructor(request: HttpRequest | Http2Request) {
    this.request = request;
    this.chunks = [];
    this.request.request.on("data", (data) => {
      try {
        this.write(data);
      } catch (e) {
        throw e;
      }
    });
  }

  write(buffer: Buffer) {
    this.chunks.push(buffer);
    return buffer;
  }

  async parse() {
    this.request.data = Buffer.concat(this.chunks);
    return this;
  }
}

class ParserQs extends Parser {
  parserOptions: QS.IParseOptions;
  charset: BufferEncoding = "utf8";
  constructor(request: HttpRequest | Http2Request) {
    super(request);
    this.parserOptions = this.request.queryStringOptions || {};
  }

  override async parse() {
    try {
      await super.parse();
      this.request.queryPost = QS.parse(
        this.request.data.toString(this.charset),
        this.parserOptions
      );
      this.request.query = extend(
        {},
        this.request.query,
        this.request.queryPost
      );
      this.request.context.requestEnded = true;
      return this;
    } catch (err) {
      throw err;
    }
  }
}

class ParserXml extends Parser {
  xmlParser: xml2js.Parser;
  charset: BufferEncoding = "utf8";
  constructor(
    request: HttpRequest | Http2Request,
    settingsXml?: xml2js.ParserOptions
  ) {
    super(request);
    this.xmlParser = new xml2js.Parser(settingsXml);
  }

  override async parse(): Promise<any> {
    await super.parse();
    return new Promise((resolve, reject) => {
      this.xmlParser.parseString(
        this.request.data.toString(this.charset),
        (err, result) => {
          if (err) {
            return reject(err);
          }
          this.request.queryPost = result;
          this.request.context.requestEnded = true;
          return resolve(this);
        }
      );
    });
  }
}

// const acceptParser = function (
//   acc: string
// ): { type: RegExp; subtype: RegExp }[] {
//   if (!acc) {
//     return [
//       {
//         type: new RegExp(".*"),
//         subtype: new RegExp(".*"),
//       },
//     ];
//   }
//   const obj = {};
//   try {
//     const types = acc.split(",");
//     for (let i = 0; i < types.length; i++) {
//       const type = types[i].split(";");
//       const mine = type.shift();
//       if (!mine) {
//         throw new Error(`acceptParser error mine `);
//       }
//       const dec = mine.split("/");
//       const ele1 = dec.shift();
//       const ele2 = dec.shift();
//       obj[mine] = {
//         type: new RegExp(ele1 === "*" ? ".*" : ele1),
//         subtype: new RegExp(ele2 === "*" ? ".*" : ele2),
//       };
//       for (let j = 0; j < type.length; j++) {
//         const params = type[j].split("=");
//         const name = params.shift();
//         obj[mine][name] = params.shift();
//       }
//     }
//     // sort
//     const tab = [];
//     const qvalue = [];
//     for (const ele in obj) {
//       const line = obj[ele];
//       if (line.q) {
//         qvalue.push(obj[ele]);
//       } else {
//         tab.push(obj[ele]);
//       }
//     }
//     if (qvalue.length) {
//       return tab.concat(
//         qvalue.sort((a, b) => {
//           if (a.q > b.q) {
//             return -1;
//           }
//           if (a.q < b.q) {
//             return 1;
//           }
//           return 0;
//         })
//       );
//     }
//     return tab;
//   } catch (e) {
//     throw e;
//   }
// };

const acceptParser = function (
  acc?: string
): { type: RegExp; subtype: RegExp; [key: string]: any }[] {
  if (!acc) {
    return [
      {
        type: new RegExp(".*"),
        subtype: new RegExp(".*"),
      },
    ];
  }
  const arr = [];
  try {
    const types = acc.split(",");
    for (let i = 0; i < types.length; i++) {
      const type = types[i].split(";");
      const mine = type.shift();
      if (!mine) {
        throw new Error(`acceptParser error mine `);
      }
      const dec = mine.split("/");
      const ele1 = dec.shift();
      const ele2 = dec.shift();
      const e1: string | RegExp = ele1 === "*" ? ".*" : ele1 || ".*";
      const e2: string | RegExp = ele2 === "*" ? ".*" : ele2 || ".*";
      const obj: { [key: string]: any } = {
        type: new RegExp(e1),
        subtype: new RegExp(e2),
      };
      for (let j = 0; j < type.length; j++) {
        const params = type[j].split("=");
        const name = params.shift();
        const value = params.shift();
        obj[name as string] =
          name === "q" ? parseFloat(value as string) : value;
      }
      arr.push(obj);
    }
    // sort
    return arr.sort((a, b) => {
      const qA = a.q || 1;
      const qB = b.q || 1;
      return qB - qA;
    }) as { type: RegExp; subtype: RegExp; [key: string]: any }[];
  } catch (e) {
    throw e;
  }
};

export { Parser, ParserXml, ParserQs, acceptParser };
