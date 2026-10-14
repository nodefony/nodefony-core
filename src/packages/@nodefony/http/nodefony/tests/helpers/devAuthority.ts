/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { addDefaultCaCertificate } from "../../service/certificates";

/**
 * Autorité qui a signé le certificat du serveur de banc : le service de
 * certificats y écrit sa racine auto-signée OU recopie celle de mkcert
 * (`certificates.ts`, `caPath`) — le même fichier dans les deux stratégies.
 */
export const DEV_CA_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../..",
  "nodefony",
  "config",
  "certificates",
  "ca",
  "nodefony-root-ca.crt.pem",
);

/**
 * L'autorité de développement, en PEM — pour une option `ca:` locale à une
 * connexion, sans toucher aux ancres du processus.
 *
 * @throws si le fichier manque (serveur jamais démarré)
 */
export function devAuthorityPem(): string {
  if (!fs.existsSync(DEV_CA_FILE))
    throw new Error(
      `autorité de développement absente : ${DEV_CA_FILE} — démarrer le serveur (start.sh) la génère`,
    );
  return fs.readFileSync(DEV_CA_FILE, "utf8");
}

/**
 * Fait confiance à l'autorité de développement pour TOUT client TLS du
 * processus — `fetch`, `https`, `ws` — comme le navigateur à qui `mkcert` ou
 * l'installation l'a confiée. La chaîne est alors VALIDÉE (nom compris), au lieu
 * d'être ignorée par `rejectUnauthorized: false`.
 *
 * @returns la fonction qui rend les ancres d'avant
 * @throws si le fichier manque (serveur jamais démarré) ou si ce Node ne sait
 *   pas changer ses ancres à chaud (`tls.setDefaultCACertificates`, Node 24.5)
 */
export function trustDevAuthority(): () => void {
  const pem = devAuthorityPem();
  const before = tls.getCACertificates("default");
  const verdict = addDefaultCaCertificate(pem);
  if (verdict === "unsupported")
    throw new Error(
      "ce Node ne sait pas ajouter une autorité à chaud (tls.setDefaultCACertificates)",
    );
  return () => tls.setDefaultCACertificates(before);
}
