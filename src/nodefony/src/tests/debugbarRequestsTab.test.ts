/**
 * L'onglet « Requêtes » MANIPULÉ (#665), sur le back des Journaux de la
 * console : la vue Page liste ce que la page a fait (le document compris) et
 * relit au dépliage les lignes du serveur ; la vue Journaux montre la
 * recherche groupée par requête ; la vue Direct, les lignes en temps réel.
 *
 * Aucun réseau : `fetch` répond comme le back (`/nodefony/syslog/api/logs/
 * search`), la socket est un double.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DebugBar } from "../client/debugbar/DebugBar";
import type { NodefonySocket } from "../client/realtime/NodefonySocket";
import { PLATFORM_CHANNELS } from "../realtime/platformChannels";

type Handler = (...args: unknown[]) => void;
let handlers: Map<string, Handler>;
/** Les recherches reçues par le faux back, dans l'ordre. */
let recherches: URLSearchParams[];
/** Le requestId posé par la barre sur chaque recherche, dans l'ordre. */
let marques: Array<string | null>;
/** Les profils demandés au profileur. */
let profils: string[];

/** Socket double qui GARDE ses écouteurs : le test publie à leur place. */
const fakeClient = (): NodefonySocket =>
  ({
    state: "disconnected",
    on: (channel: string, cb: Handler) => {
      handlers.set(channel, cb);
      return () => handlers.delete(channel);
    },
    off: () => {},
    onState: () => () => {},
    onIdentity: () => () => {},
    onNotice: () => () => {},
    onStats: () => () => {},
    onReconnect: () => () => {},
    subscribe: () => {},
    unsubscribe: () => {},
    connect: () => Promise.resolve(),
    disconnect: () => {},
    request: () => Promise.resolve({}),
    getStats: () => [],
    channel: () => ({
      on: () => () => {},
      send: () => {},
      open: () => {},
      close: () => {},
    }),
  }) as unknown as NodefonySocket;

/** Une ligne du journal telle que la recherche la rend. */
const rec = (
  uid: number,
  payload: string,
  requestId?: string,
  extra: Record<string, unknown> = {},
) => ({
  uid,
  severity: 6,
  severityName: "INFO",
  moduleName: "app",
  msgid: "",
  msg: "",
  timeStamp: 1_700_000_000_000 + uid,
  pid: 1,
  payload,
  ...(requestId === undefined ? {} : { requestId }),
  ...extra,
});

/** Le faux back : ce que `logs/search` rendrait pour ces paramètres. */
function repondre(p: URLSearchParams): unknown {
  const rid = p.get("requestId");
  if (rid === "rid-1")
    return { rows: [rec(10, "lecture des articles", "rid-1")] };
  if (rid !== null) return { rows: [rec(20, `ligne de ${rid}`, rid)] };
  // Recherche du document : sa ligne d'accès, au chargement.
  if (p.has("to"))
    return {
      result: {
        rows: [
          rec(1, `GET 200 https://h${location.pathname} 3ms`, "rid-doc", {
            msgid: "req",
          }),
          rec(2, "WS   1000 wss://h/chat  0.8ms 127.0.0.1 [x]", "rid-ws", {
            msgid: "req",
          }),
        ],
      },
    };
  return {
    rows: [
      rec(30, "GET 200 https://h/api/items 3ms", "rid-1", {
        msgid: "req",
        lines: 2,
      }),
      rec(31, "tâche de fond terminée"),
    ],
  };
}

/** Une réponse JSON du faux back. */
const json = (body: unknown): Promise<Response> =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

let bar: DebugBar | null = null;
let fetchAvant: typeof window.fetch;

const shadow = (): ShadowRoot => {
  const host = document.getElementById("nodefony-debugbar");
  if (!host?.shadowRoot) throw new Error("barre non montée");
  return host.shadowRoot;
};
const q = (sel: string): HTMLElement => {
  const el = shadow().querySelector(sel);
  if (!(el instanceof HTMLElement)) throw new Error(`introuvable : ${sel}`);
  return el;
};
const visibles = (sel: string): HTMLElement[] =>
  [...shadow().querySelectorAll<HTMLElement>(sel)].filter((n) => !n.hidden);
