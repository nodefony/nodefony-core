/**
 *  NODEFONY FRAMEWORK
 *
 *       KERNEL CONFIG
 *
 *   Domain listen : Nodefony can listen only one domain ( no vhost )
 *     Example :
 *      domain :  0.0.0.0      // for all interfaces
 *      domain :  [::1]        // for IPV6 only
 *      domain :  192.168.1.1  // IPV4
 *      domain :  mydomain.com // DNS
 *
 *   Domain Alias : string only "<<regexp>>" use domainCheck : true
 *     Example :
 *      domainAlias:[
 *        "^127.0.0.1$",
 *        "^localhost$",
 *        ".*\\.nodefony\\.com",
 *        "^nodefony\\.eu$",
 *        "^.*\\.nodefony\\.eu$"
 *      ]
 */
import path from "node:path";
import { Nodefony } from "nodefony";
const kernel = Nodefony.kernel;

const certificats = {
  options: {
    rejectUnauthorized: true,
  },
  key: "",
  cert: "",
  ca: "",
};
let CDN = null;
let statics = true;
let monitoring = true;
let documentation = true;
let unitTest = true;
let domainCheck = false;

switch (kernel?.environment) {
  case "production":
  case "development":
  default:
    certificats.key = path.resolve(
      "nodefony",
      "config",
      "certificates",
      "server",
      "privkey.pem"
    );
    certificats.cert = path.resolve(
      "nodefony",
      "config",
      "certificates",
      "server",
      "fullchain.pem"
    );
    certificats.ca = path.resolve(
      "nodefony",
      "config",
      "certificates",
      "ca",
      "nodefony-root-ca.crt.pem"
    );
    CDN = null;
    statics = true;
    documentation = true;
    monitoring = true;
    unitTest = true;
    domainCheck = true;
}

export default {
  domain: "localhost", // "0.0.0.0" "selectAuto"
  domainAlias: ["^127.0.0.1$", "^localhost$"],
  domainCheck,
  servers: {
    statics,
    http: {
      port: 5151,
      protocol: "2.0", //  2.0 || 1.1
    },
    https: {
      port: 5152,
      protocol: "2.0", //  2.0 || 1.1
    },
    ws: {},
    wss: {},
  },
  certificats,
  // httpPort: 5151,
  // httpsPort: 5152,

  locale: "en_en",

  /**
   * SERVERS
   */
  // servers: {
  //   statics,
  //   protocol: "2.0", //  2.0 || 1.1
  //   http: true,
  //   https: true,
  //   ws: true,
  //   wss: true,
  //   certificats,
  // },

  /**
   * DEV SERVER
   */
  devServer: {
    hot: false, // true  || only || false
    overlay: true,
    logging: "info", // none, error, warning or info
    progress: false,
    protocol: "https",
    websocket: true,
  },

  /**
   * SYSLOG NODEFONY
   */
  log: {
    active: true,
    debug: "*", // ["WEBPACK","ROUTER","bundle-sequelize"]
  },

  /**
   *       ASSETS CDN
   *
   *       You set cdn with string
   *       CDN :    "cdn.nodefony.com",
   *       or
   *       CDN:
   *          global: "cdn.nodefony.com",
   *       or
   *       CDN:{
   *         stylesheet:[
   *           "cdn.nodefony.com"
   *         ],
   *         javascript:[
   *           "cdn.nodefony.com"
   *         ],
   *         image:[
   *           "cdn.nodefony.com",
   *           "cdn.nodefony.fr"
   *         ],
   *         font:[
   *           "cdn.nodefony.com"
   *         ]
   *      },
   */
  CDN,

  /**
   *  ENGINE TEMPLATE
   *
   *       TWIG
   *       https://github.com/justjohn/twig.js
   *
   */
  templating: "twig",

  /**
   * ENGINE ORM
   *       sequelize || mongoose
   *   orm : mongoose
   */
  orm: "sequelize",

  /**
   * NODE.JS PACKAGE MANAGER
   *
   *       npm
   *       yarn
   *       pnpm
   */
  packageManager: "yarn",
};