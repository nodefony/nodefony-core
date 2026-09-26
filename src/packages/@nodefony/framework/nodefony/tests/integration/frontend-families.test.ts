/**
 * Chaque front Vite DÉCLARÉ par l'application doit DÉMARRER — pas seulement le
 * serveur qui les porte.
 *
 * Pourquoi ce test existe : une famille Vite qui meurt au démarrage est ISOLÉE
 * (`FrontendService.startDev`, `Promise.allSettled`) — le serveur répond, les
 * autres fronts servent, `/readyz` rend 200, et la seule trace est une ligne
 * ERROR dans le journal. Vécu : `@angular/build` 22.2 a cassé le plugin Vite
 * d'analogjs (« cache.has is not a function ») ; toute la CI est restée verte,
 * « Code généré » compris, parce qu'aucun banc ne demandait si le front Angular
 * servait. On le demande ici, au data plane, sur le serveur de développement.
 */
import https from "node:https";

const HTTPS_BASE = {
  hostname: "127.0.0.1",
  port: 5152,
  rejectUnauthorized: false,
};

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function req(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  payload?: unknown,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data =
      payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    const r = https.request(
      {
        ...HTTPS_BASE,
        method,
        path,
        headers: {
          ...headers,
          ...(data
            ? {
                "content-type": "application/json",
                "content-length": String(data.length),
              }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let body: unknown = raw;
          try {
            body = JSON.parse(raw);
          } catch {
            /* keep raw */
          }
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            body,
          });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

type Bundle = { family: string; state: string };

/** États d'ATTENTE : la famille n'a pas encore rendu de verdict. */
const PENDING = new Set(["idle", "starting", "restarting"]);
/** États qui SERVENT : `compiling` est une famille prête qui recompile. */
const SERVING = new Set(["ready", "compiling"]);

let cookie = "";
beforeAll(async () => {
  const res = await req(
    "POST",
    "/nodefony/security/api/auth/login",
    {},
    { username: "admin", password: "secret-de-dev-42" },
  );
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  cookie = typeof first === "string" ? (first.split(";")[0] ?? "") : "";
  if (!cookie) {
    throw new Error(
      `login admin a échoué (status ${res.status}) — user admin/secret-de-dev-42 requis (module test)`,
    );
  }
});

async function readBundles(): Promise<Bundle[]> {
  const res = await req("GET", "/nodefony/frontend/api/vite", { cookie });
  expect(res.status, "data plane frontend").to.equal(200);
  return (res.body as { bundles?: Bundle[] }).bundles ?? [];
}

describe("Frontends — chaque famille Vite déclarée DÉMARRE", () => {
  it("aucune famille morte au démarrage (ready ou compiling, jamais crashed/errored)", async (ctx) => {
    const info = await req("GET", "/nodefony/kernel/api/info", { cookie });
    const environment = (info.body as { environment?: string }).environment;
    // Vite ne tourne qu'en développement : en production l'UI est servie par
    // le bundle compilé, et la liste est vide PAR CONSTRUCTION. Le saut est
    // énoncé, jamais un vert muet.
    if (environment !== "development") {
      ctx.skip(`Vite ne tourne pas en « ${environment} »`);
      return;
    }
    // Les familles démarrent en parallèle, après `/readyz` : on attend que
    // chacune ait rendu un verdict — sans jamais relâcher ce qu'il doit dire.
    const deadline = Date.now() + 50_000;
    let bundles = await readBundles();
    while (bundles.some((b) => PENDING.has(b.state)) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      bundles = await readBundles();
    }
    expect(
      bundles.length,
      "le serveur de dev déclare des fronts",
    ).to.be.greaterThan(0);
    const dead = bundles
      .filter((b) => !SERVING.has(b.state))
      .map((b) => `${b.family}=${b.state}`);
    expect(
      dead,
      `familles Vite qui ne servent pas — lire le journal du serveur (« failed to start (isolated) »)`,
    ).to.deep.equal([]);
  }, 60_000);
});
