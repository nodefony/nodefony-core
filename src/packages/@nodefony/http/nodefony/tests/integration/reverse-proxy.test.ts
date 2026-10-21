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
 *     lien interne ? (haproxy re-chiffre vers le backend : `serverType` https, tandis
 *     que le client arrive en clair — le serveur doit voir `scheme` http) ;
 *  3. le TLS de bout en bout tient-il, chaîne validée, sans `-k` ?
 *  4. une WebSocket franchit-elle le proxy ? (l'argument central du framework, et
 *     le chemin le plus fragile : un `Upgrade` mal relayé et tout tombe.)
 *
 * Décor : `docker compose --profile proxy up -d`, serveur lancé avec
 * `NF_BIND_ALL=1` (bind 0.0.0.0 + trustProxy), `bash docker/certs/build-haproxy-pem.sh`,
 * `nodefony.com` dans /etc/hosts. Variables → `PROXY_GATE` de `scripts/test/vitest/gates.ts`.
 * Sans elles, la suite se saute — et le rapporteur de gates le DIT.
 */
import { expect } from "vitest";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import {
  defaultIntrospection,
  generateHaproxyConfig,
  type ProxyIntrospection,
} from "../../src/proxy/generateProxyConfig";
import { asError } from "../helpers/wsText";

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
  serverType: string;
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
            reject(asError(e));
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
      expect(seen.serverType, "TLS du lien interne").to.equal("https");
      expect(seen.type, "protocole de la requête").to.equal("http");
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

/**
 * La configuration HAProxy GÉNÉRÉE, jouée par un vrai HAProxy contre le serveur.
 *
 * Le banc ci-dessus tourne sur un `haproxy.cfg` écrit à la main
 * (`docker/haproxy/`) : il ne dit rien de ce que `proxy:generate` produit. Ici,
 * le générateur écrit la configuration et HAProxy l'exécute. La question posée :
 * le frontal retire-t-il l'exemplaire sur la RÉPONSE de la sonde, ou seulement
 * quand le port se ferme ? Un contrôle TCP garde l'exemplaire tant que le port
 * accepte — c'est-à-dire pendant tout le délai avant drain.
 */
