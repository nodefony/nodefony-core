import { Error as NodefonyError } from "nodefony";
import clc from "cli-color";
import { ContextType } from "../../service/http-kernel";
import { HttpRequestType, HttpRsponseType } from "../context/http/HttpContext";

type JsonDescriptor = {
  configurable?: boolean;
  enumerable?: boolean;
  value?: () => any;
  writable?: boolean;
};

const exclude = {
  context: true,
  resolver: true,
  container: true,
  secure: true,
  request: true,
  response: true,
};
const jsonHttpError: JsonDescriptor = {
  configurable: true,
  writable: true,
  value() {
    const alt: Record<string, any> = {};
    const storeKey = function (this: Record<string, any>, key: string) {
      if (key in exclude) {
        return;
      }
      alt[key] = this[key];
    };
    Object.getOwnPropertyNames(this).forEach(storeKey, this);
    return alt;
  },
};

class HttpError extends NodefonyError {
  context?: ContextType;
  response?: HttpRsponseType;
  request?: HttpRequestType;
  url?: string;
  constructor(
    message?: string | NodefonyError | Error | any,
    code?: number,
    context?: ContextType
  ) {
    super(message, code);
    this.context = context;
    this.response = context?.response as HttpRsponseType;
    this.request = context?.request as HttpRequestType;
    this.url = this.context?.url;
    if (this.response && code) {
      this.response.statusCode = code;
    }
    if (!this.message) {
      this.message =
        (context?.response as HttpRsponseType)?.body?.toString() ||
        (context?.response as HttpRsponseType)?.statusMessage ||
        (context?.response as HttpRsponseType)?.getStatusMessage();
    }
  }

  override toString(): string {
    if (this.context) {
      return `${clc.red(this.message)}
    ${clc.blue("Name :")} ${this.name}
    ${clc.blue("Type :")} ${this.errorType}
    ${clc.green("Controller :")} ${this.controller}
    ${clc.green("Action :")} ${this.action}
    ${clc.blue("Url :")} ${this.url}
      ${clc.red("Code :")} ${this.code}
      ${clc.red("Message :")} ${this.message}
      ${clc.red("Response :")} ${this.jsonResponse}
    ${clc.green("Stack :")} ${this.stack}`;
    }
    return `${clc.red(this.message)}
    ${clc.blue("Name :")} ${this.name}
    ${clc.blue("Type :")} ${this.errorType}

      ${clc.red("Code :")} ${this.code}
      ${clc.red("Message :")} ${this.message}
      ${clc.red("Response :")} ${this.jsonResponse}
    ${clc.green("Stack :")} ${this.stack}`;
  }
}
Object.defineProperty(HttpError.prototype, "toJSON", jsonHttpError);

export default HttpError;

// module.exports = nodefony.register("httpError", () => {
//   class httpError extends nodefony.Error {
//     constructor(message, code, container) {
//       super(message, code);
//       this.container = container;
//       this.context = null;
//       this.bundle = "";
//       this.controller = "";
//       this.action = "";
//       this.url = "";
//       this.xjson = null;
//       this.resolver = null;
//       if (this.container) {
//         this.parserContainer();
//       }
//       if (
//         this.code === 1000 ||
//         this.code === 200 ||
//         typeof this.code === "string"
//       ) {
//         this.code = 500;
//       }
//     }

//     log(data) {
//       if (this.context) {
//         if (data) {
//           return this.context.log.apply(this.context, arguments);
//         }
//         return this.context.log(
//           this.toString(),
//           "ERROR",
//           `${clc.magenta(this.code)} ${clc.red(this.method)}`
//         );
//       }
//       return super.log(data);
//     }

// toString() {
//   let err = "";
//   switch (this.errorType) {
//     case "httpError":
//       if (kernel && kernel.environment === "prod") {
//         return ` ${clc.blue("Url :")} ${this.url} ${err}`;
//       }
//       err += `${clc.blue("Name :")} ${this.name}
//     ${clc.blue("Type :")} ${this.errorType}
//     ${clc.red("Code :")} ${this.code}
//     ${clc.blue("Url :")} ${this.url}
//     ${clc.red("Message :")} ${this.message}
//     ${clc.green("Bundle :")} ${this.bundle}
//     ${clc.green("Controller :")} ${this.controller}
//     ${clc.green("Action :")} ${this.action}`;
//       if (kernel.debug) {
//         err += `
//         ${clc.green("Stack :")} ${this.stack}`;
//       }
//       return err;
//     default:
//       return super.toString();
//   }
// }