/** Le rendu est regroupé à l'image suivante, les réponses arrivent en microtâches. */
const image = (): Promise<void> => new Promise((r) => setTimeout(r, 60));
const chemins = (): Array<string | null | undefined> =>
  visibles(".row.req").map((n) => n.querySelector(".path")?.textContent);
const ligneReq = (chemin: string): HTMLElement => {
  const row = visibles(".row.req").find(
    (n) => n.querySelector(".path")?.textContent === chemin,
  );
  if (!row) throw new Error(`requête absente : ${chemin}`);
  return row;
};
const textes = (sel: string): Array<string | null | undefined> =>
  visibles(sel).map((n) => n.querySelector(".txt")?.textContent);

function monter(opts: { page?: { requestId: string } } = {}): void {
  bar = new DebugBar({
    client: fakeClient(),
    network: true,
    open: true,
    ...opts,
  });
  bar.mount();
  q(".tab[data-tab='requests']").click();
}

beforeEach(() => {
  handlers = new Map();
  recherches = [];
  marques = [];
  profils = [];
  fetchAvant = window.fetch;
  window.fetch = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("/nodefony/profiler/api")) {
      profils.push(url);
      // Le profileur : les appels d'une socket, puis le profil de l'un d'eux.
      if (url.includes("/recent?connection=rid-ws"))
        return json({
          count: 1,
          entries: [
            {
              requestId: "rid-ws.1",
              ts: 1,
              kind: "ws",
              method: "GET",
              url: "/api/articles",
              status: 200,
              durationMs: 1.2,
              route: "articles.list",
              error: null,
            },
            // La console qui lit ses données par la même socket : l'outillage.
            {
              requestId: "rid-ws.3",
              ts: 3,
              kind: "ws",
              method: "GET",
              url: "/nodefony/kernel/api/info",
              status: 200,
              durationMs: 0.2,
              route: "admin.kernel.GET.info",
              error: null,
            },
            // Rendu APRÈS #1 : le profileur range par fin d'appel, pas par rang.
            {
              requestId: "rid-ws.2",
              ts: 2,
              kind: "ws",
              method: "GET",
              url: "/api/users",
              status: 200,
              durationMs: 0.3,
              route: "users.list",
              error: null,
            },
          ],
        });
      if (url.endsWith("/rid-ws.1"))
        return json({
          requestId: "rid-ws.1",
          ts: 1,
          kind: "ws",
          method: "GET",
          url: "/api/articles",
          status: 200,
          durationMs: 1.2,
          route: "articles.list",
          controller: "AdminApiController",
          action: "dispatch",
          user: "admin",
          error: null,
          phases: [{ name: "action", startMs: 0, durationMs: 1 }],
          queries: [{ sql: "select 1", startMs: 0, durationMs: 0.1 }],
        });
      return Promise.resolve(new Response("", { status: 404 }));
    }
    if (url.includes("/flux")) {
      return Promise.resolve(
        new Response("", {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "x-request-id": "rid-sse",
          },
        }),
      );
    }
    if (url.includes("/nodefony/syslog/api/logs/search")) {
      const p = new URL(url, "https://h").searchParams;
      recherches.push(p);
      marques.push(new Headers(init?.headers).get("x-request-id"));
      return Promise.resolve(
        new Response(JSON.stringify(repondre(p)), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "rid-1",
        },
      }),
    );
  };
  monter();
});

afterEach(() => {
  bar?.unmount?.();
  bar = null;
  window.fetch = fetchAvant;
  document.getElementById("nodefony-debugbar")?.remove();
  try {
    localStorage.clear();
  } catch {
    /* jsdom sans stockage */
  }
});

