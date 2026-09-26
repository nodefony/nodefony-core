import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";
import {
  snapshotUploadDirs,
  purgeUploadResidue,
  type UploadSnapshot,
} from "../helpers/uploadResidue.js";
import { drainTo } from "../helpers/scopeDrain.js";
import { type IRetentionPlan } from "../helpers/heapSlope.js";
import {
  THRESHOLDS,
  retention,
  serverHeap,
  setSyslogRing,
} from "../helpers/retention.js";

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };
const WSS = "wss://localhost:5152";
const wsOpts = { rejectUnauthorized: false };

// Le test « 200 multipart uploads » dépose des `<uuid>.txt` dans le dossier
// d'upload du serveur. Le garde (dossiers visés + compte supprimé) vit dans
// `helpers/uploadResidue.ts` — une seule implémentation, cf upload.test.ts.

type MemStats = {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
};

function get(path: string): Promise<MemStats | Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...BASE, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch {
          resolve({});
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function liveScopes(): Promise<number> {
  const r = (await get("/nodefony/test/als-test/scopes")) as Record<
    string,
    unknown
  >;
  return r.requestScopes as number;
}

const REQUEST_SCOPE = "/nodefony/test/request-scope";

/**
 * Services `request` de la sonde (#485) encore vivants — et les scopes qui les
 * portaient —, après GC forcé. Compte exact, par `FinalizationRegistry`, depuis
 * la marque `/request-scope/instances/mark`.
 */
async function liveProbes(): Promise<{ alive: number; scopesAlive: number }> {
  const r = (await get(`${REQUEST_SCOPE}/instances`)) as Record<
    string,
    unknown
  >;
  return { alive: r.alive as number, scopesAlive: r.scopesAlive as number };
}

async function liveContexts(): Promise<number> {
  const r = (await get("/nodefony/test/als-test/contexts")) as Record<
    string,
    unknown
  >;
  return r.alive as number;
}

function openCloseWs(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, wsOpts);
    ws.once("open", () => ws.close());
    ws.once("close", () => resolve());
    ws.once("error", reject);
  });
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Un upload multipart minimal (1 petit fichier) — pour le test de fuite. */
function uploadSmall(): Promise<void> {
  const boundary = "----nfMemBoundary";
  const body = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="m.txt"\r\nContent-Type: text/plain\r\n\r\nx\r\n--${boundary}--\r\n`,
  );
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        ...BASE,
        path: "/nodefony/test/html/upload",
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve());
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

// ── assertions ───────────────────────────────────────────────────────────────

/**
 * Asserte que la boucle n'a laissé AUCUN scope `request` ouvert — et PUBLIE le
 * relevé.
 *
 * Le tas ne voit pas une petite fuite de scopes ; le registre du conteneur, si
 * — chaque scope jamais libéré y reste compté. Le témoin `base >= 1` garantit
 * qu'on lit un vrai relevé : la sonde compte au moins le scope de sa propre
 * requête (une introspection cassée rendrait `-1` des deux côtés, et un écart
 * nul).
 */
const scopesDrained = async (quoi: string, base: number): Promise<void> => {
  expect(
    base,
    "témoin : la sonde voit au moins le scope de sa propre requête",
  ).to.be.at.least(1);
  const delta = await drainTo(liveScopes, base, 1);
  console.log(
    `[scopes] ${quoi} : ${delta} scope(s) résiduel(s) après drainage`,
  );
  expect(
    delta,
    `${quoi} : ${delta} scope(s) « request » de plus qu'avant la boucle — ` +
      "soit une fuite (un scope jamais refermé), soit un client EXTERNE " +
      "(navigateur, client MCP) qui s'est connecté pendant le run : " +
      "`lsof -nP -iTCP:5152 -sTCP:ESTABLISHED` les nomme.",
  ).to.be.at.most(0);
};

