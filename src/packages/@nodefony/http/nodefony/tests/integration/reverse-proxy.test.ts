/// <reference types="node" />
/**
 * Integration — le serveur DERRIÈRE de VRAIS reverse-proxy (nginx + haproxy).
 *
 * Ce banc ne re-teste pas le dépouillement `X-Forwarded-For` ni le parsing
 * RFC 7239 : `unit/trustProxy.test.ts` et `unit/forwarded.test.ts` les couvrent
 * bien mieux, exhaustivement et sans décor. Il éprouve les RACCORDS — les quatre
 * endroits où l'on ne peut pas se relire soi-même :
 *
 *  1. ce qu'un vrai proxy POSE correspond-il à ce que le serveur ATTEND ?
 *     (un seul mot de configuration renverse l'entrée : `$proxy_add_x_forwarded_for`
 *     PRÉSERVE la chaîne forgée par le client, `$remote_addr` l'écrase — même
 *     parser, même test unitaire vert, et une usurpation d'adresse au bout) ;
 *  2. le `proto` annoncé décrit-il le scheme du CLIENT, et non le chiffrement du
 *     lien interne ? (haproxy re-chiffre vers le backend : `type` https, tandis
 *     que le client arrive en clair — le serveur doit voir `scheme` http) ;
 *  3. le TLS de bout en bout tient-il, chaîne validée, sans `-k` ?
 *  4. une WebSocket franchit-elle le proxy ? (l'argument central du framework, et
 *     le chemin le plus fragile : un `Upgrade` mal relayé et tout tombe.)
 *
 * Décor : `docker compose --profile proxy up -d`, serveur lancé avec
 * `NF_BIND_ALL=1` (bind 0.0.0.0 + trustProxy), `bash docker/certs/build-haproxy-pem.sh`,
 * `nodefony.com` dans /etc/hosts. Variables → `PROXY_GATE` de `vitest.gates.ts`.
 * Sans elles, la suite se saute — et le rapporteur de gates le DIT.
 */
import { expect } from "chai";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const NGINX = process.env.NF_PROXY_NGINX_URL ?? "";
const HAPROXY = process.env.NF_PROXY_HAPROXY_URL ?? "";
const HAPROXY_TLS = process.env.NF_PROXY_HAPROXY_TLS_URL ?? "";
const HAS_DECOR = Boolean(NGINX && HAPROXY && HAPROXY_TLS);

/** Route de diagnostic du module de banc : rend ce que le serveur a COMPRIS. */
const CONTEXT = "/nodefony/test/context";
/** Route WebSocket du module de banc (handshake seul — l'écho a son propre banc). */
const WS_ROUTE = "/nodefony/test/ws/routes/foo";
const TIMEOUT = 15_000;

/**
 * Autorité de certification du banc, dérivée des certificats du serveur par
 * `docker/certs/build-haproxy-pem.sh`.
 *
 * Chargée pour que le cas TLS valide la chaîne POUR DE BON : accepter n'importe
 * quel certificat (`rejectUnauthorized: false`) rendrait le cas décoratif — il
 * passerait avec un certificat expiré, auto-signé ou émis pour un autre nom,
 * c'est-à-dire dans les trois situations qu'il est censé détecter.
 */
function benchCa(): Buffer {
  // Recherche ASCENDANTE plutôt qu'un compte de `..` : le compte se trompe (il
  // s'est trompé) et, surtout, il se trompe SANS RIEN DIRE — un chemin faux rend
  // un fichier absent, le cas retombe sur le magasin système, et le seul indice
  // est un message de TLS qui accuse le certificat. Un banc qui ne trouve pas
  // son décor doit le dire, pas valider autrement.
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 12; up++) {
    const candidate = path.join(dir, "docker", "certs", "ca.pem");
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "docker/certs/ca.pem introuvable — dériver les certificats du banc : " +
      "`bash docker/certs/build-haproxy-pem.sh` (après un démarrage NF_BIND_ALL=1).",
  );
}

/** Ce que le serveur a compris de la requête, vu par la route de diagnostic. */
type SeenContext = {
  type: string;
  scheme: string;
  host: string;
  remoteAddress: string;
};

