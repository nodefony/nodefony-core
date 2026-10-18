/// <reference types="node" />
/**
 * E2E — la couche ISOMORPHE contre un serveur RÉEL.
 * Requires: server running on 5152 (wss). Start: /start-server
 *
 * Le trou que ce banc ferme, et qui était béant : **seize bancs WebSocket
 * d'intégration existent, et pas un seul n'emploie le client que les
 * utilisateurs emploient.** Tous ouvrent une socket `ws` nue et composent les
 * trames JSON-RPC à la main. Ils prouvent donc le SERVEUR — jamais que
 * `NodefonySocket`, ses observateurs agnostiques et les hooks bâtis dessus
 * savent lui parler. Une conformité ne se mesure que sur un client.
 *
 * Symétriquement, `src/nodefony/src/tests/clientObserve.test.ts` tient les
 * règles du socle sur un transport MOCK : il prouve le comportement, pas
 * l'accord avec le serveur. Un mock répond ce qu'on a imaginé — c'est
 * exactement ce qu'un décodeur de protocole ne doit pas être cru sur parole.
 * Ici, le format coalescé du journal, la forme du welcome, le ref-comptage des
 * abonnements et le rejeu à la reconnexion sont confrontés au vrai pod.
 *
 * Ce qui est exercé, DE BOUT EN BOUT : la globale `WebSocket` →
 * `BrowserWsTransport` → `NodefonySocket` → `connectShared`/`observe*` — soit
 * le chemin exact du navigateur, à une seule différence de décor près, dite
 * plus bas (le cookie).
 *
 * Gates :
 *  1. handshake réel → `observeIdentity` rend l'identité résolue par le serveur ;
 *  2. `observeState` suit les transitions RÉELLES jusqu'à `connected` ;
 *  3. `observeSyslog` décode le format coalescé RÉEL (`{ logs, dropped }`) ;
 *  4. ref-comptage : deux observateurs, un libéré → l'autre reçoit encore ;
 *  5. dernier libéré → le serveur cesse de pousser (désabonnement parti) ;
 *  6. reconnexion réelle → abonnements REJOUÉS sans une ligne applicative ;
 *  7. le pont `request(path)` rend la MÊME valeur que le GET REST ;
 *  8. route inconnue par le pont → REJET nommé (404), jamais une attente muette ;
 *  9. handshake ANONYME → refus constaté par la sonde : `connect()` rejette,
 *     état `error`, aucune retentative, jamais d'identité (#596) ;
 * 10. serveur ABSENT → même échec d'ouverture, mais la reconnexion continue.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import https from "node:https";
import net from "node:net";
import WS from "ws";
import { trustDevAuthority } from "../helpers/devAuthority";
import {
  connectShared,
  observeChannel,
  observeChannelStats,
  observeIdentity,
  observeState,
  observeSyslog,
  PLATFORM_CHANNELS,
  NodefonySocket,
  type RealtimeIdentity,
  type RealtimeState,
} from "nodefony/client";

const BASE = { hostname: "127.0.0.1", port: 5152 };
const AUTH = "/nodefony/security/api/auth";
const HUB = "wss://127.0.0.1:5152/nodefony/studio/api/realtime";
const MODULES = "/nodefony/kernel/api/modules";
const TIMEOUT = 15_000;

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function request(
  path: string,
  method = "GET",
  headers: Record<string, string> = {},
  payload?: unknown,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data =
      payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    const req = https.request(
      {
        ...BASE,
        path,
        method,
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
            /* texte brut */
          }
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            body,
          });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(TIMEOUT, () => req.destroy(new Error("http timeout")));
    if (data) req.write(data);
    req.end();
  });
}

async function loginCookie(): Promise<string> {
  const res = await request(
    `${AUTH}/login`,
    "POST",
    {},
    {
      username: "admin",
      password: "secret-de-dev-42",
    },
  );
  expect(res.status, "login attendu 200").toBe(200);
  const set = res.headers["set-cookie"];
  const first = Array.isArray(set) ? set[0] : set;
  expect(typeof first, "cookie de session attendu au login").toBe("string");
  return (first as string).split(";")[0]!;
}

/**
 * **La seule différence avec le navigateur**, et elle est de décor, pas de code :
 * `BrowserWsTransport` fait `new WebSocket(url)` — un seul argument, comme la
 * norme l'impose. Un navigateur joint le cookie de session tout seul et fait
 * confiance à l'autorité de développement ; Node n'a ni jar de cookies ni cette
 * autorité. On installe donc une globale `WebSocket` qui porte le cookie, et
 * l'on confie l'autorité au processus (`trustDevAuthority`) — la chaîne est
 * VALIDÉE, jamais ignorée. **Rien d'autre** : le transport, le client, les
 * observateurs, la sonde et le protocole restent ceux du navigateur, à la lettre.
 */
