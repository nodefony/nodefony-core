/*
 *   Ce que le client OAuth met RÉELLEMENT sur le fil.
 *
 *   🔴 Tous les autres bancs de ce client INJECTENT `fetch` — c'est le bon
 *   choix pour éprouver sa logique sans réseau, et c'est aussi leur angle mort :
 *   rien n'y traverse un socket. Un corps mal encodé, un en-tête que le serveur
 *   n'accepte pas, une redirection refusée du mauvais côté — aucun de ces
 *   défauts ne se voit quand c'est le test qui joue le transport, puisque le
 *   test reçoit exactement ce que le test a envoyé.
 *
 *   Ce banc monte un point de jeton en `node:http` sur la boucle locale et
 *   laisse le VRAI `fetch` faire le voyage. Aucun réseau ne sort de la machine,
 *   aucun serveur d'autorisation tiers n'est requis : ce qui est éprouvé, c'est
 *   la couche entre `OAuth2Client` et le socket.
 *
 *   Ce qu'il ne prouve PAS, et qu'il faut aller chercher ailleurs : qu'un vrai
 *   serveur d'autorisation accepte ces requêtes. C'est #269.
 */

import { describe, it, beforeAll, afterAll } from "vitest";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { OAuth2Client } from "../../nodefony/src/oauth/oauth2Client";

/** Ce que le point de jeton a REÇU — relevé pour être confronté après coup. */
interface IRecu {
  method: string;
  contentType: string | undefined;
  accept: string | undefined;
  authorization: string | undefined;
  body: string;
}

/** Comment le faux point de jeton doit répondre à la requête suivante. */
type Reponse =
  { kind: "tokens" } | { kind: "refus" } | { kind: "redirect"; to: string };

