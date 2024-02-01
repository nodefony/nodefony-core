import { Nodefony } from "nodefony";
const kernel = Nodefony.kernel;
import path from "node:path";

const certificates = {
  path: path.resolve(kernel?.path || ".", "nodefony", "config", "certificates"),
  privateKeyPath: "",
  certPath: "",
  caPath: "",
  key: "",
  cert: "",
  ca: "",
  openssl: {
    size: 2048,
    attrs: [
      { name: "commonName", value: `${kernel?.domain}` || "nodefony.com" },
      { name: "organizationName", value: kernel?.projectName || "" },
      { name: "organizationalUnitName", value: "Development" },
      { name: "countryName", value: "FR" },
      { name: "stateOrProvinceName", value: "BDR" },
      { name: "localityName", value: "Marseille" },
      { name: "organizationName", value: "Nodefony Signing Authority" },
      //{ name: "emailAddress", value: `admin@${kernel?.domain}` },
    ],
  },
};

switch (kernel?.environment) {
  case "production":
  case "development":
  default:
    certificates.privateKeyPath = path.resolve(
      certificates.path,
      "server",
      "privkey.pem"
    );
    certificates.certPath = path.resolve(
      certificates.path,
      "server",
      "cert.pem"
    );
    certificates.caPath = path.resolve(
      certificates.path,
      "ca",
      "nodefony-root-ca.crt.pem"
    );
}

export default {
  rejectUnauthorized: true,
  certificates,
};