function installWebSocket(cookie: string | null): void {
  class TestWebSocket extends WS {
    constructor(url: string) {
      super(url, { headers: cookie ? { cookie } : {} });
      socketsCreated++;
    }
  }
  (globalThis as { WebSocket?: unknown }).WebSocket = TestWebSocket;
}

/** Sockets ouvertes par le transport — une retentative en crée une de plus. */
let socketsCreated = 0;

/** Un port où personne n'écoute : celui qu'on vient de rendre. */
async function deadPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

/** Purge le registre de `shared()` — sans quoi un cas hérite de la socket du précédent. */
function resetShared(): void {
  const g = globalThis as { __nfRealtime__?: Map<string, NodefonySocket> };
  for (const client of g.__nfRealtime__?.values() ?? []) client.disconnect();
  delete g.__nfRealtime__;
}

/** Attend qu'une condition devienne vraie, ou échoue en le DISANT. */
async function until(
  ce: string,
  predicat: () => boolean,
  ms = 8000,
): Promise<void> {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (predicat()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`jamais observé en ${ms} ms : ${ce}`);
}

/** Provoque du trafic serveur — donc des journaux à pousser sur le canal syslog. */
const remuer = (cookie: string) => request(MODULES, "GET", { cookie });

/**
 * Attend une trame du flux en PROVOQUANT du trafic tant qu'elle n'est pas venue.
 *
 * `connected` est posé à l'ouverture TCP ; l'abonnement, lui, n'est (re)joué
 * qu'au `realtime:welcome` (`NodefonySocket.replaySubscriptions`), et n'est actif
 * qu'à son acquittement (`whenSubscribed`, #610). Un journal émis entre les deux est PERDU : le pont syslog
 * ne s'attache qu'à l'abonnement. Un `remuer` unique juste après `connected`
 * tombait dans ce trou — vécu en intégration continue (macOS, production, où
 * aucun journal DEBUG ne vient combler le flux après coup) : requête partie 2 ms
 * après l'ouverture, puis dix secondes de silence.
 *
 * Remuer à chaque tour ne relâche rien : sans abonnement actif côté serveur,
 * aucune trame n'arrive, quel que soit le trafic provoqué.
 *
 * @param geste - le trafic d'un tour ; deux requêtes d'affilée quand le test
 *   attend deux lignes dans le MÊME lot (le pont coalesce sur 200 ms).
 */
async function untilStirred(
  ce: string,
  predicat: () => boolean,
  ms = 8000,
  geste: () => Promise<unknown> = () => remuer(cookie),
): Promise<void> {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (predicat()) return;
    await geste();
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`jamais observé en ${ms} ms (trafic relancé) : ${ce}`);
}

let cookie: string;
let restoreTrust: (() => void) | null = null;

beforeAll(async () => {
  // AVANT le login : plus aucune requête de ce banc n'ignore le certificat.
  restoreTrust = trustDevAuthority();
  cookie = await loginCookie();
}, TIMEOUT);

afterAll(() => {
  restoreTrust?.();
});

afterEach(() => {
  resetShared();
});