describe("OAuth2Client — ce qui part vraiment sur le socket", () => {
  let serveur: Server;
  let port = 0;
  let recu: IRecu | null = null;
  let prochaine: Reponse = { kind: "tokens" };

  beforeAll(async () => {
    serveur = createServer((req, res) => {
      const morceaux: Buffer[] = [];
      req.on("data", (c: Buffer) => morceaux.push(c));
      req.on("end", () => {
        recu = {
          method: req.method ?? "",
          contentType: req.headers["content-type"],
          accept: req.headers.accept,
          authorization: req.headers.authorization,
          body: Buffer.concat(morceaux).toString("utf8"),
        };
        if (prochaine.kind === "redirect") {
          const vers = prochaine.to;
          // La cible RÉPOND : sans cela, `fetch` rejetterait de toute façon
          // (hôte injoignable) et le test passerait sans rien discriminer —
          // il faut que suivre la redirection MÈNE À UN SUCCÈS pour que le
          // refus soit la seule explication possible du rejet.
          prochaine = { kind: "tokens" };
          res.writeHead(302, { Location: vers });
          res.end();
          return;
        }
        const corps =
          prochaine.kind === "tokens"
            ? {
                access_token: "at-reel",
                token_type: "Bearer",
                expires_in: 3600,
              }
            : {
                error: "invalid_grant",
                error_description: "code déjà utilisé",
              };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(corps));
      });
    });
    await new Promise<void>((resolve) =>
      serveur.listen(0, "127.0.0.1", () => resolve()),
    );
    port = (serveur.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => serveur.close(() => resolve()));
  });

  /** Un client qui vise le point de jeton local — SANS `fetch` injecté. */
  const client = (overrides: Record<string, unknown> = {}): OAuth2Client =>
    new OAuth2Client({
      authorizationEndpoint: `http://127.0.0.1:${port}/authorize`,
      tokenEndpoint: `http://127.0.0.1:${port}/token`,
      clientId: "client id",
      // Deux caractères qui cassent un encodage naïf : `:` sépare les moitiés du
      // Basic, `+` devient une espace en `x-www-form-urlencoded`.
      clientSecret: "s3cr3t:+/",
      clientAuthMethod: "client_secret_basic",
      redirectUri: "https://app.test/callback",
      ...overrides,
    } as ConstructorParameters<typeof OAuth2Client>[0]);

  it("🔴 l'échange aboutit pour de vrai — POST, corps encodé, jetons relus", async () => {
    prochaine = { kind: "tokens" };
    const tokens = await client().validateAuthorizationCode({
      code: "the-code",
      codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      additionalParameters: { resource: "https://api.test/mcp" },
    });
    assert.equal(tokens.accessToken(), "at-reel");
    assert.equal(tokens.tokenType(), "Bearer");

    assert.ok(recu, "le serveur n'a rien reçu");
    assert.equal(recu.method, "POST");
    assert.match(recu.contentType ?? "", /application\/x-www-form-urlencoded/u);
    // GitHub rend du form-urlencoded tant qu'on ne réclame pas du JSON.
    assert.match(recu.accept ?? "", /application\/json/u);

    const corps = new URLSearchParams(recu.body);
    assert.equal(corps.get("grant_type"), "authorization_code");
    assert.equal(corps.get("code"), "the-code");
    assert.equal(corps.get("redirect_uri"), "https://app.test/callback");
    assert.equal(corps.get("resource"), "https://api.test/mcp");
    // Basic employé ⇒ l'identité ne se répète pas dans le corps.
    assert.equal(corps.get("client_id"), null);
  });

  it("🔴 le Basic reçu se DÉCODE en l'identité exacte, secret tordu compris", async () => {
    // Le percent-encodage de chaque moitié AVANT le base64 (RFC 6749 §2.3.1 et
    // son annexe B) ne se vérifie vraiment qu'ici : un test qui relit sa propre
    // chaîne ne dit pas si un serveur saurait la lire.
    prochaine = { kind: "tokens" };
    await client().validateAuthorizationCode({ code: "c", codeVerifier: null });

    const entete = recu?.authorization ?? "";
    assert.match(entete, /^Basic /u);
    const brut = Buffer.from(entete.slice("Basic ".length), "base64").toString(
      "utf8",
    );
    const [id, secret] = brut.split(":", 2);
    // Ce que fait un serveur conforme : séparer sur `:`, puis décoder chaque
    // moitié comme du `x-www-form-urlencoded`.
    const decode = (v: string): string =>
      decodeURIComponent(v.replace(/\+/gu, " "));
    assert.equal(decode(id ?? ""), "client id");
    assert.equal(decode(secret ?? ""), "s3cr3t:+/");
  });

  it("🔴 `client_secret_post` : le serveur reçoit l'identité dans le CORPS, sans Basic", async () => {
    prochaine = { kind: "tokens" };
    await client({
      clientAuthMethod: "client_secret_post",
    }).validateAuthorizationCode({ code: "c", codeVerifier: null });

    assert.equal(recu?.authorization, undefined);
    const corps = new URLSearchParams(recu?.body ?? "");
    assert.equal(corps.get("client_id"), "client id");
    assert.equal(corps.get("client_secret"), "s3cr3t:+/");
  });

  it("🔴 une REDIRECTION du point de jeton est refusée, pas suivie", async () => {
    // Un POST redirigé est rejoué en GET sans son corps, et l'en-tête
    // `Authorization` porte le secret client : le suivre l'enverrait ailleurs.
    // `redirect: "error"` est posé pour ça, et rien ne l'avait jamais éprouvé —
    // un `fetch` injecté ne redirige pas.
    prochaine = { kind: "redirect", to: `http://127.0.0.1:${port}/token` };
    await assert.rejects(
      () =>
        client().validateAuthorizationCode({ code: "c", codeVerifier: null }),
      "suivre la redirection aurait rendu des jetons : le refus est la seule " +
        "explication possible de ce rejet",
    );
  });

  it("un refus du serveur reste un refus NOMMÉ, à travers le socket", async () => {
    prochaine = { kind: "refus" };
    await assert.rejects(
      () =>
        client().validateAuthorizationCode({ code: "c", codeVerifier: null }),
      (e: Error & { code?: string }) => {
        assert.equal(e.code, "invalid_grant");
        assert.match(e.message, /code déjà utilisé/u);
        return true;
      },
    );
  });
});
