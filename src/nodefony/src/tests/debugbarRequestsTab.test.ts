/**
 * L'onglet « Requêtes » MANIPULÉ (#665) : une requête vue par le navigateur
 * et la ligne que le serveur a écrite pour elle arrivent par deux chemins
 * distincts — l'intercepteur `fetch` et le canal syslog — et se retrouvent sur
 * UNE ligne, qui se déplie au clavier et ouvre UN panneau de détail.
 *
 * Aucun réseau : `fetch` et la socket sont des doubles.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DebugBar } from "../client/debugbar/DebugBar";
import type { NodefonySocket } from "../client/realtime/NodefonySocket";
import { PLATFORM_CHANNELS } from "../realtime/platformChannels";

type Handler = (...args: unknown[]) => void;
let handlers: Map<string, Handler>;

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
/** Le rendu est regroupé à l'image suivante. */
const image = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

/** Une ligne serveur telle que le canal syslog la publie. */
const ligne = (uid: number, payload: string, requestId?: string) => ({
  payload,
  severity: 6,
  severityName: "INFO",
  moduleName: "app",
  msgid: "",
  timeStamp: 1_700_000_000_000 + uid,
  uid,
  pid: 1,
  ...(requestId === undefined ? {} : { requestId }),
});

beforeEach(() => {
  handlers = new Map();
  fetchAvant = window.fetch;
  // Le serveur répond avec son identifiant de requête ; le profileur n'a rien.
  window.fetch = (input: RequestInfo | URL): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("/nodefony/profiler/api"))
      return Promise.resolve(new Response("", { status: 404 }));
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
  bar = new DebugBar({ client: fakeClient(), network: true, open: true });
  bar.mount();
  q(".tab[data-tab='requests']").click();
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

/** Une requête du navigateur, puis deux lignes serveur : l'une à elle, l'autre orpheline. */
async function scenario(): Promise<void> {
  await window.fetch("/api/items");
  const publier = handlers.get(PLATFORM_CHANNELS.syslog);
  if (!publier) throw new Error("la barre n'écoute pas le canal syslog");
  publier({
    logs: [
      ligne(1, "lecture des articles", "rid-1"),
      ligne(2, "tâche de fond terminée"),
    ],
  });
  await image();
}

describe("onglet Requêtes — une requête et ses lignes serveur", () => {
  it("🔴 la requête du navigateur porte sa ligne serveur ; l'orpheline reste dans le flux", async () => {
    await scenario();
    const reqs = visibles(".row.req");
    expect(reqs).toHaveLength(1);
    const req = reqs[0];
    expect(req?.querySelector(".path")?.textContent).toBe("/api/items");
    expect(req?.querySelector(".status")?.textContent).toBe("200");
    expect(req?.querySelector(".count")?.textContent).toBe("1 ligne");
    expect(req?.getAttribute("aria-expanded")).toBe("false");
    // Repliée : seule l'orpheline est une ligne serveur affichée.
    const logs = visibles(".row.log");
    expect(logs.map((n) => n.querySelector(".txt")?.textContent)).toEqual([
      "tâche de fond terminée",
    ]);
    expect(logs[0]?.classList.contains("child")).toBe(false);
  });

  it("→ déplie la requête : sa ligne serveur la suit, en retrait", async () => {
    await scenario();
    const req = q(".row.req");
    req.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    await image();
    expect(q(".row.req").getAttribute("aria-expanded")).toBe("true");
    const enfants = visibles(".row.log.child");
    expect(enfants.map((n) => n.querySelector(".txt")?.textContent)).toEqual([
      "lecture des articles",
    ]);
    expect(enfants[0]?.getAttribute("aria-level")).toBe("2");
  });

  it("le chevron déplie et replie, sans choisir la ligne", async () => {
    await scenario();
    q(".row.req .chev").click();
    await image();
    expect(visibles(".row.log.child")).toHaveLength(1);
    expect(q("[data-el='logSide']").hidden).toBe(true);
    q(".row.req .chev").click();
    await image();
    expect(visibles(".row.log.child")).toHaveLength(0);
  });

  it("UN panneau de détail : la requête, puis la ligne serveur", async () => {
    await scenario();
    q(".row.req").click();
    await image();
    const side = q("[data-el='logSide']");
    expect(side.hidden).toBe(false);
    expect(side.querySelector(".sidehead")?.textContent).toContain("Requête");
    expect(side.textContent).toContain("GET");
    expect(side.textContent).toContain("/api/items");
    const orpheline = visibles(".row.log")[0];
    orpheline?.click();
    await image();
    expect(side.querySelector(".sidehead")?.textContent).toContain(
      "Ligne serveur",
    );
    expect(side.textContent).toContain("tâche de fond terminée");
    q("[data-el='logSide'] [data-act='close']").click();
    await image();
    expect(side.hidden).toBe(true);
  });

  it("la recherche d'un message DÉPLIE la requête qui le porte", async () => {
    await scenario();
    const search = q("[data-el='logSearch']");
    if (!(search instanceof HTMLInputElement)) throw new Error("pas un champ");
    search.value = "articles";
    search.dispatchEvent(new Event("input"));
    await image();
    expect(visibles(".row.req")).toHaveLength(1);
    expect(
      visibles(".row.log").map((n) => n.querySelector(".txt")?.textContent),
    ).toEqual(["lecture des articles"]);
  });

  it("🔴 une requête de la CONSOLE se masque par son chemin, même sans ligne d'accès", async () => {
    // Une requête réussie n'écrit plus de ligne d'accès : seul le navigateur
    // voit son chemin. Masquer la console doit l'emporter quand même.
    await window.fetch("/nodefony/kernel/api/modules");
    await scenario();
    const chemins = () =>
      visibles(".row.req").map((n) => n.querySelector(".path")?.textContent);
    expect(chemins()).toEqual(["/api/items"]);
    q(".sevf[data-view='console']").click();
    await image();
    expect(chemins()).toEqual(["/api/items", "/nodefony/kernel/api/modules"]);
  });

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
    const autre = new DebugBar({
      client: fakeClient(),
      network: true,
      open: true,
    });
    autre.mount();
    bar = autre;
    expect(q(".tab[data-tab='requests']").classList.contains("active")).toBe(
      true,
    );
  });
});
