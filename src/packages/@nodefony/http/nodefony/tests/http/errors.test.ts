/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";
import { IS_PROD_TARGET } from "../helpers/targetEnv";

// Tests for JSON error response format in development mode

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

type ErrorBody = {
  code: number;
  message: string;
  result: null;
  error: {
    code: number;
    message: string;
    name: string;
    errorType: string;
    stack: string;
    url: string;
  };
  nodefony: {
    environment: string;
    url: string;
    scheme: string;
    route?: Record<string, unknown>;
  };
};

function get(
  path: string,
): Promise<{ status: number; ct: string; body: unknown }> {
  return new Promise((resolve, reject) => {
    const r = https.request(
      { ...BASE, path, method: "GET" },
      (res: import("node:http").IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let body: unknown;
          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
          }
          resolve({
            status: res.statusCode!,
            ct: (res.headers["content-type"] as string) ?? "",
            body,
          });
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

function asError(body: unknown): ErrorBody {
  return body as ErrorBody;
}

// Le corps d'erreur JSON, dans LES DEUX modes : la forme (code/message/error/
// nodefony) est commune, ce qui la remplit ne l'est pas — le développement montre
// les entrailles, la production les retient. Les cas propres à un mode le disent
// par `skipIf`/`runIf`, jamais par une absence.
describe("Error response format — corps JSON d'erreur (requires server)", function () {
  // ── Structure JSON ────────────────────────────────────────────────

  describe("Top-level structure", () => {
    it("error response is application/json", async () => {
      const { ct } = await get("/nodefony/test/crash/sync");
      expect(ct).to.include("application/json");
    });

    it("error body has top-level: code, message, result, error, nodefony", async () => {
      const { body } = await get("/nodefony/test/crash/sync");
      const b = asError(body);
      expect(b).to.have.property("code");
      expect(b).to.have.property("message");
      expect(b).to.have.property("result");
      expect(b).to.have.property("error");
      expect(b).to.have.property("nodefony");
    });

    it("error.result is null", async () => {
      const { body } = await get("/nodefony/test/crash/sync");
      expect(asError(body).result).to.be.null;
    });

    it("nodefony.environment is a valid environment", async () => {
      // Env-agnostic : le serveur de test tourne en `development` en local mais en
      // `production --no-daemon` en CI (cible cloud-native, sans PM2). On valide
      // que le champ existe et reporte un env valide — pas une valeur figée.
      const { body } = await get("/nodefony/test/crash/sync");
      expect(asError(body).nodefony.environment).to.be.oneOf([
        "development",
        "production",
        "production-debug",
      ]);
    });

    it("nodefony.scheme matches the transport scheme", async () => {
      const { body } = await get("/nodefony/test/crash/sync");
      expect(asError(body).nodefony.scheme).to.equal("https");
    });
  });

  // ── error sub-object ──────────────────────────────────────────────

  describe("error sub-object fields", () => {
    it("error.name is 'HttpError'", async () => {
      const { body } = await get("/nodefony/test/crash/sync");
      expect(asError(body).error.name).to.equal("HttpError");
    });

    it("error.code matches HTTP status", async () => {
      const { status, body } = await get("/nodefony/test/crash/sync");
      expect(asError(body).error.code).to.equal(status);
    });

    it("error.message is a non-empty string", async () => {
      const { body } = await get("/nodefony/test/crash/sync");
      expect(asError(body).error.message)
        .to.be.a("string")
        .with.length.greaterThan(0);
    });

    it.skipIf(IS_PROD_TARGET)(
      "error.stack is present in development",
      async () => {
        const { body } = await get("/nodefony/test/crash/sync");
        const stack = asError(body).error.stack;
        expect(stack).to.be.a("string").with.length.greaterThan(0);
        expect(stack).to.include("Error");
      },
    );

    it.skipIf(IS_PROD_TARGET)("error.url matches request URL", async () => {
      const { body } = await get("/nodefony/test/crash/sync");
      const url = asError(body).error.url;
      expect(url).to.include("/nodefony/test/crash/sync");
    });

    // La CONTREPARTIE des deux cas ci-dessus, et pas leur absence : ce que le
    // développement expose est précisément ce que la production doit taire. Un
    // `skipIf` seul aurait rendu ces lignes muettes dans le mode où la fuite est
    // grave — le mode livré. Le banc couvre donc les SIX clés retirées par
    // `error-renderer.ts` (`INTERNAL_ERROR_KEYS`), pas seulement les deux que le
    // versant développement regarde, et le message opaque des 5xx avec elles.
    it.runIf(IS_PROD_TARGET)(
      "production : aucune entraille ne franchit la frontière (stack/url/controller/action/bundle/pdu)",
      async () => {
        const { body } = await get("/nodefony/test/crash/sync");
        const error = asError(body).error as unknown as Record<string, unknown>;
        for (const key of [
          "stack",
          "controller",
          "action",
          "bundle",
          "url",
          "pdu",
        ]) {
          expect(
            error,
            `error.${key} ne doit pas sortir en production`,
          ).to.not.have.property(key);
        }
        // Le message d'une panne 5xx devient opaque (le détail reste au journal).
        expect(asError(body).message).to.equal("Internal Server Error");
        expect(error.message).to.equal("Internal Server Error");
      },
    );

    it("error.errorType is populated", async () => {
      const { body } = await get("/nodefony/test/crash/sync");
      expect(asError(body).error.errorType)
        .to.be.a("string")
        .with.length.greaterThan(0);
    });
  });

  // ── Status codes ──────────────────────────────────────────────────

  describe("Status codes", () => {
    it("nodefonyError with code 502 → HTTP 502", async () => {
      const { status, body } = await get("/nodefony/test/index2");
      expect(status).to.equal(502);
      expect(asError(body).code).to.equal(502);
    });

    it("HttpError with code 503 → HTTP 503", async () => {
      const { status, body } = await get("/nodefony/test/index3");
      expect(status).to.equal(503);
      expect(asError(body).code).to.equal(503);
    });

    it("sync throw TypeError → HTTP 500", async () => {
      const { status } = await get("/nodefony/test/crash/native");
      expect(status).to.equal(500);
    });

    it("async throw → HTTP 500", async () => {
      const { status } = await get("/nodefony/test/crash/async");
      expect(status).to.equal(500);
    });

    it("unknown route → HTTP 404, error.message is 'Not Found'", async () => {
      const { status, body } = await get("/no-such-route-xyz");
      expect(status).to.equal(404);
      expect(asError(body).error.message).to.equal("Not Found");
    });
  });

  // ── nodefony.route context ────────────────────────────────────────

  describe("nodefony.route context", () => {
    it("crash route error includes route name", async () => {
      const { body } = await get("/nodefony/test/crash/sync");
      const route = asError(body).nodefony.route;
      expect(route).to.be.an("object");
      expect(route!["name"]).to.equal("crash-sync");
    });

    it("crash route error includes route path", async () => {
      const { body } = await get("/nodefony/test/crash/sync");
      const route = asError(body).nodefony.route;
      expect(route!["path"]).to.equal("/nodefony/test/crash/sync");
    });
  });
});
