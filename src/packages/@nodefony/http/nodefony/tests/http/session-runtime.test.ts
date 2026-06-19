/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";

// Cycle de vie de session (« plug runtime », chantier session étape 5) exercé via
// le controller dédié `SessionRuntimeController` (/nodefony/test/session-rt).
// Requiert le serveur dev (5151/5152).

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

function request(
  path: string,
  method: string = "GET",
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any; setCookie: string[] }> {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...BASE, path, method, headers }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        const setCookie = (res.headers["set-cookie"] as string[]) ?? [];
        try {
          resolve({
            status: res.statusCode!,
            body: JSON.parse(raw),
            setCookie,
          });
        } catch {
          resolve({ status: res.statusCode!, body: raw, setCookie });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// TLS (tests sur https/5152) → cookie de session préfixé `__Host-` (RFC 6265bis).
function sessionCookie(setCookie: string[]): string | null {
  const entry = setCookie.find((c) => c.startsWith("__Host-nodefony="));
  return entry ? entry.split(";")[0] : null;
}

function wsHandshake(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://localhost:5152${path}`, {
      rejectUnauthorized: false,
    });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("ws handshake timeout"));
    }, 5000);
    ws.on("message", (data) => {
      clearTimeout(timer);
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        parsed = data.toString();
      }
      ws.close();
      resolve(parsed);
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

describe("Session runtime — plug (HTTP) [requires server]", () => {
  describe("lazy activation", () => {
    it("route SANS intent → aucune session, aucun Set-Cookie", async () => {
      const { status, body, setCookie } = await request(
        "/nodefony/test/session-rt/lazy",
      );
      expect(status).to.equal(200);
      expect(body.hasSession).to.equal(false);
      expect(sessionCookie(setCookie)).to.equal(null);
    });

    it("@UseSession() → session active + Set-Cookie", async () => {
      const { status, body, setCookie } = await request(
        "/nodefony/test/session-rt/use",
      );
      expect(status).to.equal(200);
      expect(body.hasSession).to.equal(true);
      expect(body.id).to.be.a("string").with.length.greaterThan(20);
      expect(body.status).to.equal("active");
      expect(sessionCookie(setCookie)).to.match(/^__Host-nodefony=/);
    });

    it("@Session() param → intent implicite (session active)", async () => {
      const { body, setCookie } = await request(
        "/nodefony/test/session-rt/param",
      );
      expect(body.hasSession).to.equal(true);
      expect(sessionCookie(setCookie)).to.not.equal(null);
    });
  });

  describe("readOnly", () => {
    it("session readOnly : flag posé, mutation marquée dirty (mais non persistée)", async () => {
      const { body } = await request("/nodefony/test/session-rt/readonly");
      expect(body.readOnly).to.equal(true);
      expect(body.dirty).to.equal(true); // mutation tentée → dirty, mais save() no-op
    });
  });

  describe("cookie (RFC 6265bis / OWASP)", () => {
    it("Set-Cookie de session sur TLS : __Host- + HttpOnly + SameSite=Lax + Secure + Path=/ + sans Domain", async () => {
      const { setCookie } = await request("/nodefony/test/session-rt/use");
      const raw = setCookie.find((c) => c.startsWith("__Host-nodefony=")) ?? "";
      expect(raw, "cookie de session présent").to.not.equal("");
      expect(raw).to.include("HttpOnly");
      expect(raw).to.include("SameSite=Lax");
      expect(raw).to.include("Secure"); // imposé par __Host-
      expect(raw).to.include("Path=/"); // imposé par __Host-
      expect(raw).to.not.match(/Domain=/i); // interdit par __Host-
    });
  });

  describe("L1 — reprise de session existante (cookie)", () => {
    it("set → get → info : même identifiant repris, valeur persistée", async () => {
      // 1) ouvre + récupère le cookie
      const first = await request("/nodefony/test/session-rt/use");
      const cookie = sessionCookie(first.setCookie)!;
      const id1 = first.body.id;
      expect(cookie).to.not.equal(null);
      // 2) écrit un attribut avec le cookie
      const set = await request(
        "/nodefony/test/session-rt/set/foo/bar",
        "GET",
        { cookie },
      );
      expect(set.body.id).to.equal(id1); // L1 : même session reprise
      // 3) relit → valeur persistée + même id
      const get = await request("/nodefony/test/session-rt/get/foo", "GET", {
        cookie,
      });
      expect(get.body.value).to.equal("bar");
      expect(get.body.id).to.equal(id1);
      // 4) /info confirme le même id repris
      const info = await request("/nodefony/test/session-rt/info", "GET", {
        cookie,
      });
      expect(info.body.id).to.equal(id1);
      expect(info.body.cookieName).to.equal("__Host-nodefony");
    });
  });

  describe("flashBag (consommé à la lecture)", () => {
    it("set puis get une fois → valeur, deuxième get → null", async () => {
      const first = await request("/nodefony/test/session-rt/use");
      const cookie = sessionCookie(first.setCookie)!;
      await request("/nodefony/test/session-rt/flash/msg/hello", "GET", {
        cookie,
      });
      const get1 = await request("/nodefony/test/session-rt/flash/msg", "GET", {
        cookie,
      });
      expect(get1.body.value).to.equal("hello");
      const get2 = await request("/nodefony/test/session-rt/flash/msg", "GET", {
        cookie,
      });
      expect(get2.body.value).to.equal(null); // consommé
    });
  });

  describe("regenerateId (anti session-fixation)", () => {
    it("change l'identifiant en conservant la session", async () => {
      const first = await request("/nodefony/test/session-rt/use");
      const cookie = sessionCookie(first.setCookie)!;
      const { body } = await request("/nodefony/test/session-rt/regen", "GET", {
        cookie,
      });
      expect(body.oldId).to.be.a("string");
      expect(body.newId).to.be.a("string");
      expect(body.newId).to.not.equal(body.oldId);
    });
  });

  describe("destroy", () => {
    it("DELETE /destroy supprime la session", async () => {
      const first = await request("/nodefony/test/session-rt/use");
      const cookie = sessionCookie(first.setCookie)!;
      const { status, body } = await request(
        "/nodefony/test/session-rt/destroy",
        "DELETE",
        { cookie },
      );
      expect(status).to.equal(200);
      expect(body.destroyed).to.be.a("string");
    });
  });
});

describe("Session runtime — plug (WebSocket) [requires server]", () => {
  it("WS @UseSession() → session active au handshake", async () => {
    const msg = await wsHandshake("/nodefony/test/session-rt/ws-use");
    expect(msg.handshake).to.equal(true);
    expect(msg.hasSession).to.equal(true);
    expect(msg.id).to.be.a("string");
  });

  it("WS sans intent → aucune session (lazy) même au handshake", async () => {
    const msg = await wsHandshake("/nodefony/test/session-rt/ws-lazy");
    expect(msg.handshake).to.equal(true);
    expect(msg.hasSession).to.equal(false);
  });
});
