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
  profils = [];
  fetchAvant = window.fetch;
  window.fetch = (input: RequestInfo | URL): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("/nodefony/profiler/api")) {
      profils.push(url);
      return Promise.resolve(new Response("", { status: 404 }));
    }
    if (url.includes("/nodefony/syslog/api/logs/search")) {
      const p = new URL(url, "https://h").searchParams;
      recherches.push(p);
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

  it("🔴 une requête de la page n'est JAMAIS masquée : pas de filtre console ici", async () => {
    await window.fetch("/nodefony/kernel/api/modules");
    await image();
    expect(chemins()).toContain("/nodefony/kernel/api/modules");
    expect(q("[data-el='consoleChip']").hidden).toBe(true);
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
