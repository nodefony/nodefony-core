import { Nodefony } from "nodefony";
const kernel = Nodefony.getKernel();
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

let rejectUnauthorized = true;
switch (kernel?.environment) {
  case "production":
  case "development":
  default:
    if (kernel?.isDev) {
      rejectUnauthorized = false;
    }
    certificates.privateKeyPath = path.resolve(
      certificates.path,
      "server",
      "privkey.pem",
    );
    certificates.certPath = path.resolve(
      certificates.path,
      "server",
      "cert.pem",
    );
    certificates.caPath = "";
}

export default {
  rejectUnauthorized,
  certificates,
  // Barrière Host (anti Host-header injection) — lue par `compileTrustedHosts`.
  // Le domaine canonique (`kernel.domain` = 127.0.0.1) est TOUJOURS accepté ; en
  // `development` le loopback (localhost/127/::1) est ajouté auto, mais PAS en prod.
  // On liste donc localhost + 127.0.0.1 pour pouvoir taper le serveur en prod/cluster
  // local via les deux noms. NB : `domainAlias` (niveau kernel, config.ts) est LEGACY
  // et n'est plus consommé — `trustedHosts` est le champ vivant du matcher domaine.
  trustedHosts: ["localhost", "127.0.0.1"],
  session: {
    // Stockage de session via @nodefony/drizzle (orm-core). Sequelize reste
    // chargé pour les tests multi-ORM, mais n'héberge plus les sessions.
    handler: "drizzle",
  },
  formidable: {
    uploadDir: "./tmp/upload",
  },
};