describe("E2E isomorphe — le handshake et l'identité, vus par le CLIENT", () => {
  it(
    "connectShared + observeIdentity rendent l'identité RÉSOLUE PAR LE SERVEUR",
    async () => {
      installWebSocket(cookie);
      const live = connectShared({ url: HUB });
      const identites: (RealtimeIdentity | null)[] = [];
      observeIdentity(live.socket, (i) => identites.push(i));
      live.start();

      // `null` d'abord : aucune identité n'est INVENTÉE avant le welcome.
      expect(identites[0]).toBeNull();
      await until("welcome reçu", () => identites.length > 1);

      const resolue = identites[identites.length - 1]!;
      expect(resolue.authenticated).toBe(true);
      expect(resolue.userIdentifier).toBe("admin");
      // Les rôles viennent du serveur — le client n'en dérive aucun.
      expect(resolue.roles).toContain("ROLE_ADMIN");
      // Découverte : le serveur ANNONCE ce à quoi on peut s'abonner.
      expect(live.socket.serverChannels).toContain(PLATFORM_CHANNELS.syslog);
      expect(live.socket.serverMethods).toContain("api.request");
    },
    TIMEOUT,
  );

  it(
    "observeState suit les transitions RÉELLES jusqu'à `connected`",
    async () => {
      installWebSocket(cookie);
      const live = connectShared({ url: HUB });
      const etats: RealtimeState[] = [];
      observeState(live.socket, (s) => etats.push(s));
      expect(etats).toEqual(["disconnected"]);
      live.start();
      await until("connected", () => live.socket.state === "connected");
      expect(etats).toContain("connecting");
      expect(etats[etats.length - 1]).toBe("connected");
    },
    TIMEOUT,
  );

  it(
    "handshake ANONYME : connect() rejette, état `error`, aucune retentative (#596)",
    async () => {
      // Le pare-feu refuse AVANT le 101 : le transport ne voit qu'un 1006 (le
      // statut est caché, comme dans un navigateur), la sonde lit le 401 et le
      // client s'arrête. Sur l'ancien contrat, la socket s'ouvrait puis
      // tombait en 1008 : `connected` puis `reconnecting`, sans fin.
      installWebSocket(null);
      socketsCreated = 0;
      const socket = new NodefonySocket({ url: HUB, reconnectDelay: 100 });
      const etats: RealtimeState[] = [];
      const noticeCodes: unknown[] = [];
      socket.onState((s) => etats.push(s));
      socket.onNotice((n) => noticeCodes.push(n.code));
      const identites: (RealtimeIdentity | null)[] = [];
      observeIdentity(socket, (i) => identites.push(i));
      try {
        await expect(socket.connect()).rejects.toThrow();
        await until("verdict de la sonde", () => socket.state === "error");
        // Au-delà du plancher de reconnexion (100 ms) : une retentative
        // interdite aurait eu le temps de partir.
        await new Promise((r) => setTimeout(r, 500));
        expect(etats, "la socket refusée a paru connectée").not.toContain(
          "connected",
        );
        expect(etats, "un refus a été retenté comme une panne").not.toContain(
          "reconnecting",
        );
        expect(socket.state).toBe("error");
        expect(socketsCreated, "une seconde socket est partie").toBe(1);
        expect(noticeCodes, "la notice dit le statut du refus").toContain(401);
        expect(
          identites.every((i) => i === null),
          "une identité a été rendue sans welcome",
        ).toBe(true);
        expect(socket.identity).toBeNull();
      } finally {
        socket.disconnect();
      }
    },
    TIMEOUT,
  );

  it(
    "serveur ABSENT : connect() rejette, mais la reconnexion continue (#596)",
    async () => {
      // Le pendant du refus : même 1006 vu du transport, sonde sans réponse.
      // Sans ce cas, un client qui conclurait « refusé » à tout échec passerait
      // le précédent.
      installWebSocket(null);
      const port = await deadPort();
      const socket = new NodefonySocket({
        url: `wss://127.0.0.1:${port}/nodefony/studio/api/realtime`,
        reconnectDelay: 100,
      });
      const etats: RealtimeState[] = [];
      socket.onState((s) => etats.push(s));
      try {
        await expect(socket.connect()).rejects.toThrow();
        await until("reconnexion armée", () => etats.includes("reconnecting"));
        expect(etats).not.toContain("error");
      } finally {
        socket.disconnect();
      }
    },
    TIMEOUT,
  );
});

