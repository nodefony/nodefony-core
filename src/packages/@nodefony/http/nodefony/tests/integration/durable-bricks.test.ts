/// <reference types="node" />
/**
 * Integration — les briques durables **qu'aucune route du framework n'atteint**.
 * Requires: server running on 5152 (https). Start: /start-server
 *
 * 🔴 CE QUE CE FICHIER GARDE. Une passe d'intégration complète laissait
 * `totp_secrets`, `webauthn_credentials` et `webhook_endpoints` à **zéro
 * ligne** — et ce n'était pas un défaut des adaptateurs : le data plane
 * n'expose, pour le 2FA, que des LECTURES. La brique était complète, éprouvée
 * par ses propres bancs, et injoignable par HTTP. La conclusion « ce backend
 * porte huit briques » ne reposait donc que sur cinq.
 *
 * ⚠️ Ce n'est pas propre à MongoDB : la passe par défaut (Drizzle) ne les
 * écrivait pas davantage. Ce fichier tourne sous LES DEUX — c'est le même
 * serveur, avec une base différente.
 *
 * Ce que ces cas prouvent, et qu'un code HTTP ne prouve pas : la donnée est
 * ÉCRITE puis RELUE par le store sélectionné au boot. Vécu pendant l'écriture
 * de la sonde : un contrat de service écrit de mémoire rendait un corps VIDE
 * sous un `200` parfaitement vert. On assert donc le contenu, jamais le statut
 * seul.
 *
 * Routes (module test, `policy: "dev"` — inexistantes en production) :
 *   POST /nodefony/test/durable/totp     — enrôlement 2FA complet
 *   POST /nodefony/test/durable/webhook  — enregistrement d'un endpoint
 */
import { expect } from "chai";
import https from "node:https";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const TOTP = "/nodefony/test/durable/totp";
const WEBHOOK = "/nodefony/test/durable/webhook";
const TIMEOUT = 15_000;

type Res = { status: number; body: unknown };

function post(path: string, body: unknown): Promise<Res> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        ...BASE,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(payload)),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let parsed: unknown = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {
            /* texte brut / vide */
          }
          resolve({ status: res.statusCode!, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(TIMEOUT, () => req.destroy(new Error("http timeout")));
    req.write(payload);
    req.end();
  });
}

describe("briques durables — celles qu'aucune route n'atteignait", () => {
  it("2FA : un enrôlement complet ÉCRIT le secret, et la relecture le confirme", async () => {
    const userId = `probe-totp-${Date.now()}`;
    const res = await post(TOTP, { userId });
    if (res.status === 503) {
      // Refus ANNONCÉ, pas un silence : le 2FA peut être coupé par config.
      // On ne transforme pas cette absence en vert muet.
      expect.fail(
        "le 2FA est désactivé sur ce serveur — la brique ne peut pas être exercée",
      );
    }
    expect(res.status).to.equal(200);
    const body = res.body as {
      userId?: string;
      activated?: boolean;
      recoveryCodes?: number;
      enabled?: boolean;
    };
    expect(body.userId, JSON.stringify(res.body)).to.equal(userId);
    expect(body.activated).to.equal(true);
    // Les codes de récupération ne sont rendus qu'une fois : leur nombre dit
    // que l'activation est allée jusqu'au bout, pas seulement que l'appel a
    // répondu.
    expect(body.recoveryCodes).to.be.greaterThan(0);
    // 🔴 L'assertion qui compte : l'état est RELU depuis le store après
    // écriture. Sans elle, une fabrique qui répond sans persister passerait.
    expect(body.enabled, "secret non relu après écriture").to.equal(true);
  });

  it("webhooks : un endpoint enregistré rend son identifiant et son URL", async () => {
    const res = await post(WEBHOOK, {});
    expect(res.status).to.equal(200);
    const body = res.body as { id?: string; url?: string };
    // Le corps VIDE sous 200 est le mode d'échec réellement rencontré : un
    // contrat de service écrit de mémoire. C'est lui qu'on ferme ici.
    expect(
      body.id,
      `corps vide sous 200 : ${JSON.stringify(res.body)}`,
    ).to.be.a("string");
    expect(body.id).to.have.length.greaterThan(0);
    expect(body.url).to.contain("/nodefony/test/webhooks/sink");
  });

  it("2FA : deux enrôlements distincts ne se marchent pas dessus", async () => {
    // Témoin d'isolation : un store qui écraserait tout sur une même clé
    // rendrait le cas précédent vert en n'ayant jamais qu'une seule ligne.
    const a = `probe-totp-a-${Date.now()}`;
    const b = `probe-totp-b-${Date.now()}`;
    const [ra, rb] = await Promise.all([
      post(TOTP, { userId: a }),
      post(TOTP, { userId: b }),
    ]);
    expect(ra.status).to.equal(200);
    expect(rb.status).to.equal(200);
    expect((ra.body as { enabled?: boolean }).enabled).to.equal(true);
    expect((rb.body as { enabled?: boolean }).enabled).to.equal(true);
    expect((ra.body as { userId?: string }).userId).to.not.equal(
      (rb.body as { userId?: string }).userId,
    );
  });
});