//     parserContainer() {
//       this.bundle = this.container.get("bundle")
//         ? this.container.get("bundle").name
//         : "";
//       this.controller = this.container.get("controller")
//         ? this.container.get("controller").name
//         : "";
//       this.action = this.container.get("action")
//         ? this.container.get("action")
//         : "";
//       this.context = this.container.get("context");
//       if (this.context) {
//         this.url = this.context.url || "";
//         this.method = this.context.method;
//         this.scheme = this.context.scheme;
//         if (!this.code && this.context.response) {
//           this.code = this.context.response.getStatusCode();
//         }
//         if (this.xjson && this.context.setXjson) {
//           this.context.setXjson(this.xjson);
//         }
//         if (this.context.response) {
//           if (this.message === "null") {
//             this.message = "Internal Server Error";
//           }
//           const st = this.context.response.setStatusCode(
//             this.code,
//             this.message
//           );
//           this.code = st.code;
//           this.message = st.message;
//           this.resolve();
//         }
//         if (
//           this.code === 1000 ||
//           this.code === 200 ||
//           typeof code === "string"
//         ) {
//           this.code = 500;
//         }

//         /* if (this.context.isJson) {
//           try {
//             let obj = {
//               code: this.code,
//               message: this.message,
//               bundle: this.bundle,
//               controller: this.controller,
//               action: this.action,
//               url: this.url
//             };
//             if (this.context.kernel.debug) {
//               obj.stack = this.stack;
//             }
//             this.pdu = JSON.stringify(new nodefony.PDU(obj, "ERROR"));
//           } catch (e) {
//             this.message = e.message;
//             this.log(e, "WARNING");
//           }
//         }*/
//       }
//     }

// parserResponse() {
//   const json = this.response?.toJSON();
//   if (json) {
//     this.requestUrl = json.request.uri.href;
//     this.code = json.statusCode;
//     this.jsonResponse = JSON.stringify(json, null, " ");
//   }
//   this.parseMessage(json.body);
// }

// parserResponse() {
//   const json = this.response.toJSON();
//   if (json) {
//     this.requestUrl = json.request.uri.href;
//     this.code = json.statusCode;
//     this.jsonResponse = JSON.stringify(json, null, " ");
//   }
//   this.parseMessage(json.body);
// }

//     resolve(setStatus = false) {
//       switch (this.code) {
//         case 404:
//           this.resolver = this.context.router.resolveName(
//             this.context,
//             "frameworkBundle:default:404"
//           );
//           break;
//         case 401:
//           this.resolver = this.context.router.resolveName(
//             this.context,
//             "frameworkBundle:default:401"
//           );
//           break;
//         case 403:
//           this.resolver = this.context.router.resolveName(
//             this.context,
//             "frameworkBundle:default:403"
//           );
//           break;
//         case 408:
//           this.resolver = this.context.router.resolveName(
//             this.context,
//             "frameworkBundle:default:timeout"
//           );
//           break;
//         default:
//           this.resolver = this.context.router.resolveName(
//             this.context,
//             "frameworkBundle:default:exceptions"
//           );
//           if (this.code < 400) {
//             this.code = 500;
//           }
//       }
//       if (setStatus) {
//         this.context.response.setStatusCode(this.code, this.message);
//       }
//     }

//     parseMessage(message) {
//       switch (nodefony.typeOf(message)) {
//         case "Error":
//           super.parseMessage(message);
//           if (message.status) {
//             this.code = message.status;
//           }
//           if (message.xjson) {
//             this.xjson = message.xjson;
//           }
//           break;
//         case "string":
//           this.message = message;
//           break;
//         case "object":
//           if (message.status) {
//             this.code = message.status;
//           }
//           if (message.code) {
//             this.code = message.code;
//           }
//           if (message.xjson) {
//             this.xjson = message.xjson;
//           }
//           try {
//             if (message.error) {
//               return this.parseMessage(message.error);
//             }
//             if (message.message) {
//               return (this.message = message.message);
//             }
//             return (this.message = util.inspect(message, { depth: 0 }));
//           } catch (e) {
//             this.error = e;
//             this.code = 500;
//           }
//           break;
//         default:
//           return super.parseMessage(message);
//       }
//     }
//   }

//   return httpError;
// });