describe("vue Page — ce que la page est en train de faire", () => {
  it("🔴 les appels de la page ET le document, le plus récent en tête", async () => {
    await window.fetch("/api/items");
    await image();
    expect(chemins()).toEqual(["/api/items", location.pathname]);
    expect(ligneReq("/api/items").querySelector(".status")?.textContent).toBe(
      "200",
    );
  });

  it("🔴 déplier relit au serveur les lignes de CETTE requête (scope=trace)", async () => {
    await window.fetch("/api/items");
    await image();
    ligneReq("/api/items").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    await image();
    const lue = recherches.find((p) => p.get("requestId") === "rid-1");
    expect(lue?.get("scope")).toBe("trace");
    expect(ligneReq("/api/items").getAttribute("aria-expanded")).toBe("true");
    expect(textes(".row.log.child")).toEqual(["lecture des articles"]);
  });

  it("le chevron déplie et replie, sans choisir la ligne", async () => {
    await window.fetch("/api/items");
    await image();
    const chevron = (): HTMLElement => {
      const c = ligneReq("/api/items").querySelector(".chev");
      if (!(c instanceof HTMLElement)) throw new Error("pas de chevron");
      return c;
    };
    chevron().click();
    await image();
    expect(visibles(".row.log.child")).toHaveLength(1);
    expect(q("[data-el='logSide']").hidden).toBe(true);
    chevron().click();
    await image();
    expect(visibles(".row.log.child")).toHaveLength(0);
  });

  it("UN panneau : la requête, puis une de ses lignes", async () => {
    await window.fetch("/api/items");
    await image();
    ligneReq("/api/items").click();
    await image();
    const side = q("[data-el='logSide']");
    expect(side.hidden).toBe(false);
    expect(side.querySelector(".sidehead")?.textContent).toContain("Requête");
    expect(side.textContent).toContain("/api/items");
    ligneReq("/api/items").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    await image();
    visibles(".row.log.child")[0]?.click();
    await image();
    expect(side.querySelector(".sidehead")?.textContent).toContain(
      "Ligne serveur",
    );
    q("[data-el='logSide'] [data-act='close']").click();
    await image();
    expect(side.hidden).toBe(true);
  });

  it("🔴 le document retrouve son requestId par SA ligne d'accès dans les journaux", async () => {
    await image();
    ligneReq(location.pathname).click();
    await image();
    expect(recherches.some((p) => p.has("to"))).toBe(true);
    expect(profils.some((u) => u.endsWith("/rid-doc"))).toBe(true);
  });

  it("avec le requestId transmis au rendu, le document n'a rien à chercher", async () => {
    bar?.unmount?.();
    document.getElementById("nodefony-debugbar")?.remove();
    recherches = [];
    monter({ page: { requestId: "rid-page" } });
    await image();
    expect(recherches.some((p) => p.has("to"))).toBe(false);
    ligneReq(location.pathname).dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    await image();
    expect(textes(".row.log.child")).toEqual(["ligne de rid-page"]);
  });

  it("🔴 l'outillage de la page est masqué par défaut — compteurs compris — et la puce le montre", async () => {
    // La console qui lit ses données : ce qui sert à regarder, pas l'application.
    await window.fetch("/nodefony/kernel/api/modules");
    await window.fetch("/api/items");
    await image();
    expect(chemins()).not.toContain("/nodefony/kernel/api/modules");
    expect(chemins()).toContain("/api/items");
    // Les compteurs disent ce que la liste montre (document + /api/items).
    expect(q("[data-el='cReq']").textContent).toBe("2");
    const chip = q("[data-el='consoleChip']");
    expect(chip.hidden).toBe(false);
    // Jamais masqué en silence : la puce dit combien elle cache.
    expect(chip.textContent).toContain("· 1");
    chip.click();
    await image();
    expect(chemins()).toContain("/nodefony/kernel/api/modules");
    expect(q("[data-el='cReq']").textContent).toBe("3");
  });
});

/** WebSocket double : seul son contrat d'événements compte. */
class FakeWs extends EventTarget {
  readonly url: string;
  constructor(url: string | URL) {
    super();
    this.url = String(url);
  }
}

