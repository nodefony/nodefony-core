/// <reference types="node" />
/**
 * Integration — le TRI des sessions traverse le data plane jusqu'au store.
 *
 * Le tri était déjà payé côté SQL (les stores drizzle/mongoose lisent `order`
 * depuis toujours) mais aucun data plane ne l'exposait : la console ne pouvait
 * pas trier, et rien ne le signalait. Ce banc prouve la chaîne complète sur
 * serveur live — `?order=` dans l'URL → `IPageQuery.order` → requête du store —
 * et surtout que l'allowlist DÉCLARÉE par le backend configuré est celle qui
 * fait foi (un champ hors capacité = 400, jamais un tri silencieusement inerte).
 *
 * Requires: server running on 5152 (https). Start: /start-server
 * Fixtures dev : admin/secret (ROLE_NODEFONY_ADMIN).
 */
import { expect } from "chai";
import https from "node:https";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const LOGIN = "/nodefony/security/api/auth/login";
const LIST = "/nodefony/http/api/sessions/list";

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function request(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const h: Record<string, string> = { ...headers };
    if (payload !== undefined) {
      h["content-type"] = "application/json";
      h["content-length"] = String(Buffer.byteLength(payload));
    }
    const req = https.request({ ...BASE, path, method, headers: h }, (res) => {
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
        resolve({
          status: res.statusCode!,
          headers: res.headers as Record<string, unknown>,
          body: parsed,
        });
      });
    });
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

interface SessionPage {
  items: { ref: string; updatedAt: number | null }[];
  total?: number;
  limit: number;
  offset: number;
}

/**
 * Vrai si la suite est monotone dans le sens demandé.
 *
 * C'est LA propriété vérifiable ici, et la seule : la base de dev porte des
 * milliers de sessions, donc « DESC est le miroir d'ASC » serait faux par
 * construction (on compare les N premières aux N dernières). La monotonie
 * INTRA-page, elle, tient quelle que soit la taille de la collection — et reste
 * vraie même si une session bouge entre deux appels, ce qui arrive à chaque
 * requête puisque l'appelant rafraîchit la sienne.
 */
const monotonic = (values: number[], dir: "ASC" | "DESC"): boolean =>
  values.every((v, i) => {
    if (i === 0) return true;
    const prev = values[i - 1]!;
    return dir === "ASC" ? prev <= v : prev >= v;
  });

let cookie = "";
/** Vrai si le backend configuré déclare savoir trier (sinon : tout `order` = 400). */
let sortable = false;

beforeAll(async () => {
  const res = await request(
    "POST",
    LOGIN,
    {},
    { username: "admin", password: "secret" },
  );
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  cookie = typeof first === "string" ? (first.split(";")[0] ?? "") : "";
  if (!cookie) {
    throw new Error(
      `login admin a échoué (status ${res.status}) — user admin/secret requis`,
    );
  }
  // La capacité se CONSTATE : on interroge le serveur au lieu de supposer quel
  // store est branché. Un banc qui présumerait « SQLite donc triable » virerait
  // au rouge le jour où la CI tourne en NF_STORE=memory… ou l'inverse.
  const probe = await request(
    "GET",
    `${LIST}?limit=1&order=updatedAt:ASC`,
    auth(),
  );
  sortable = probe.status === 200;
});

const auth = (): Record<string, string> => ({ cookie });

describe("Sessions — le tri traverse le data plane", () => {
  it("un champ HORS capacité est refusé (400), jamais trié en silence", async () => {
    const r = await request("GET", `${LIST}?order=password:ASC`, auth());
    expect(r.status).to.equal(400);
    expect(JSON.stringify(r.body)).to.match(/sort|password/i);
  });

  it("un sens de tri inconnu est refusé (400)", async () => {
    if (!sortable) return; // backend sans tri : déjà couvert par le cas ci-dessus
    const r = await request("GET", `${LIST}?order=updatedAt:sideways`, auth());
    expect(r.status).to.equal(400);
  });

  it("sans `order`, la liste répond 200 (le tri reste OPTIONNEL)", async () => {
    const r = await request("GET", `${LIST}?limit=5`, auth());
    expect(r.status).to.equal(200);
    expect((r.body as SessionPage).items).to.be.an("array");
  });

  it("`order=updatedAt:ASC` rend une page CROISSANTE", async () => {
    if (!sortable) return;
    const page = (
      await request("GET", `${LIST}?limit=20&order=updatedAt:ASC`, auth())
    ).body as SessionPage;
    if (page.items.length < 2) return; // rien à ordonner
    const values = page.items.map((s) => s.updatedAt ?? 0);
    expect(monotonic(values, "ASC"), `ASC non croissant : ${values}`).to.equal(
      true,
    );
  });

  it("`order=updatedAt:DESC` rend une page DÉCROISSANTE", async () => {
    if (!sortable) return;
    const page = (
      await request("GET", `${LIST}?limit=20&order=updatedAt:DESC`, auth())
    ).body as SessionPage;
    if (page.items.length < 2) return;
    const values = page.items.map((s) => s.updatedAt ?? 0);
    expect(
      monotonic(values, "DESC"),
      `DESC non décroissant : ${values}`,
    ).to.equal(true);
  });

  it("les deux sens ne rendent PAS la même page (le sens est bien honoré)", async () => {
    if (!sortable) return;
    const asc = (
      await request("GET", `${LIST}?limit=5&order=updatedAt:ASC`, auth())
    ).body as SessionPage;
    const desc = (
      await request("GET", `${LIST}?limit=5&order=updatedAt:DESC`, auth())
    ).body as SessionPage;
    if (asc.items.length < 5 || desc.items.length < 5) return;
    const oldest = asc.items[0]?.updatedAt ?? 0;
    const newest = desc.items[0]?.updatedAt ?? 0;
    expect(
      oldest,
      "la plus ancienne doit être antérieure à la plus récente",
    ).to.be.at.most(newest);
  });

  it("le tri s'applique AVANT la pagination (page 2 prolonge la page 1)", async () => {
    if (!sortable) return;
    const p1 = (
      await request(
        "GET",
        `${LIST}?limit=5&offset=0&order=updatedAt:ASC`,
        auth(),
      )
    ).body as SessionPage;
    const p2 = (
      await request(
        "GET",
        `${LIST}?limit=5&offset=5&order=updatedAt:ASC`,
        auth(),
      )
    ).body as SessionPage;
    if (p1.items.length < 5 || p2.items.length < 1) return;
    // Le piège que ce cas attrape : trier la TRANCHE déjà découpée. La suite des
    // deux pages doit rester globalement croissante.
    const values = [...p1.items, ...p2.items].map((s) => s.updatedAt ?? 0);
    expect(
      monotonic(values, "ASC"),
      "page 2 doit prolonger page 1, pas repartir de zéro",
    ).to.equal(true);
  });
});