/**
 * Asserte qu'aucun contexte HTTP né depuis la marque (`/als-test/contexts/mark`)
 * n'est encore VIVANT — compte exact, par `FinalizationRegistry`.
 *
 * Voit ce que ni le registre des scopes ni le tas ne voient : UN contexte
 * retenu ailleurs (tableau, fermeture, cache) alors que son scope a bien été
 * refermé — un épinglé sur mille pèse 15 o par requête, invisible à la pente.
 * Seul le contexte de la sonde elle-même doit rester : d'où la base 1, qui
 * sert aussi de témoin — un traceur désarmé rendrait 0, donc un écart de −1.
 */
const contextsReleased = async (quoi: string): Promise<void> => {
  const delta = await drainTo(liveContexts, 1, 1);
  expect(
    delta,
    "témoin : le traceur est armé et voit le contexte de sa propre requête",
  ).to.be.at.least(0);
  console.log(`[contexts] ${quoi} : ${delta} contexte(s) encore vivant(s)`);
  expect(
    delta,
    `${quoi} : ${delta} contexte(s) HTTP de la boucle jamais réclamé(s) par ` +
      "le ramasse-miettes — une référence les retient après la réponse.",
  ).to.be.at.most(0);
};

/**
 * Asserte que les services `request` nés depuis la marque, ET les scopes qui
 * les portaient, ont été réclamés par le ramasse-miettes.
 *
 * Le registre des scopes dit qu'un scope a été REFERMÉ ; seul ce compte dit
 * qu'il a été LIBÉRÉ, avec ses services — un service retenu par une fermeture
 * épinglerait son scope entier. Base 1 : la sonde elle-même passe par un
 * contrôleur qui résout le service ; elle sert aussi de témoin (un traceur
 * muet rendrait 0, donc un écart de −1).
 */
const probesReleased = async (quoi: string): Promise<void> => {
  // Les deux comptes drainent ENSEMBLE : relus par une requête à part, celui
  // des scopes pourrait encore voir le scope de la lecture précédente.
  let last = { alive: 0, scopesAlive: 0 };
  await drainTo(
    async () => {
      last = await liveProbes();
      return Math.max(last.alive, last.scopesAlive);
    },
    1,
    1,
  );
  const delta = last.alive - 1;
  const scopes = last.scopesAlive - 1;
  expect(
    delta,
    "témoin : le traceur voit le service de sa propre requête",
  ).to.be.at.least(0);
  console.log(
    `[request-scope] ${quoi} : ${delta} service(s) et ${scopes} scope(s) encore vivant(s)`,
  );
  expect(
    delta,
    `${quoi} : ${delta} service(s) « request » jamais réclamé(s) — une ` +
      "référence les retient après la fermeture de leur scope.",
  ).to.be.at.most(0);
  expect(
    scopes,
    `${quoi} : ${scopes} scope(s) refermé(s) mais jamais réclamé(s).`,
  ).to.be.at.most(0);
};

// ── actions ──────────────────────────────────────────────────────────────────

const MIXED_ROUTES = [
  "/nodefony/test/index",
  "/nodefony/test/context",
  "/nodefony/test/rest/session",
];