describe("E2E isomorphe — les canaux, contre le protocole RÉEL", () => {
  it(
    "observeSyslog décode le format COALESCÉ que le serveur envoie vraiment",
    async () => {
      installWebSocket(cookie);
      const live = connectShared({ url: HUB });
      let entrees: unknown[] = [];
      observeSyslog(live.socket, (e) => (entrees = e));
      live.start();
      await until("connecté", () => live.socket.state === "connected");
      // DEUX requêtes : en production une requête ne laisse qu'UNE ligne de
      // journal. En attendre deux ne doit rien au découpage des lots par le
      // serveur, ni à un message annexe — l'alerte « canal sans règle », qui
      // fournissait la seconde, a disparu et ce test rougissait sur 3 systèmes.
      await untilStirred(
        "journaux reçus",
        () => entrees.length > 1,
        8000,
        () => remuer(cookie).then(() => remuer(cookie)),
      );

      // Ce que le mock ne pouvait pas prouver : le serveur envoie bien un LOT
      // (`{ logs, dropped }`) et non des entrées une à une. Un décodeur qui ne
      // gérerait que l'entrée unique livrerait ici l'enveloppe elle-même.
      const premiere = entrees[0] as Record<string, unknown>;
      expect(
        premiere,
        "une entrée de journal, pas l'enveloppe",
      ).not.toHaveProperty("logs");
      expect(premiere).toHaveProperty("severity");
      expect(entrees.length).toBeGreaterThan(1);
    },
    TIMEOUT,
  );

  it(
    "ref-comptage RÉEL : libérer un observateur ne coupe pas l'autre",
    async () => {
      installWebSocket(cookie);
      const live = connectShared({ url: HUB });
      const a: unknown[] = [];
      const b: unknown[] = [];
      live.start();
      await until("connecté", () => live.socket.state === "connected");

      const offA = observeChannel(live.socket, PLATFORM_CHANNELS.syslog, (p) =>
        a.push(p),
      );
      observeChannel(live.socket, PLATFORM_CHANNELS.syslog, (p) => b.push(p));
      await untilStirred("les deux servis", () => a.length > 0 && b.length > 0);

      offA();
      const bAvant = b.length;
      await remuer(cookie);
      // Le SERVEUR pousse toujours : le désabonnement n'est pas parti au premier
      // départ. C'est le ref-comptage, prouvé de l'autre côté du fil.
      await until("le second reçoit encore", () => b.length > bAvant);
    },
    TIMEOUT,
  );

  it(
    "le DERNIER observateur libéré fait vraiment cesser le serveur",
    async () => {
      installWebSocket(cookie);
      const live = connectShared({ url: HUB });
      const recus: unknown[] = [];
      live.start();
      await until("connecté", () => live.socket.state === "connected");

      const off = observeChannel(live.socket, PLATFORM_CHANNELS.syslog, (p) =>
        recus.push(p),
      );
      await untilStirred("premier lot", () => recus.length > 0);

      off();
      const apresLiberation = recus.length;
      await remuer(cookie);
      await remuer(cookie);
      await new Promise((r) => setTimeout(r, 1200));
      expect(
        recus.length,
        "le serveur pousse encore après le dernier désabonnement",
      ).toBe(apresLiberation);
    },
    TIMEOUT,
  );

  it(
    "observeChannelStats compte des frames RÉELLES",
    async () => {
      installWebSocket(cookie);
      const live = connectShared({ url: HUB });
      let vues = 0;
      live.start();
      await until("connecté", () => live.socket.state === "connected");
      observeChannel(live.socket, PLATFORM_CHANNELS.syslog, () => {});
      observeChannelStats(
        live.socket,
        PLATFORM_CHANNELS.syslog,
        (s) => (vues = s?.msgCount ?? 0),
      );
      // L'échantillonneur tourne 1×/s : la valeur remonte au tick suivant.
      await untilStirred("compteur non nul", () => vues > 0, 6000);
    },
    TIMEOUT,
  );
});

