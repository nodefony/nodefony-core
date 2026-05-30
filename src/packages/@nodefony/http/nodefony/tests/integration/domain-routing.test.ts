/// <reference types="node" />
/**
 * @Domain routing — preuve end-to-end (virtual hosting) à travers le VRAI pipeline.
 *
 * `localhost` ET `127.0.0.1` passent tous deux la barrière `trustedHosts` (loopback
 * dev) → ils servent de deux vhosts distincts SANS toucher la config. On vérifie :
 *  - virtual hosting : MÊME path, vhost ≠ → route ≠ (fallthrough Router) ;
 *  - @Domain méthode : route restreinte → 403 (le serveur sert le domaine, la route le refuse) ;
 *  - @Domain classe : tout le contrôleur restreint → 403 sur Host non autorisé.
 *
 * Live server: 5152 (HTTPS/HTTP2). On force le vhost via le `hostname` de connexion
 * (loopback) → Node pose `Host: <hostname>:5152` → `context.domain` = <hostname>.
 */
import { expect } from "chai";
import https from "node:https";
import "mocha";

function get(
  host: "localhost" | "127.0.0.1",
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const r = https.request(
      {
        hostname: host,
        port: 5152,
        method: "GET",
        path,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          let body: Record<string, unknown> = {};
          try {
            body = raw ? JSON.parse(raw) : {};
          } catch {
            body = { raw };
          }
          resolve({ status: res.statusCode!, body });
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

const DOMAIN = "/nodefony/test/domain";

describe("@Domain routing — virtual hosting end-to-end", () => {
  describe("virtual hosting : même path, vhost différent (fallthrough Router)", () => {
    it("Host localhost → route @Domain(localhost)", async () => {
      const { status, body } = await get("localhost", `${DOMAIN}/vhost`);
      expect(status).to.equal(200);
      expect(body.vhost).to.equal("localhost");
      expect(body.route).to.equal("vhostLocalhost");
    });

    it("Host 127.0.0.1 → route @Domain(127.0.0.1) — le Router a fait fallthrough", async () => {
      const { status, body } = await get("127.0.0.1", `${DOMAIN}/vhost`);
      expect(status).to.equal(200);
      expect(body.vhost).to.equal("127.0.0.1");
      expect(body.route).to.equal("vhost127");
    });
  });

  describe("@Domain méthode : route restreinte → 403 (pas 401)", () => {
    it("Host localhost → 200", async () => {
      const { status } = await get("localhost", `${DOMAIN}/only-localhost`);
      expect(status).to.equal(200);
    });

    it("Host 127.0.0.1 → 403 (serveur sert le domaine, route le refuse)", async () => {
      const { status } = await get("127.0.0.1", `${DOMAIN}/only-localhost`);
      expect(status).to.equal(403);
    });
  });

  describe("@Domain classe : tout le contrôleur restreint à localhost", () => {
    it("Host localhost → 200 sur /info ET /other", async () => {
      expect(
        (await get("localhost", "/nodefony/test/domain-class/info")).status,
      ).to.equal(200);
      expect(
        (await get("localhost", "/nodefony/test/domain-class/other")).status,
      ).to.equal(200);
    });

    it("Host 127.0.0.1 → 403 sur /info ET /other (restriction de classe)", async () => {
      expect(
        (await get("127.0.0.1", "/nodefony/test/domain-class/info")).status,
      ).to.equal(403);
      expect(
        (await get("127.0.0.1", "/nodefony/test/domain-class/other")).status,
      ).to.equal(403);
    });
  });
});