describe("vue Page — les WebSocket et les flux SSE de la page", () => {
  let wsAvant: typeof window.WebSocket;
  beforeEach(() => {
    // L'intercepteur prend la classe présente au montage : remonter sur la doublure.
    bar?.unmount?.();
    document.getElementById("nodefony-debugbar")?.remove();
    wsAvant = window.WebSocket;
    window.WebSocket = FakeWs as unknown as typeof window.WebSocket;
    monter();
  });
  afterEach(() => {
    bar?.unmount?.();
    window.WebSocket = wsAvant;
  });

  it("🔴 la socket partagée de la page s'y voit : WS, 101, ouvert, puis son code de fermeture", async () => {
    const ws = new window.WebSocket("wss://h/chat") as unknown as FakeWs;
    ws.dispatchEvent(new Event("open"));
    await image();
    const row = (): HTMLElement => ligneReq("/chat");
    expect(row().querySelector(".method")?.textContent).toBe("WS");
    expect(row().querySelector(".status")?.textContent).toBe("101");
    expect(row().querySelector(".dur")?.textContent).toBe("ouvert");
    ws.dispatchEvent(
      Object.assign(new Event("close"), { code: 1006, reason: "" }),
    );
    await image();
    expect(row().querySelector(".status")?.textContent).toBe("1006");
    expect(row().querySelector(".status")?.className).toContain("s5");
    expect(row().className).toContain("err");
  });

  it("🔴 choisie, la socket retrouve son requestId par SA ligne d'accès — et liste ses appels, pas un profil qu'elle n'a pas", async () => {
    const ws = new window.WebSocket("wss://h/chat") as unknown as FakeWs;
    ws.dispatchEvent(new Event("open"));
    await image();
    ligneReq("/chat").click();
    await image();
    // Ses appels, filtrés par le serveur ; jamais le profil de la connexion.
    expect(profils.some((u) => u.includes("/recent?connection=rid-ws"))).toBe(
      true,
    );
    expect(profils.some((u) => u.endsWith("/rid-ws"))).toBe(false);
    const appel = q("[data-el='logSide'] [data-frame='rid-ws.1']");
    expect(appel.textContent).toContain("articles.list");
    // L'appel de l'outillage passé par la même socket est masqué, et compté.
    expect(
      shadow().querySelector("[data-el='logSide'] [data-frame='rid-ws.3']"),
    ).toBeNull();
    expect(q("[data-el='logSide']").textContent).toContain(
      "1 appel de l'outillage masqué",
    );
    expect(appel.textContent).toContain("#1");
    expect(
      [
        ...q("[data-el='logSide']").querySelectorAll<HTMLElement>(
          "[data-frame]",
        ),
      ].map((b) => b.dataset.frame),
    ).toEqual(["rid-ws.2", "rid-ws.1"]);
    expect(ligneReq("/chat").getAttribute("aria-expanded")).toBe("false");
    // Les seules lignes d'accès de ce chemin, pas la fenêtre entière.
    const cherche = recherches.find((p) => p.get("q") === "/chat");
    expect(cherche?.get("msgid")).toBe("req");
    expect(cherche?.has("groupByRequest")).toBe(false);
    expect(q("[data-el='logSide']").textContent).toContain("ouvert");
  });

  it("🔴 un appel de la socket choisi : SON profil — phases et SQL — sous la liste", async () => {
    const ws = new window.WebSocket("wss://h/chat") as unknown as FakeWs;
    ws.dispatchEvent(new Event("open"));
    await image();
    ligneReq("/chat").click();
    await image();
    q("[data-el='logSide'] [data-frame='rid-ws.1']").click();
    await image();
    expect(profils.some((u) => u.endsWith("/rid-ws.1"))).toBe(true);
    const side = q("[data-el='logSide']");
    expect(side.querySelector(".wf-row")?.textContent).toContain("action");
    expect(side.querySelector(".q-row:not(.frame) .q-sql")?.textContent).toBe(
      "select 1",
    );
    expect(side.querySelector("[data-frame='rid-ws.1']")?.className).toContain(
      "sel",
    );
  });

  it("un flux SSE reçu par fetch : SSE, ouvert, puis sa durée de vie à l'abandon", async () => {
    const ctl = new AbortController();
    await window.fetch("/flux", { signal: ctl.signal });
    await image();
    const row = (): HTMLElement => ligneReq("/flux");
    expect(row().querySelector(".method")?.textContent).toBe("SSE");
    expect(row().querySelector(".dur")?.textContent).toBe("ouvert");
    ctl.abort();
    await image();
    expect(row().querySelector(".dur")?.textContent).toMatch(/ms$|s$/);
  });

  it("🔴 un flux SSE choisi ouvert ne réclame pas de profil — il le demande à sa fermeture (vécu : « profil introuvable, évincé du tampon »)", async () => {
    const ctl = new AbortController();
    await window.fetch("/flux", { signal: ctl.signal });
    await image();
    ligneReq("/flux").click();
    await image();
    // Le serveur prend un profil à la FIN de la requête : demandé ouvert, il
    // rendrait 404, que la barre lisait comme un tampon épuisé.
    expect(profils.some((u) => u.endsWith("/rid-sse"))).toBe(false);
    const side = (): string => q("[data-el='logSide']").textContent ?? "";
    expect(side()).toContain("flux ouvert");
    expect(side()).not.toContain("introuvable");
    ctl.abort();
    await image();
    expect(profils.some((u) => u.endsWith("/rid-sse"))).toBe(true);
  });
});