describe("E2E isomorphe — ce qui casse : reconnexion, refus, pont", () => {
  it("reconnexion RÉELLE : les abonnements sont REJOUÉS sans une ligne applicative", async () => {
    installWebSocket(cookie);
    const live = connectShared({ url: HUB });
    const recus: unknown[] = [];
    const etats: RealtimeState[] = [];
    observeState(live.socket, (s) => etats.push(s));
    live.start();
    await until("connecté", () => live.socket.state === "connected");
    observeChannel(live.socket, PLATFORM_CHANNELS.syslog, (p) => recus.push(p));
    await untilStirred("premier lot", () => recus.length > 0);

    // Une perte réseau ne s'ENVOIE pas, elle se SUBIT : `1006` est réservé par
    // la RFC 6455 et aucune pile ne l'émet (`ws` refuse même de l'essayer).
    // On coupe donc le TCP sous la socket — le cas réel, celui qui produit un
    // `1006` côté client sans trame de fermeture.
    const transport = live.socket as unknown as {
      transport: { ws: { terminate(): void } };
    };
    const avant = recus.length;
    transport.transport.ws.terminate();

    await until(
      "reconnexion tentée",
      () => etats.includes("reconnecting"),
      10_000,
    );
    await until("reconnecté", () => live.socket.state === "connected", 12_000);
    // Rien n'a été ré-abonné par le test : c'est le client qui rejoue.
    //
    // `connected` ne dit PAS que le flux est actif : seul l'acquittement du
    // serveur le dit (#610). Borné, pour qu'un acquittement qui ne vient pas
    // rougisse en le nommant au lieu d'épuiser le délai du test.
    await Promise.race([
      live.socket.whenSubscribed(PLATFORM_CHANNELS.syslog),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(new Error("abonnement syslog jamais acquitté en 10 000 ms")),
          10_000,
        ),
      ),
    ]);
    // UN SEUL trafic, lancé après l'acquittement : la garantie dit qu'il est
    // livré. On attend la trace de CETTE requête, pas « une trame quelconque » :
    // en développement, les journaux DEBUG nés de l'abonnement lui-même
    // suffisaient à faire passer le test, qui ne départageait donc rien.
    await remuer(cookie);
    await until(
      "flux repris",
      () => JSON.stringify(recus.slice(avant)).includes(MODULES),
      10_000,
    );
  }, 30_000);

  it(
    "le pont `request(path)` rend la MÊME valeur que le GET REST",
    async () => {
      installWebSocket(cookie);
      const live = connectShared({ url: HUB });
      live.start();
      await until("connecté", () => live.socket.state === "connected");

      const parSocket = await live.socket.request(MODULES);
      const parRest = await request(MODULES, "GET", { cookie });
      expect(parRest.status).toBe(200);
      // « 1 action controller = N transports » : la valeur ne dépend pas du fil.
      expect(parSocket).toEqual(parRest.body);
    },
    TIMEOUT,
  );

  it(
    "le pont refuse une route inconnue par une ERREUR NOMMÉE, pas par un silence",
    async () => {
      installWebSocket(cookie);
      const live = connectShared({ url: HUB });
      live.start();
      await until("connecté", () => live.socket.state === "connected");

      // Un refus qui n'arrive jamais est indiscernable d'un serveur lent : le
      // client doit REJETER, avec le statut équivalent HTTP dans `data`.
      let rejet: unknown = null;
      try {
        await live.socket.request("/nodefony/kernel/api/route-qui-nexiste-pas");
      } catch (err) {
        rejet = err;
      }
      expect(
        rejet,
        "une route inconnue doit REJETER, pas rester pendante",
      ).not.toBeNull();
      const status = (rejet as { data?: { status?: number } }).data?.status;
      expect(status, "le statut HTTP équivalent voyage dans l'erreur").toBe(
        404,
      );
    },
    TIMEOUT,
  );

  it(
    "un canal sans producteur est REFUSÉ par une notification, pas par un silence",
    async () => {
      // Ce que ce banc constatait, et qui manquait au serveur : un `subscribe`
      // vers un nom que personne ne produit était ignoré SANS un mot. L'écran
      // restait muet, indiscernable d'un canal calme — et le développeur
      // cherchait son bug côté producteur alors qu'il était dans le NOM.
      //
      // Le motif est `unknown`, distinct de `forbidden` : les deux appellent des
      // gestes opposés (relire le nom / demander un droit). Il n'ouvre aucun
      // oracle — un canal GARDÉ est tranché en amont par le verrou de frame, et
      // rend `forbidden` qu'il existe ou non.
      installWebSocket(cookie);
      const live = connectShared({ url: HUB });
      const refus: { channel: string; reason: string; detail?: string }[] = [];
      const off = live.socket.onDenied((d) => refus.push(d));
      live.start();
      await until("connecté", () => live.socket.state === "connected");

      live.socket.subscribe("app:canal-qui-nexiste-pas");
      await until("refus reçu", () => refus.length > 0);
      // `toMatchObject`, pas `toEqual` : le refus porte AUSSI un `detail` hors
      // production (`deniedDetail`) — la phrase qui dit au développeur quoi
      // regarder, tue en production où elle serait l'oracle que `reason` refuse
      // d'être. Une égalité stricte gravait l'ancien contrat à deux champs et
      // faisait tomber la forge sur un enrichissement VOULU.
      expect(refus[0]).toMatchObject({
        channel: "app:canal-qui-nexiste-pas",
        reason: "unknown",
      });
      // …et tant qu'à recaler, éprouver la promesse NEUVE plutôt que la
      // contourner : hors production, le refus doit porter la phrase utile.
      //
      // 🔴 Le mode se lit sur le SERVEUR, jamais sur ce process-ci. Ce cas
      // lisait `NODE_ENV`, c'est-à-dire l'horloge du lanceur de tests — or la
      // forge démarre le serveur en production et lance la suite SANS ce mode.
      // Le cas exigeait donc en production la phrase que la production retire
      // exprès, et il tombait sur les TROIS plateformes à la fois. `NF_TEST_ENV`
      // est posé par le `globalSetup` qui SONDE le serveur (`/livez`) : c'est le
      // porteur qui existait déjà, ce cas était le seul à ne pas l'appeler.
      const horsProduction =
        (process.env.NF_TEST_ENV ?? "development") !== "production";
      if (horsProduction)
        expect(
          typeof refus[0]?.detail === "string" && refus[0].detail.length > 0,
          "hors production, un refus doit dire au développeur quoi regarder",
        ).toBe(true);
      off();
    },
    TIMEOUT,
  );
});
