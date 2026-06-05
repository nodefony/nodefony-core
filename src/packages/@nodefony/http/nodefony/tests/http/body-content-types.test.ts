/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";

// Régression — parsing du corps selon le Content-Type, lu par @Body (queryPost).
//
// Bug corrigé : la base `Parser.parse()` ne drainait pas le flux (`await
// ended()`) et `initialize` n'attendait pas `parser.parse()` → pour
// urlencoded / xml, le controller lisait `queryPost` AVANT la fin du parse →
// corps vide. JSON marchait (drain + await déjà présents). Couvre les trois.

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

function post(
  path: string,
  contentType: string,
  payload: string,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        ...BASE,
        path,
        method: "POST",
        headers: {
          "content-type": contentType,
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
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
          resolve({ status: res.statusCode!, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

const BODY = "/nodefony/test/decorators/body";
const FIELD = "/nodefony/test/decorators/body-field";

describe("Body parsing par Content-Type — @Body / queryPost (requires server)", () => {
  it("application/json — @Body() reçoit l'objet complet", async () => {
    const res = await post(
      BODY,
      "application/json",
      JSON.stringify({ name: "nodefony", a: 1 }),
    );
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ name: "nodefony", a: 1 });
  });

  it("application/x-www-form-urlencoded — @Body() reçoit les champs (strings)", async () => {
    const res = await post(
      BODY,
      "application/x-www-form-urlencoded",
      "name=nodefony&a=1",
    );
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ name: "nodefony", a: "1" });
  });

  it("application/x-www-form-urlencoded — @Body('name') extrait le champ", async () => {
    const res = await post(
      FIELD,
      "application/x-www-form-urlencoded",
      "name=nodefony",
    );
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ name: "nodefony" });
  });

  it("application/xml — @Body() reçoit l'arbre parsé (xml2js)", async () => {
    const res = await post(
      BODY,
      "application/xml",
      "<data><name>nodefony</name></data>",
    );
    expect(res.status).to.equal(200);
    // xml2js : éléments en tableaux. Le corps n'est PAS vide (bug = {} avant fix).
    expect(res.body).to.have.property("data");
    expect(res.body.data.name[0]).to.equal("nodefony");
  });
});