/** Une itération par scénario — partagées par l'échauffement et les mesures. */
const ACTIONS = {
  get: () => get("/nodefony/test/index"),
  crashSync: () => get("/nodefony/test/crash/sync"),
  crashAsync: () => get("/nodefony/test/crash/async"),
  crashNative: () => get("/nodefony/test/crash/native"),
  mixed: (i: number) => get(MIXED_ROUTES[i % MIXED_ROUTES.length]),
  upload: () => uploadSmall(),
  wsOpenClose: () => openCloseWs(`${WSS}/nodefony/test/ws`),
  wsEcho: () =>
    new Promise<void>((resolve, reject) => {
      // Chaque connexion crée une session (startSession) → allocations plus lourdes.
      const ws = new WebSocket(`${WSS}/nodefony/test/ws/echo`, wsOpts);
      ws.once("open", () => ws.send("ping"));
      ws.once("message", () => ws.close());
      ws.once("close", () => resolve());
      ws.once("error", reject);
    }),
  // Deux services `request` résolus par requête (contrôleur + consommateur).
  requestService: () => get(`${REQUEST_SCOPE}/probe`),
  // Le service `request` d'une connexion, résolu au handshake puis à un message.
  wsRequestService: () =>
    new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${WSS}${REQUEST_SCOPE}/ws`, wsOpts);
      let replies = 0;
      ws.on("message", () => {
        if (++replies === 1) ws.send("ping");
        else ws.close();
      });
      ws.once("close", () => resolve());
      ws.once("error", reject);
    }),
} satisfies Record<string, (i: number) => Promise<unknown>>;

/**
 * Itérations d'échauffement par scénario, jouées UNE fois en tête de suite.
 *
 * Un serveur neuf n'est pas au régime : V8 compile et optimise les chemins
 * chauds (code et retours de type comptent dans `heapUsed`), les caches
 * paresseux se remplissent. Mesuré sur un serveur neuf, ring du syslog coupé :
 * +3 Mo sur les ~1 000 premières requêtes GET, puis plat (~40 o/requête sur
 * les 4 000 suivantes) ; les chemins WebSocket plafonnent après quelques
 * centaines de connexions. Mesurer avant ce plateau, c'est publier
 * l'échauffement comme une fuite — c'est ce que faisait l'ancien écart sur
 * 1 000 requêtes, 2,45 Mo sur les trois systèmes de la CI.
 */
const WARMUP = {
  get: 1500,
  crashSync: 200,
  crashAsync: 200,
  crashNative: 200,
  mixed: 450,
  upload: 200,
  wsOpenClose: 400,
  wsEcho: 400,
  requestService: 450,
  wsRequestService: 400,
} satisfies Record<keyof typeof ACTIONS, number>;

/**
 * Plan de mesure d'un scénario : un palier jeté (reprise après le scénario
 * précédent), puis `batches` paliers de `batch` itérations.
 */
const plan = (
  key: keyof typeof ACTIONS,
  batch: number,
  batches = 6,
): IRetentionPlan => ({
  probe: serverHeap,
  act: async (i) => {
    await ACTIONS[key](i);
  },
  warmup: batch,
  batch,
  batches,
});

// ── suites ───────────────────────────────────────────────────────────────────

// Le ring de relecture du syslog (2 000 Pdu en développement) est coupé pendant
// la mesure : borné, mais re-rempli à chaque scénario par des Pdu d'une autre
// taille, il fabrique plusieurs Ko de pente par requête — 2,45 Mo sur les
// 1 000 premières requêtes d'un serveur neuf, identiques sur les trois systèmes
// de la CI. Ce n'est pas une rétention du pipeline, c'est un tampon qui se
// remplit. Rétabli à la fin, quoi qu'il arrive. Puis chaque chemin est amené à
// son plateau (`WARMUP`).
beforeAll(async () => {
  await setSyslogRing(false);
  for (const key of Object.keys(WARMUP) as (keyof typeof WARMUP)[]) {
    for (let i = 0; i < WARMUP[key]; i++) await ACTIONS[key](i);
  }
}, 120_000);
afterAll(async () => {
  await setSyslogRing(true);
});

describe("Memory leaks — HTTP (requires server)", function () {
  beforeAll(async () => {
    const r = (await get("/nodefony/test/als-test/contexts/arm")) as Record<
      string,
      unknown
    >;
    expect(r.armed, "traceur de contextes non armé").to.equal(true);
  });
  afterAll(async () => {
    await get("/nodefony/test/als-test/contexts/disarm");
  });

  // Hygiène : le test d'upload ne doit JAMAIS laisser de résidu dans tmp/.
  // Snapshot avant la suite, diff après → supprime UNIQUEMENT ce qu'elle a créé
  // (sans toucher au préexistant). Même pattern que upload.test.ts.
  let snapshot: UploadSnapshot;
  beforeAll(async () => {
    snapshot = await snapshotUploadDirs();
  });
  afterAll(async () => {
    const removed = await purgeUploadResidue(snapshot);
    expect(
      removed,
      "aucun résidu supprimé — dossier de dépôt manqué",
    ).to.be.greaterThan(0);
  });

  /** Une boucle HTTP : pente de tas, puis scopes et contextes drainés. */
  const httpLoop = async (
    quoi: string,
    p: IRetentionPlan,
    seuil: number,
  ): Promise<void> => {
    await get("/nodefony/test/als-test/contexts/mark");
    const scopesBefore = await liveScopes();
    const assertRetention = await retention(quoi, p, seuil);
    await scopesDrained(quoi, scopesBefore);
    await contextsReleased(quoi);
    assertRetention();
  };

  it("sequential GET requests — retains nothing per request", async () => {
    await httpLoop("sequential GET requests", plan("get", 250), THRESHOLDS.get);
  });

  it("consecutive sync crashes — retains nothing per crash", async () => {
    await httpLoop(
      "consecutive sync crashes",
      plan("crashSync", 50),
      THRESHOLDS.crashSync,
    );
  });

  it("consecutive async crashes — retains nothing per crash", async () => {
    await httpLoop(
      "consecutive async crashes",
      plan("crashAsync", 50),
      THRESHOLDS.crashAsync,
    );
  });

  it("consecutive native TypeError crashes — retains nothing per crash", async () => {
    await httpLoop(
      "consecutive native TypeError crashes",
      plan("crashNative", 50),
      THRESHOLDS.crashNative,
    );
  });

  it("mixed requests (index + context + session) — retains nothing per request", async () => {
    await httpLoop(
      "mixed requests (index + context + session)",
      plan("mixed", 150),
      THRESHOLDS.mixed,
    );
  });

  it("sequential multipart uploads — retains nothing per upload", async () => {
    // Hot path busboy : valide que streamMultipart (listeners file/field +
    // WriteStream + busboy par requête) ne fuit pas. Fichier minuscule → la
    // pente mesure les listeners/buffers, pas le contenu.
    await httpLoop(
      "sequential multipart uploads",
      plan("upload", 100),
      THRESHOLDS.upload,
    );
  });

  it("GET resolving request-scoped services — retains nothing per request", async () => {
    // Deux services `request` par requête (#485) : créés au 1ᵉʳ besoin, rangés
    // sur le scope, nettoyés à sa fermeture — puis réclamés, scope compris.
    await get(`${REQUEST_SCOPE}/instances/mark`);
    await httpLoop(
      "GET resolving request-scoped services",
      plan("requestService", 250),
      THRESHOLDS.requestService,
    );
    await probesReleased("GET resolving request-scoped services");
  });

  it("server is alive after load — /index returns 200", async () => {
    const req = https.request({
      ...BASE,
      path: "/nodefony/test/index",
      method: "GET",
    });
    const status = await new Promise<number>((resolve, reject) => {
      req.on("response", (res) => {
        res.resume();
        resolve(res.statusCode!);
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).to.equal(200);
  });
});

describe("Memory leaks — WebSocket (requires server)", function () {
  const wsLoop = async (
    quoi: string,
    p: IRetentionPlan,
    seuil: number,
  ): Promise<void> => {
    const scopesBefore = await liveScopes();
    const assertRetention = await retention(quoi, p, seuil);
    await scopesDrained(quoi, scopesBefore);
    assertRetention();
  };

  it("WS connections open/close — retains nothing per connection", async () => {
    await wsLoop(
      "WS connections open/close",
      plan("wsOpenClose", 100),
      THRESHOLDS.wsOpenClose,
    );
  });

  it("WS echo round-trips open/send/close — retains nothing per connection", async () => {
    await wsLoop(
      "WS echo round-trips open/send/close",
      plan("wsEcho", 50),
      THRESHOLDS.wsEcho,
    );
  });

  it("WS connections resolving a request-scoped service — retains nothing per connection", async () => {
    // Le scope d'une connexion porte son service `request` jusqu'à la
    // fermeture (#485) : ni lui ni son scope ne doivent lui survivre.
    await get(`${REQUEST_SCOPE}/instances/mark`);
    await wsLoop(
      "WS connections resolving a request-scoped service",
      plan("wsRequestService", 50),
      THRESHOLDS.wsRequestService,
    );
    await probesReleased("WS connections resolving a request-scoped service");
  });
});
