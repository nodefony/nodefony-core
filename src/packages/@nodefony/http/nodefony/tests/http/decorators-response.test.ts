/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";

// P4.2 — response decorators (@HttpCode / @Header / @Redirect) combined with
// param decorators (@Param / @Body / @Query) through the REAL HTTP pipeline.
//
// Unit tests cover the metadata storage in isolation; this asserts the wire
// effect (forced status code + custom headers + Location) AND the parameter
// injection both happen together in a single request.

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers: Record<string, string | number> = {};
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }
    const req = https.request({ ...BASE, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
        resolve({
          status: res.statusCode!,
          headers: res.headers,
          body: parsed,
        });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe("Decorators réponse × param combinés — P4.2 (requires server)", () => {
  it("@HttpCode + @Header + @Param + @Body + @Query — status + headers + injection", async () => {
    const res = await request(
      "POST",
      "/nodefony/test/decorators/combined/42?v=3",
      { name: "foo" },
    );
    // @HttpCode(201) prime malgré renderJson sans status.
    expect(res.status).to.equal(201);
    // Les deux @Header sont posés sur le wire.
    expect(res.headers["x-combined"]).to.equal("yes");
    expect(res.headers["x-source"]).to.equal("decorator");
    // Les trois sources de paramètres sont injectées dans la même action.
    expect(res.body).to.deep.equal({ id: "42", name: "foo", v: "3" });
  });

  it("@Redirect + @Param — le param construit la cible, status de @Redirect", async () => {
    const res = await request(
      "GET",
      "/nodefony/test/decorators/redirect/index",
    );
    expect(res.status).to.equal(301);
    expect(res.headers["location"]).to.equal("/nodefony/test/index");
  });
});
