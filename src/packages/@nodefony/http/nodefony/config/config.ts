import { kernel } from "nodefony";
import path from "node:path";
import fs from "node:fs";
import { Hash, createHash } from "node:crypto";

const readFile = function (Path: fs.PathOrFileDescriptor): string {
  try {
    return fs.readFileSync(Path, {
      encoding: "utf8",
    });
  } catch (e) {
    console.error(e);
    throw e;
  }
};

const createSecret = function (cwd: string = process.cwd()): string {
  const sercretPath = path.resolve(
    cwd,
    "nodefony",
    "config",
    "certificates",
    "server",
    "private.key.pem"
  );
  return createHash("sha512")
    .update(readFile(sercretPath))
    .digest("base64")
    .substr(0, 32);
};

const createIv = function () {
  const sercretPath = path.resolve(
    "nodefony",
    "config",
    "certificates",
    "server",
    "public.key.pem"
  );
  return createHash("sha512")
    .update(readFile(sercretPath))
    .digest("base64")
    .substr(0, 16);
};

const tmpDir = kernel?.tmpDir.path || "/tmp";

export default {
  watch: false,
  headerServer: "nodefony",
  // For more options parser formidable @see : https://github.com/felixge/node-formidable
  request: {
    uploadDir: tmpDir,
    maxFileSize: 524288000, // 500 MB  //10MB 10485760
    multiples: true,
    maxFieldsSize: 2097152, // 2MB
    maxFields: 1000,
    encoding: "utf-8",
  },
  // For more options parser QS @see : https://github.com/ljharb/qs
  queryString: {
    parameterLimit: 1000,
    delimiter: "&",
    ignoreQueryPrefix: true,
  },

  /*
   *     SERVERS HTTP
   *       @see :            https://nodejs.org/dist/latest-v8.x/docs/api/http.html#http_class_http_server
   */
  http: {
    maxHeadersCount: 2000,
    keepAliveTimeout: 5000, // For keep alive spec (5 secondes)
    timeout: 120000, //   (2 minutes)
    requestTimeout: 30000, // In MS  | 30 seconds by default
    headers: null,
  },
  https: {
    rejectUnauthorized: false,
    maxHeadersCount: 2000,
    keepAliveTimeout: 5000, // For keep alive spec (5 secondes)
    timeout: 120000, //   (2 minutes)
    requestTimeout: 30000, // In MS  | 30 seconds by default
    headers: null,
  },
  http2: {
    enablePush: true,
  },
  http3: {},

  certificates: {
    ca: "",
    key: "",
    cert: "",
    openssl: {
      size: 2048,
      attrs: [
        {
          name: "commonName",
          value: kernel?.domain || "nodefony.com",
        },
        {
          name: "organizationName",
          value: kernel?.projectName || "",
        },
        {
          name: "organizationalUnitName",
          value: "Development",
        },
      ],
    },
  },

  /**
   *       SERVERS WEBSOCKET
   *       For more options @see : https://github.com/theturtle32/WebSocket-Node/blob/master/docs/WebSocketServer.md#server-config-options
   */
  websocket: {
    keepaliveInterval: 20000,
    keepaliveGracePeriod: 10000,
    closeTimeout: 5000,
  },
  websocketSecure: {
    keepaliveInterval: 20000,
    keepaliveGracePeriod: 10000,
    closeTimeout: 5000,
  },
  sockjs: {
    protocol: "https",
    websocket: true,
    domain: "localhost",
    port: 5152,
    prefix: "/sockjs-node",
    stats: {
      cached: false,
      cachedAssets: false,
    },
  },

  /**
   *       SERVERS STACTIC FILES
   *
   *     For dev only
   *       use varnish  or similar reverse proxy caches
   *
   *     you can add directory for find statics file
   *             name:
   *               path:   "/mydirectory/"
   *               maxage: 30*24*60*60*1000 # override default maxage
   *
   */
  statics: {
    defaultOptions: {
      cacheControl: true,
      maxAge: 96 * 60 * 60,
    },
    web: {
      path: "public",
      options: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    },
  },

  /**
   * SESSIONS MANAGER
   *       name            : cookies session name
   *       handler         : files | sequelize | memcached
   *
   *       MEMCACHED
   *        https://github.com/3rd-Eden/memcached
   */
  session: {
    applyTransaction: true, // sequelize transaction session entity
    start: false, // false || true || Name Session Context
    use_strict_mode: true,
    name: "nodefony",
    handler: "files", // files | orm | memcached  "nodefony.session.storage"
    save_path: "/tmp/sessions",
    gc_probability: 1,
    gc_divisor: 100,
    gc_maxlifetime: 1440,
    hash_function: "md5", // sha1
    use_cookies: true,
    use_only_cookies: true,
    referer_check: false,
    cookie: {
      maxAge: 0, // like cookie_lifetime   =>seconde
      httpOnly: true, // don't see by script (javascript)
      secure: false, // https only
      signed: false,
    },
    // encrypt: {
    //   algorithm: "aes-256-ctr",
    //   password: createSecret(),
    //   iv: createIv(),
    // },

    /**
     * SERVICE memcached
     */
    memcached: {
      servers: {
        nodefony: {
          location: "127.0.0.1",
          port: 11211,
          weight: 1,
        },
      },
      options: {
        debug: false,
        timeout: 5000,
      },
    },
  },

  /**
   * SERVICE requestClient
   */
  requestClient: null,
};