describe("la pause — elle fige ce qui ARRIVE, jamais ce que l'on fait", () => {
  const pause = (): void => q("[data-el='btnPause']").click();

  it("🔴 en pause, une requête qui arrive attend la reprise", async () => {
    await window.fetch("/api/items");
    await image();
    pause();
    await window.fetch("/api/autre");
    await image();
    expect(chemins()).not.toContain("/api/autre");
    pause();
    await image();
    expect(chemins()).toContain("/api/autre");
  });

  it("🔴 en pause, déplier une requête relit ses lignes et les montre", async () => {
    await window.fetch("/api/items");
    await image();
    pause();
    ligneReq("/api/items").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    await image();
    expect(ligneReq("/api/items").getAttribute("aria-expanded")).toBe("true");
    expect(textes(".row.log.child")).toEqual(["lecture des articles"]);
  });

  it("🔴 en pause, vider vide tout de suite — la reprise montre ce qui est arrivé APRÈS", async () => {
    await window.fetch("/api/items");
    await image();
    pause();
    q("[data-el='btnClearFeed']").click();
    await image();
    expect(chemins()).toEqual([]);
    await window.fetch("/api/apres");
    await image();
    expect(chemins()).toEqual([]);
    pause();
    await image();
    expect(chemins()).toEqual(["/api/apres"]);
  });
});

describe("vue Page — la plomberie de la barre n'y est pas", () => {
  it("🔴 le diagnostic de la socket de la barre (GET sur son adresse) n'est pas une requête de la page", async () => {
    // Vécu : une rafale de « GET /nodefony/studio/api/realtime ERR » dans la
    // vue Page — la socket de la barre qui se diagnostiquait à chaque échec.
    await window.fetch("/nodefony/studio/api/realtime");
    await window.fetch("/api/items");
    await image();
    expect(chemins()).not.toContain("/nodefony/studio/api/realtime");
    expect(chemins()).toContain("/api/items");
  });
});

describe("vue Journaux — la recherche groupée de la console", () => {
  it("🔴 une ligne par requête du serveur, et ses filtres partent au back", async () => {
    await window.fetch("/api/items");
    q("[data-flow='server']").click();
    await image();
    const groupee = recherches.find(
      (p) => p.get("groupByRequest") === "true" && !p.has("to"),
    );
    expect(groupee?.get("hideConsole")).toBe("true");
    expect(chemins()).toEqual(["/api/items"]);
    // L'appel du navigateur de même requestId enrichit la ligne du serveur.
    expect(ligneReq("/api/items").querySelector(".dur")?.textContent).toMatch(
      /ms$/,
    );
    expect(textes(".row.log")).toEqual(["tâche de fond terminée"]);
    expect(q("[data-el='consoleChip']").hidden).toBe(false);
  });
});

describe("vue Direct — les lignes en temps réel", () => {
  it("les lignes publiées s'affichent, la plus récente en haut", async () => {
    q("[data-flow='live']").click();
    const publier = handlers.get(PLATFORM_CHANNELS.syslog);
    if (!publier) throw new Error("la barre n'écoute pas le canal syslog");
    publier({ logs: [rec(1, "première"), rec(2, "seconde")] });
    await image();
    expect(textes(".row.log")).toEqual(["seconde", "première"]);
  });
});

