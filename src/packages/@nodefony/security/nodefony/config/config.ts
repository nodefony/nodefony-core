//import nodefony from "nodefony";
//import { HelmetOptions } from "helmet";
//import { optionsSecuredArea } from "@nodefony/security";

export default {
  watch: false,

  firewalls: {},

  headers: {
    http: {},
    https: {},
  },

  cors: {
    "allow-origin": "*",
    "Access-Control": {
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "ETag, Authorization,  X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date",
      "Access-Control-Allow-Credentials": true,
      "Access-Control-Expose-Headers": "WWW-Authenticate ,X-Json",
      "Access-Control-Max-Age": 10,
    },
  },

  csrf: {
    name: "csrf-token",
    ignoreMethods: ["GET", "HEAD", "OPTIONS"],
    cookie: false,
    session: true,
    secret: "",
  },

  "passport-jwt": {
    refreshToken: true,
  },
};
