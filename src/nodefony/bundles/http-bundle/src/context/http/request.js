const QS = require('qs');
const formidable = require("formidable");

module.exports = nodefony.register("Request", function () {

  // ARRAY PHP LIKE
  const reg = /(.*)[\[][\]]$/;
  const settingsXml = {};

  class Parser {
    constructor(request) {
      this.request = request;
      this.request.request.on("data", (data) => {
        //console.log("data : ")
        try {
          this.write(data);
          //console.log(this.request.data)
        } catch (e) {
          throw e;
        }
      });
    }
    write(buffer) {
      if (this.request.data.length >= (this.request.dataSize + buffer.length)) {
        buffer.copy(this.request.data, this.request.dataSize);
      } else {
        this.request.data = Buffer.concat([this.request.data, buffer]);
      }
      this.request.dataSize += buffer.length;
      return buffer.length;
    }
    parse() {
      this.request.context.requestEnded = true;
    }
  }

  class ParserQs extends Parser {
    constructor(request) {
      super(request);
      this.queryStringParser = this.request.context.queryStringParser || {};
    }
    parse() {
      try {
        this.request.queryPost = QS.parse(this.request.data.toString(this.charset), this.queryStringParser);
        //this.request.context.setParameters("query.post", this.request.queryPost);
        this.request.query = nodefony.extend({}, this.request.query, this.request.queryPost);
        //this.request.context.setParameters("query.request", this.request.query);
        super.parse();
      } catch (err) {
        throw err;
        //this.request.context.fire("onError", this.request.context.container, err);
        //throw err;
      }
    }
  }

  class ParserXml extends Parser {
    constructor(request) {
      super(request);
      this.xmlParser = new xmlParser(settingsXml);
    }
    parse() {
      this.xmlParser.parseString(this.request.data.toString(this.charset), (err, result) => {
        if (err) {
          //this.request.context.fire("onError", this.request.context.container, err);
          throw err;
        }
        this.request.queryPost = result;
        //this.request.context.setParameters("query.post", this.request.queryPost);
        super.parse();
      });
    }
  }

  const acceptParser = function (acc) {
    if (!acc) {
      return [{
        type: new RegExp(".*"),
        subtype: new RegExp(".*")
      }];
    }
    let obj = {};
    try {
      let types = acc.split(",");
      for (let i = 0; i < types.length; i++) {
        let type = types[i].split(";");
        let mine = type.shift();
        let dec = mine.split("/");
        let ele1 = dec.shift();
        let ele2 = dec.shift();
        obj[mine] = {
          type: new RegExp(ele1 === "*" ? ".*" : ele1),
          subtype: new RegExp(ele2 === "*" ? ".*" : ele2)
        };
        for (let j = 0; j < type.length; j++) {
          let params = type[j].split("=");
          let name = params.shift();
          obj[mine][name] = params.shift();
        }
      }
      // sort
      let tab = [];
      let qvalue = [];
      for (let ele in obj) {
        let line = obj[ele];
        if (line.q) {
          qvalue.push(obj[ele]);
        } else {
          tab.push(obj[ele]);
        }
      }
      if (qvalue.length) {
        return tab.concat(qvalue.sort((a, b) => {
          if (a.q > b.q) {
            return -1;
          }
          if (a.q < b.q) {
            return 1;
          }
          return 0;
        }));
      }
      return tab;
    } catch (e) {
      throw e;
    }
  };

  const parse = {
    POST: true,
    PUT: true,
    DELETE: true
  };

  const Request = class httpRequest {

    constructor(request, context) {
      this.context = context;
      this.request = request;
      this.request.body = null;
      this.headers = request.headers;
      this.method = this.getMethod();
      this.host = this.getHost();
      this.hostname = this.getHostName(this.host);
      this.sUrl = this.getFullUrl(request);
      this.url = this.getUrl(this.sUrl);
      if (this.url.search) {
        this.url.query = QS.parse(this.url.search, this.context.queryStringParser || {});
      } else {
        this.url.query = {};
      }
      this.parser = null;
      this.queryPost = {};
      this.queryFile = [];
      //this.context.setParameters("query.files", this.queryFile);
      this.queryGet = this.url.query;
      //this.context.setParameters("query.get", this.queryGet);
      this.query = this.url.query;
      this.origin = this.headers.origin;
      try {
        this.accept = acceptParser(this.headers.accept);
        this.acceptHtml = this.accepts("html");
      } catch (e) {
        this.log(e, "WARNING");
      }
      this.rawContentType = {};
      this.contentType = this.getContentType(this.request);
      this.charset = this.getCharset(this.request);
      this.domain = this.getDomain();
      this.remoteAddress = this.getRemoteAddress();

      this.dataSize = 0;
      this.data = Buffer.from([], this.charset);
      this.request.on('data', (data) => {
        this.dataSize += data.length;
      });
      this.context.once("onRequestEnd", () => {
        this.request.body = this.query;
      });
      this.initialize();
    }

    initialize(){
      return this.parseRequest()
        .then((parser) => {
          switch (true) {
          case parser instanceof Parser:
          case parser instanceof ParserQs:
          case parser instanceof ParserXml:
            this.request.once("end", () => {
              try {
                if (this.context.finished) {
                  return;
                }
                parser.parse();
                return this.context.fireAsync("onRequestEnd", this);
              } catch (error) {
                return this.context.kernelHttp.onError(this.context.container, error);
              }
            });
            break;
          default:
            if (!parser) {
              this.request.once("end",() => {
                try {
                  if (this.context.finished) {
                    return;
                  }
                  this.context.requestEnded = true;
                  return this.context.fireAsync("onRequestEnd", this);
                } catch (error) {
                  return this.context.kernelHttp.onError(this.context.container, error);
                }
              });
            }
          }
          return parser;
        })
        .catch((error) => {
          if (this.context.requestEnded) {
            return this.context.kernelHttp.onError(this.context.container, error);
          } else {
            this.request.once("end", () => {
              this.context.requestEnded = true;
              return this.context.kernelHttp.onError(this.context.container, error);
            });
          }
        });
    }

    parseRequest() {
      return new Promise((resolve, reject) => {
        if (this.method in parse) {
          switch (this.contentType) {
          case "application/xml":
          case "text/xml":
            this.parser = new ParserXml(this);
            return resolve(this.parser);
          case "application/x-www-form-urlencoded":
            try {
              this.parser = new ParserQs(this);
            } catch (e) {
              return reject(e);
            }
            return resolve(this.parser);
          default:
            let opt = nodefony.extend(this.context.requestSettings, {
              encoding: this.charset
            });
            this.parser = new formidable.IncomingForm(opt);
            this.parser.parse(this.request, (err, fields, files) => {
              if (err) {
                return reject(err);
              }
              try {
                this.queryPost = fields;
                this.query = nodefony.extend({}, this.query, this.queryPost);
                if (Object.keys(files).length) {
                  for (let file in files) {
                    try {
                      if (reg.exec(file)) {
                        if (nodefony.isArray(files[file])) {
                          for (let multifiles in files[file]) {
                            this.createFileUpload(multifiles, files[file][multifiles], opt.maxFileSize);
                          }
                        } else {
                          if (files[file].name) {
                            this.createFileUpload(file, files[file], opt.maxFileSize);
                          }
                        }
                      } else {
                        if (nodefony.isArray(files[file])) {
                          for (let multifiles in files[file]) {
                            this.createFileUpload(multifiles, files[file][multifiles], opt.maxFileSize);
                          }
                        } else {
                          this.createFileUpload(file, files[file], opt.maxFileSize);
                        }
                      }
                    } catch (err) {
                      return reject(err);
                    }
                  }
                }
              } catch (err) {
                return reject(err);
              }
              this.context.requestEnded = true;
              this.context.fireAsync("onRequestEnd", this);
              return resolve(this.parser);
            });
          }
        } else {
          return resolve();
        }
      });
    }

    createFileUpload(name, file, maxSize) {
      if (file.size > maxSize) {
        throw new Error('maxFileSize exceeded, received ' + file.size + ' bytes of file data for : ' + file.name);
      }
      let fileUpload = this.context.uploadService.createUploadFile(file);
      let index = this.queryFile.push(fileUpload);
      name = name || file.name;
      if (name !== "null" || "undefined") {
        this.queryFile[name] = this.queryFile[index - 1];
      }
      return fileUpload;
    }

    accepts(Type) {
      let parse = null;
      let subtype = "*";
      let type = "*";
      try {
        if (Type) {
          parse = Type.split("/");
        }
        if (parse) {
          switch (parse.length) {
          case 1:
            subtype = parse.shift();
            break;
          case 2:
            type = parse.shift();
            subtype = parse.shift();
            break;
          default:
            throw new Error("request accepts method bad type format");
          }
        }
        for (let i = 0; i < this.accept.length; i++) {
          let line = this.accept[i];
          if ((type === "*" || line.type.test(type)) && (subtype === "*" || line.subtype.test(subtype))) {
            return true;
          }
          continue;
        }
        return false;
      } catch (e) {
        throw e;
      }
    }

    getHost() {
      return this.request.headers.host;
    }

    getHostName(host) {
      if (this.url && this.url.hostname) {
        return this.url.hostname;
      }
      if (host) {
        return host.split(":")[0];
      }
      if (host = this.getHost()) {
        return host.split(":")[0];
      }
      return "";
    }

    getUserAgent() {
      return this.request.headers['user-agent'];
    }

    getMethod() {
      return this.request.method;
    }

    clean() {
      this.data = null;
      delete this.data;
      this.body = null;
      delete this.body;
      this.parser = null;
      delete this.parser;
      this.queryPost = null;
      delete this.queryPost;
      this.queryFile = null;
      delete this.queryFile;
      this.queryGet = null;
      delete this.queryGet;
      this.query = null;
      delete this.query;
      this.request = null;
      delete this.request;
      this.accept = null;
      delete this.accept;
      //this.container = null ;
      //delete this.container ;
      //super.clean();
    }

    log(pci, severity, msgid, msg) {
      if (!msgid) {
        msgid = this.context.type + " REQUEST ";
      }
      return this.context.log(pci, severity, msgid, msg);
    }

    getContentType(request) {
      if (request.headers["content-type"]) {
        let tab = request.headers["content-type"].split(";");
        if (tab.length > 1) {
          for (let i = 1; i < tab.length; i++) {
            if (typeof tab[i] === "string") {
              let ele = tab[i].split("=");
              let key = ele[0].replace(" ", "").toLowerCase();
              this.rawContentType[key] = ele[1];
            } else {
              continue;
            }
          }
        }
        this.extentionContentType = request.headers["content-type"];
        return tab[0];
      }
      return null;
    }

    getCharset() {
      if (this.rawContentType.charset) {
        return this.rawContentType.charset;
      }
      return "utf8";
    }

    getDomain() {
      return this.getHostName();
      //return this.host.split(":")[0];
    }

    getRemoteAddress() {
      // proxy mode
      if (this.headers && this.headers['x-forwarded-for']) {
        return this.headers['x-forwarded-for'];
      }
      if (this.request.connection && this.request.connection.remoteAddress) {
        return this.request.connection.remoteAddress;
      }
      if (this.request.socket && this.request.socket.remoteAddress) {
        return this.request.socket.remoteAddress;
      }
      if (this.request.connection && this.request.connection.socket && this.request.connection.socket.remoteAddress) {
        return this.request.connection.socket.remoteAddress;
      }
      return null;
    }

    setUrl(Url) {
      this.url = this.getUrl(Url);
    }

    getUrl(sUrl, query) {
      return url.parse(sUrl, query);
    }

    getFullUrl(request) {
      // proxy mode
      if (this.headers && this.headers['x-forwarded-for']) {
        return this.headers['x-forwarded-proto'] + "://" + this.host + request.url;
      }
      if (request.connection.encrypted) {
        return 'https://' + this.host + request.url;
      } else {
        return 'http://' + this.host + request.url;
      }
    }

    getHeader(name) {
      if (name in this.headers) {
        return this.headers[name];
      }
      return null;
    }

    isAjax() {
      if (this.headers['x-requested-with']) {
        return ('xmlhttprequest' === this.headers['x-requested-with'].toLowerCase());
      }
      return false;
    }
  };

  return Request;
});