/** GET à travers un proxy — `base` porte le protocole, donc l'agent à utiliser. */
function through(
  base: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; seen: SeenContext }> {
  const url = new URL(CONTEXT, base);
  const secure = url.protocol === "https:";
  const ca = secure ? benchCa() : undefined;
  return new Promise((resolve, reject) => {
    const req = (secure ? https : http).request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "GET",
        headers,
        // Chaîne validée (pas de `rejectUnauthorized: false`) : c'est le sujet.
        ...(secure ? { ca, servername: url.hostname } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode!,
              seen: JSON.parse(Buffer.concat(chunks).toString()) as SeenContext,
            });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(TIMEOUT, () => req.destroy(new Error("timeout proxy")));
    req.end();
  });
}

describe.skipIf(!HAS_DECOR)(
  "Derrière un reverse-proxy RÉEL (requires proxy decor)",
  () => {
    it("nginx : l'IP forgée par le client est JETÉE, celle du proxy retenue", async () => {
      // Le client se déclare `6.6.6.6`. nginx, proxy de bordure, ÉCRASE l'en-tête
      // avec la seule adresse qu'il a réellement vue. Le serveur ne doit jamais
      // retenir la valeur forgée — sans quoi toute décision prise sur l'IP
      // (quota, journal, liste d'autorisation) se pilote depuis le client.
      const { status, seen } = await through(NGINX, {
        "X-Forwarded-For": "6.6.6.6",
      });
      expect(status, "réponse à travers nginx").to.equal(200);
      expect(seen.remoteAddress, "IP forgée retenue !").to.not.equal("6.6.6.6");
      expect(seen.remoteAddress, "IP du proxy attendue").to.be.a("string").and
        .not.be.empty;
      // Le proxy force le domaine canonique : le banc éprouve toujours ce vhost.
      expect(seen.host).to.equal("nodefony.com");
    });

    it("haproxy en clair : le lien interne est chiffré, le CLIENT ne l'est pas", async () => {
      // LE cas qui distingue les deux questions qu'on confond : haproxy
      // re-chiffre vers le backend (`type` https côté serveur), et pourtant le
      // client est arrivé en clair — `scheme` DOIT rester http. Annoncer https
      // ici ferait poser des cookies `Secure` sur une connexion en clair et
      // désarmerait toute garde « exiger HTTPS », sans un mot.
      const { status, seen } = await through(HAPROXY);
      expect(status, "réponse à travers haproxy").to.equal(200);
      expect(seen.scheme, "scheme vu du CLIENT").to.equal("http");
      expect(seen.type, "transport du lien interne").to.equal("https");
    });

    it("haproxy en TLS : scheme https de bout en bout, chaîne validée", async () => {
      // Sans `rejectUnauthorized: false` : le certificat présenté au client est
      // validé par la CA du banc, et haproxy valide de son côté celui du backend
      // (`verify required` + `verifyhost` + SNI). Les deux maillons, ou rien.
      const { status, seen } = await through(HAPROXY_TLS);
      expect(status, "réponse TLS de bout en bout").to.equal(200);
      expect(seen.scheme, "scheme vu du CLIENT").to.equal("https");
      expect(seen.host).to.equal("nodefony.com");
    });

    it("une WebSocket franchit le proxy (Upgrade relayé)", async () => {
      // HTTP et WS partagent le même port côté Nodefony : le proxy doit relayer
      // `Upgrade`/`Connection` sans les avaler. C'est le chemin le plus fragile
      // d'un reverse-proxy, et l'argument central du framework.
      const url = new URL(WS_ROUTE, NGINX);
      url.protocol = "ws:";
      const ws = new WebSocket(url.toString());
      const opened = await new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve("timeout"), TIMEOUT);
        ws.on("open", () => {
          clearTimeout(timer);
          resolve("open");
        });
        ws.on("unexpected-response", (_req, res) => {
          clearTimeout(timer);
          resolve(`http ${res.statusCode}`);
        });
        ws.on("error", (e: Error) => {
          clearTimeout(timer);
          resolve(`error ${e.message}`);
        });
      });
      ws.close();
      expect(opened, "handshake WebSocket à travers nginx").to.equal("open");
    });
  },
);
