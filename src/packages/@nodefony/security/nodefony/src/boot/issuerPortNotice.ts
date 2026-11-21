import { isLoopbackHostname } from "nodefony";
import type { IBootNotice } from "nodefony";

/** Code stable du point d'attention — c'est lui qu'un agent compare. */
export const ISSUER_PORT_NOT_SERVED = "JWT_ISSUER_PORT_NOT_SERVED";

/**
 * Les ports où le noyau HTTP écoute réellement, lus sur ce qu'il déclare
 * (`httpPort`, `httpsPort` : le port LIÉ, glissement compris), jamais sur sa
 * configuration. `security` ne dépend pas de `@nodefony/http` à l'exécution :
 * le noyau arrive du conteneur, sans type, et se lit par ses seuls champs.
 *
 * @param httpKernel - le service `HttpKernel` du conteneur, ou `undefined`
 * @returns les ports servis, vide sans noyau HTTP
 */
export function servedPortsOf(httpKernel: unknown): number[] {
  const ports: number[] = [];
  if (typeof httpKernel !== "object" || httpKernel === null) return ports;
  if ("httpPort" in httpKernel && typeof httpKernel.httpPort === "number") {
    ports.push(httpKernel.httpPort);
  }
  if ("httpsPort" in httpKernel && typeof httpKernel.httpsPort === "number") {
    ports.push(httpKernel.httpsPort);
  }
  return ports;
}

/**
 * Le point d'attention « l'émetteur des jetons nomme un port que l'application
 * ne sert pas » du bilan de démarrage.
 *
 * En développement, l'émetteur par défaut se calcule sur le port CONFIGURÉ
 * (`https://localhost:${NF_PORT_HTTPS ?? 5152}`). Quand ce port est déjà pris
 * — une seconde application tourne sur le poste —, le serveur glisse sur le
 * suivant, mais ses jetons, ses ressources protégées et ses documents de
 * découverte (RFC 8414, RFC 9728) continuent de nommer l'ancien : un agent MCP
 * ne trouve plus où demander son jeton, et `.mcp.json` vise le serveur du
 * voisin. Le glissement était signalé ; ce qu'il CASSE ne l'était pas.
 *
 * Le remède est de figer les ports, pas de faire suivre l'émetteur : il est
 * gravé dans chaque jeton, et une commande qui en signe un (process séparé,
 * sans écoute) calcule le même à partir de la même config.
 *
 * Seul un émetteur de la BOUCLE LOCALE est jugé : une adresse publique est
 * celle d'un relais, dont le port n'a aucune raison d'être celui du processus.
 *
 * @param issuer - l'émetteur des jetons (`jwt.issuer`)
 * @param served - les ports où l'application écoute réellement
 * @returns le point à déclarer, ou `null` si l'émetteur concorde, n'est pas
 *   une URL, ne nomme pas la boucle locale, ou si rien n'écoute
 */
export function issuerPortNotice(
  issuer: string,
  served: readonly number[],
): IBootNotice | null {
  if (served.length === 0) return null;
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!isLoopbackHostname(url.hostname)) return null;
  const port =
    url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  if (served.includes(port)) return null;
  return {
    code: ISSUER_PORT_NOT_SERVED,
    level: "warning",
    message:
      `L'émetteur des jetons (${url.origin}) nomme le port ${port}, que cette ` +
      `application ne sert pas — elle écoute sur ${served.join(", ")}, un port ` +
      `déjà pris l'a fait glisser : ses jetons, sa découverte OAuth et la porte ` +
      `MCP visent un autre serveur`,
    fix: "figer les ports de cette application (nodefony.config.ts → servers.https.port), ou poser NF_JWT_ISSUER",
  };
}