describe.skipIf(!HAS_DECOR)(
  "Integration — HAProxy RÉEL sur la configuration GÉNÉRÉE (sonde /readyz)",
  () => {
    const IMAGE = "haproxy:3.0-alpine";
    const started: string[] = [];
    let dir = "";

    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-haproxy-gen-"));
    });
    afterAll(() => {
      for (const id of started) {
        spawnSync("docker", ["rm", "-f", id], { stdio: "ignore" });
      }
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    });

    /** Lance HAProxy sur la sortie du générateur ; rend l'URL publiée. */
    function runGenerated(
      name: string,
      over: Partial<ProxyIntrospection>,
    ): string {
      const sub = path.join(dir, name);
      fs.mkdirSync(sub);
      const cfg = generateHaproxyConfig({
        ...defaultIntrospection,
        backendHost: "host.docker.internal",
        listen: 8080,
        ...over,
      });
      fs.writeFileSync(path.join(sub, "haproxy.cfg"), cfg);
      const run = spawnSync(
        "docker",
        [
          "run",
          "-d",
          "--rm",
          "--add-host=host.docker.internal:host-gateway",
          "-p",
          "127.0.0.1::8080",
          "-v",
          `${sub}:/usr/local/etc/haproxy:ro`,
          IMAGE,
        ],
        { encoding: "utf8" },
      );
      expect(run.status, `docker run : ${run.stderr}`).to.equal(0);
      const id = run.stdout.trim();
      started.push(id);
      const port = spawnSync("docker", ["port", id, "8080/tcp"], {
        encoding: "utf8",
      })
        .stdout.trim()
        .split(":")
        .pop();
      return `http://127.0.0.1:${port}`;
    }

    /** Statut d'un GET à travers le frontal (0 si la connexion échoue). */
    function statusOf(base: string): Promise<number> {
      return new Promise((resolve) => {
        const req = http.get(new URL(CONTEXT, base), (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        });
        req.on("error", () => resolve(0));
        req.setTimeout(5_000, () => req.destroy());
      });
    }

    /** Relève le statut jusqu'à `want` ou l'échéance ; rend le dernier vu. */
    async function settle(
      base: string,
      want: number,
      ms: number,
    ): Promise<number> {
      const deadline = Date.now() + ms;
      let last = 0;
      while (Date.now() < deadline) {
        last = await statusOf(base);
        if (last === want) return last;
        await new Promise((r) => setTimeout(r, 500));
      }
      return last;
    }

    it("sonde /readyz qui répond 200 → l'exemplaire reste servi au-delà de la fenêtre de chute", async () => {
      const base = runGenerated("ready", {});
      expect(
        await settle(base, 200, 15_000),
        "servi à travers HAProxy",
      ).to.equal(200);
      // `fall 3` × `inter 2s` : un exemplaire jugé malade serait retiré en ~6 s.
      await new Promise((r) => setTimeout(r, 8_000));
      expect(await statusOf(base), "toujours servi après 8 s").to.equal(200);
    }, 40_000);

    it("sonde qui ne répond pas 200 → HAProxy retire l'exemplaire alors que son port ACCEPTE", async () => {
      // Un chemin sans route rend 404 : le port est ouvert, la sonde dit « pas
      // prêt ». C'est exactement l'état d'un exemplaire qui draine. Un contrôle
      // TCP le garderait ; la sonde HTTP le retire → 503 du frontal lui-même.
      const base = runGenerated("not-ready", {
        readinessPath: "/nodefony/test/__pas-de-route-ici__",
      });
      expect(
        await settle(base, 503, 20_000),
        "l'exemplaire doit sortir du répartiteur",
      ).to.equal(503);
    }, 40_000);

    it("h2c : servi en HTTP/2 en clair, et la sonde passe par le port HTTP en HTTP/1.1", async () => {
      // L'application du dépôt active h2c hors production (`nodefony.config.ts`).
      // Le port h2c refuse HTTP/1.1 : une sonde qui y partirait mettrait
      // l'exemplaire DOWN. `check port <http> check-proto h1` l'envoie ailleurs.
      const base = runGenerated("h2c", { h2cPort: 5153 });
      const alpn = async (): Promise<string> =>
        new Promise((resolve) => {
          const req = http.get(new URL(CONTEXT, base), (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => {
              try {
                const seen = JSON.parse(Buffer.concat(chunks).toString()) as {
                  alpnProtocol?: string;
                };
                resolve(`${res.statusCode} ${seen.alpnProtocol ?? "?"}`);
              } catch {
                resolve(`${res.statusCode} illisible`);
              }
            });
          });
          req.on("error", (e: Error) => resolve(`error ${e.message}`));
          req.setTimeout(5_000, () => req.destroy(new Error("timeout")));
        });
      expect(
        await settle(base, 200, 15_000),
        "servi à travers HAProxy",
      ).to.equal(200);
      expect(await alpn(), "le lien HAProxy → Nodefony est en h2c").to.equal(
        "200 h2c",
      );
      // Au-delà de la fenêtre de chute : la sonde a réussi, l'exemplaire reste.
      await new Promise((r) => setTimeout(r, 8_000));
      expect(await alpn(), "toujours servi en h2c après 8 s").to.equal(
        "200 h2c",
      );
    }, 40_000);

    it("les variantes h2c et re-chiffrement passent le contrôle de syntaxe de HAProxy", () => {
      const variants: [string, Partial<ProxyIntrospection>][] = [
        ["h2c", { h2cPort: 5153 }],
        ["reencrypt", { reencrypt: true, domains: ["nodefony.com"] }],
      ];
      for (const [name, over] of variants) {
        const sub = path.join(dir, `check-${name}`);
        fs.mkdirSync(sub);
        fs.writeFileSync(
          path.join(sub, "haproxy.cfg"),
          generateHaproxyConfig({ ...defaultIntrospection, ...over }),
        );
        // Le re-chiffrement lit une autorité au chemin du gabarit : n'importe
        // quel certificat racine valide suffit à un contrôle de syntaxe.
        const certs = path.join(sub, "certs");
        fs.mkdirSync(certs);
        fs.writeFileSync(
          path.join(certs, "ca.pem"),
          tls.rootCertificates[0] ?? "",
        );
        const check = spawnSync(
          "docker",
          [
            "run",
            "--rm",
            "-v",
            `${sub}:/usr/local/etc/haproxy:ro`,
            "-v",
            `${certs}:/etc/haproxy/certs:ro`,
            IMAGE,
            "haproxy",
            "-c",
            "-f",
            "/usr/local/etc/haproxy/haproxy.cfg",
          ],
          { encoding: "utf8" },
        );
        expect(
          check.status,
          `${name} : ${check.stdout}${check.stderr}`,
        ).to.equal(0);
      }
    }, 60_000);
  },
);