describe("la barre ne s'observe pas elle-même", () => {
  const wait = (ms: number): Promise<void> =>
    new Promise((r) => setTimeout(r, ms));
  /** Les relectures de la vue Journaux (ni document, ni dépliage, ni socket). */
  const relectures = (): number =>
    recherches.filter(
      (p) =>
        p.get("groupByRequest") === "true" &&
        !p.has("to") &&
        !p.has("requestId"),
    ).length;

  it("🔴 les appels de la barre portent SON requestId — le serveur l'adopte", async () => {
    q("[data-flow='server']").click();
    await image();
    expect(marques.length).toBeGreaterThan(0);
    for (const m of marques) expect(m).toMatch(/^nf-tooling-[a-z0-9]+-\d+$/);
  });

  it("🔴 ses propres lignes ne relancent pas les Journaux (vécu : une relecture toutes les 1,5 s, sans fin) — celles de l'application, si", async () => {
    q("[data-flow='server']").click();
    await image();
    const publier = handlers.get(PLATFORM_CHANNELS.syslog);
    if (!publier) throw new Error("la barre n'écoute pas le canal syslog");
    const avant = relectures();
    publier({
      logs: [
        rec(
          50,
          "GET 200 /nodefony/syslog/api/logs/search",
          "nf-tooling-ab12cd-3",
        ),
      ],
    });
    await wait(1700);
    expect(relectures()).toBe(avant);
    publier({ logs: [rec(51, "commande enregistrée", "rid-app")] });
    await wait(1700);
    expect(relectures()).toBe(avant + 1);
  });

  it("dans le Direct, ses propres lignes ne s'affichent pas, même l'outillage montré", async () => {
    q("[data-flow='live']").click();
    q("[data-el='consoleChip']").click();
    const publier = handlers.get(PLATFORM_CHANNELS.syslog);
    if (!publier) throw new Error("la barre n'écoute pas le canal syslog");
    publier({
      logs: [
        rec(60, "relecture de la barre", "nf-tooling-ab12cd-4"),
        rec(61, "ligne de l'application"),
      ],
    });
    await image();
    expect(textes(".row.log")).toEqual(["ligne de l'application"]);
  });
});

describe("onglet Requêtes — accès", () => {
  it("les puces net, logs et err du bandeau mènent toutes à l'onglet Requêtes", () => {
    for (const chip of shadow().querySelectorAll(".chip.goto:not(.kchip)")) {
      const goto = chip.getAttribute("data-goto");
      if (goto === "realtime") continue; // la puce HMR mène au détail du front
      expect(goto).toBe("requests");
    }
  });

  it("un onglet Network ou Logs mémorisé rouvre l'onglet Requêtes", () => {
    bar?.unmount?.();
    document.getElementById("nodefony-debugbar")?.remove();
    localStorage.setItem("nf.debugbar.tab", "network");
    bar = new DebugBar({ client: fakeClient(), network: true, open: true });
    bar.mount();
    expect(q(".tab[data-tab='requests']").classList.contains("active")).toBe(
      true,
    );
  });
});

// Sans session, socket, journaux et profileur répondent 401 — et le
// navigateur écrit chaque échec dans la console de la PAGE, qu'aucun code ne
// peut taire. Vécu sur la page d'accueil d'une application : trois 401 à
// chaque ouverture de la barre. La barre lit l'identité d'abord.
describe("sans session administrateur — la barre ne tente rien qu'on lui refuserait", () => {
  let connexions = 0;
  let fetchDuBanc: typeof window.fetch;
  function monterAvec(user: unknown): void {
    bar?.unmount?.();
    document.getElementById("nodefony-debugbar")?.remove();
    // La barre du `beforeEach` général (avec session) a déjà lu : on ne
    // compte que ce que fait CELLE-CI.
    recherches.length = 0;
    profils.length = 0;
    connexions = 0;
    fetchDuBanc = window.fetch;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/auth/me")) return json({ user });
      return fetchDuBanc(input, init);
    };
    bar = new DebugBar({
      client: Object.assign(fakeClient(), {
        connect: () => {
          connexions++;
          return Promise.resolve();
        },
      }),
      network: true,
      open: true,
    });
    bar.mount();
    q(".tab[data-tab='requests']").click();
  }
  afterEach(() => {
    window.fetch = fetchDuBanc;
  });

  it("🔴 anonyme : ni socket, ni journaux, ni profileur — et la vue Journaux dit pourquoi", async () => {
    monterAvec(null);
    await image();
    q("[data-flow='server']").click();
    await image();
    expect(connexions, "socket").toBe(0);
    expect(recherches, "journaux").toHaveLength(0);
    expect(profils, "profileur").toHaveLength(0);
    expect(shadow().textContent).toContain("session administrateur");
  });

  it("connecté : la socket s'ouvre et les journaux se lisent, comme avant", async () => {
    monterAvec({ id: "u", identifier: "admin", roles: ["ROLE_ADMIN"] });
    await image();
    q("[data-flow='server']").click();
    await image();
    expect(connexions).toBe(1);
    expect(recherches.length).toBeGreaterThan(0);
  });
});
