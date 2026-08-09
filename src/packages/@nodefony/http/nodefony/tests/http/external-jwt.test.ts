/// <reference types="node" />
import { expect } from "chai";
import http from "node:http";

/**
 * Zone SERVEUR DE RESSOURCE (P6.9) — banc d'INTÉGRATION RÉEL contre le serveur
 * live (port 5151), zone `test-external` du module test.
 *
 * Ce banc existe pour UNE raison que rien d'autre ne couvre : vérifier ce qu'un
 * client reçoit vraiment sur le fil. La distinction entre « ton jeton est
 * refusé » (401) et « je n'ai pas pu le vérifier » (503) est établie dans le
 * vérificateur, conservée par l'authenticator, puis par le pare-feu — trois
 * frontières où elle peut se perdre en silence, en étant aplatie sur le 401
 * générique du fail-closed. Un test unitaire s'arrête à la première ; seul un
 * vrai pipeline HTTP montre la dernière.
 *
 * Décor : l'émetteur déclaré par le module test est `https://auth.test.invalid`
 * — le domaine `.invalid` est réservé (RFC 2606) et ne se résout nulle part.
 * Aucun IdP à démarrer, aucun réseau, verdict déterministe.
 *
 * ⚠️ Le chemin du SUCCÈS n'est pas exercé ici (il exigerait un serveur
 * d'autorisation en HTTPS) : il l'est en unitaire
 * (`security/tests/unit/externalJwtAuthenticator.test.ts`) et par la chaîne
 * complète avec jeton réellement signé (`protectedResourceChain.test.ts`).
 */

const BASE = { hostname: "localhost", port: 5151 };
const PATH = "/nodefony/test/external/whoami";
const TRUSTED_ISSUER = "https://auth.test.invalid/realms/nodefony";
const RESOURCE = "https://app.test.invalid/nodefony/test/external";

type Res = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

function send(headers: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { ...BASE, method: "GET", path: PATH, headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode!, headers: res.headers, body }),
        );
      },
    );
    r.on("error", reject);
    r.end();
  });
}

/** JWS compact non signé — seul le payload compte, rien ici ne le vérifie. */
function jws(claims: Record<string, unknown>): string {
  const seg = (o: unknown): string =>
    Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  return `${seg({ alg: "ES256", typ: "JWT", kid: "k1" })}.${seg(claims)}.c2ln`;
}

describe("Zone serveur de ressource — jetons émis par un tiers", () => {
  it("sans jeton → 401 avec le défi RFC 7235", async () => {
    const res = await send();
    expect(res.status).to.equal(401);
    expect(String(res.headers["www-authenticate"] ?? "")).to.match(/Bearer/i);
  });

  it("jeton d'un émetteur NON déclaré → 401, sans qu'aucune requête sortante ne parte", async () => {
    // L'aiguillage se fait sur la liste FERMÉE d'émetteurs : un `iss` inconnu
    // est écarté avant toute vérification. La réponse est donc immédiate — et
    // surtout, un anonyme ne peut pas faire émettre de requête vers l'URL de
    // son choix en écrivant simplement un `iss`.
    const started = Date.now();
    const res = await send({
      authorization: `Bearer ${jws({ iss: "https://evil.example", sub: "x", aud: RESOURCE })}`,
    });
    expect(res.status).to.equal(401);
    expect(Date.now() - started).to.be.lessThan(900);
  });

  it("🔴 émetteur DÉCLARÉ mais injoignable → 503, JAMAIS 401", async () => {
    // LE point du banc. Un 401 ici enverrait un client légitime renouveler en
    // boucle un jeton parfaitement bon, et rangerait une panne d'infrastructure
    // dans la statistique des échecs d'authentification.
    const res = await send({
      authorization: `Bearer ${jws({ iss: TRUSTED_ISSUER, sub: "agent-7", aud: RESOURCE })}`,
    });
    expect(res.status).to.equal(503);
  });

  it("le 503 ne porte PAS de défi : le porteur n'a rien à corriger", async () => {
    const res = await send({
      authorization: `Bearer ${jws({ iss: TRUSTED_ISSUER, sub: "agent-7", aud: RESOURCE })}`,
    });
    expect(res.status).to.equal(503);
    expect(res.headers["www-authenticate"]).to.equal(undefined);
  });

  it("aucune cause technique ne fuite au client (émetteur, URL de clés, pile)", async () => {
    const res = await send({
      authorization: `Bearer ${jws({ iss: TRUSTED_ISSUER, sub: "agent-7", aud: RESOURCE })}`,
    });
    expect(res.body).to.not.match(/test\.invalid/);
    expect(res.body).to.not.match(/jwks|ENOTFOUND|getaddrinfo/i);
  });

  it("un bearer opaque (non-JWT) ne réveille pas la zone → 401", async () => {
    const res = await send({ authorization: "Bearer nf_deadbeef_pas_un_jwt" });
    expect(res.status).to.equal(401);
  });
});
