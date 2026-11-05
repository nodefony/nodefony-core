/**
 * L'onglet Runtime de la barre — le résumé de la page « Runtime & Lancement »
 * de la console, lu aux MÊMES sources, une fois à l'ouverture.
 *
 * Aucun réseau : la socket est un double, `fetch` répond des charges réelles
 * relevées sur l'application de développement.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DebugBar } from "../client/debugbar/DebugBar";
import { fakeSocket } from "./debugbarFakeSocket";
import { AUTH_ME_PATH } from "../runtime/authRoutes";
import { runtimeMode } from "../runtime/runtimeMode";

const SOURCES = [
  "/nodefony/kernel/api/info",
  "/nodefony/realtime/api/health",
  "/nodefony/frontend/api/vite",
  "/nodefony/kernel/api/processes",
];

const INFO = {
  version: "10.0.0",
  environment: "development",
  debug: false,
  domain: "127.0.0.1",
  pid: 64540,
  node: "v26.13.0",
  platform: "darwin",
  uptime: 261.5,
  modules: 17,
  git: { branch: "dev", commit: "fe9a8c7" },
};
const HEALTH = {
  instanceId: "64540",
  process: {
    pid: 64540,
    cpuPercent: 7,
    eventLoopMs: 0.53,
    eventLoopMaxMs: 38.13,
    rss: 276_819_968,
    heapUsed: 102_474_432,
    heapTotal: 110_088_192,
    heapLimit: 4_395_630_592,
    external: 26_785_266,
  },
};
const VITE = {
  available: true,
  vite: "8.3.5",
  bundles: [
    {
      family: "default",
      state: "ready",
      origin: "http://127.0.0.1:5173",
      restartCount: 0,
      entries: [
        { entryName: "test-frontend-react", type: "react19" },
        { entryName: "studio", type: "react19" },
        { entryName: "test-frontend-svelte", type: "svelte5" },
      ],
    },
  ],
};
const procs = (devMode: boolean) => ({
  devMode,
  supported: true,
  running: devMode,
  processes: devMode
    ? [
        {
          pid: 85735,
          role: "supervisor",
          rssKb: 116_876,
          cpu: 0,
          uptimeSec: 4918,
        },
        {
          pid: 64540,
          role: "server",
          rssKb: 270_336,
          cpu: 1.2,
          uptimeSec: 262,
        },
      ]
    : [],
  ports: [
    { port: 5151, listening: true },
    { port: 5152, listening: true },
  ],
  warnings: [],
});

let bar: DebugBar | null = null;
let connecte = true;
let devMode = true;
let appels: string[] = [];
const fetchAvant = window.fetch;

const q = (sel: string): HTMLElement => {
  const el = document
    .getElementById("nodefony-debugbar")
    ?.shadowRoot?.querySelector(sel);
  if (!el) throw new Error(`introuvable : ${sel}`);
  return el as HTMLElement;
};
const texte = (sel: string): string => q(sel).textContent ?? "";
const tour = (): Promise<void> => new Promise((r) => setTimeout(r, 60));
const lus = (url: string): number => appels.filter((u) => u === url).length;

beforeEach(() => {
  connecte = true;
  devMode = true;
  appels = [];
  window.fetch = (input: RequestInfo | URL): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    appels.push(url);
    if (url.startsWith(AUTH_ME_PATH))
      return Promise.resolve(
        Response.json({
          user: connecte ? { id: "1", roles: ["ROLE_ADMIN"] } : null,
        }),
      );
    const body =
      url === SOURCES[0]
        ? INFO
        : url === SOURCES[1]
          ? HEALTH
          : url === SOURCES[2]
            ? VITE
            : url === SOURCES[3]
              ? procs(devMode)
              : { items: [] };
    return Promise.resolve(Response.json(body));
  };
  bar = new DebugBar({ client: fakeSocket({}), network: true, open: true });
  bar.mount();
});
afterEach(() => {
  bar?.unmount?.();
  bar = null;
  document.getElementById("nodefony-debugbar")?.remove();
  window.fetch = fetchAvant;
  try {
    localStorage.clear();
  } catch {
    /* jsdom sans stockage */
  }
});

const ouvrirRuntime = async (): Promise<void> => {
  q(".tab[data-tab='runtime']").click();
  await tour();
  await tour();
};

describe("onglet Runtime — le résumé de la page Runtime de la console", () => {
  it("🔴 l'ouverture lit les quatre sources de la console, et les montre en mots", async () => {
    await ouvrirRuntime();
    for (const url of SOURCES) expect(lus(url)).toBe(1);
    const srv = texte("[data-el='rSrv']");
    expect(srv).toContain("Développement · Vite / HMR");
    expect(srv).toContain("process unique (Vite intégré)");
    expect(srv).toContain("v26.13.0 · darwin");
    expect(srv).toContain("dev @ fe9a8c7");
    const proc = texte("[data-el='rProc']");
    expect(proc).toContain("superviseur");
    expect(proc).toContain("85735");
    expect(proc).toContain("5152");
    expect(texte("[data-el='rProcN']")).toBe("2");
    expect(texte("[data-el='rVite']")).toContain("react19 ×2 · svelte5");
  });

  it("🔴 jamais en boucle : rester sur l'onglet ne relit rien ; le rouvrir relit", async () => {
    await ouvrirRuntime();
    await tour();
    await tour();
    expect(lus(SOURCES[3] ?? "")).toBe(1);
    q(".tab[data-tab='perf']").click();
    await ouvrirRuntime();
    expect(lus(SOURCES[3] ?? "")).toBe(2);
    q("[data-el='btnRtRead']").click();
    await tour();
    expect(lus(SOURCES[3] ?? "")).toBe(3);
  });

  it("🔴 Temps réel éteint : la charge est le relevé de l'ouverture, DATÉ — pas un zéro muet", async () => {
    await ouvrirRuntime();
    const charge = texte("[data-el='rLoad']");
    expect(charge).toContain("7 %");
    expect(charge).toContain("0.53 ms · pic 38.13 ms");
    expect(charge).toContain("Relevée à");
  });

  it("🔴 sans session administrateur : une phrase, et aucune source n'est appelée", async () => {
    connecte = false;
    bar?.unmount?.();
    document.getElementById("nodefony-debugbar")?.remove();
    bar = new DebugBar({ client: fakeSocket({}), network: true, open: true });
    bar.mount();
    appels = [];
    await ouvrirRuntime();
    for (const url of SOURCES) expect(lus(url)).toBe(0);
    expect(q("[data-el='rDenied']").hidden).toBe(false);
    expect(q("[data-el='rGrid']").hidden).toBe(true);
  });

  it("production : la carte Process le dit au lieu d'une table vide", async () => {
    devMode = false;
    await ouvrirRuntime();
    expect(texte("[data-el='rProc']")).toContain(
      "Production : un process unique",
    );
  });

  it("les préférences gardées se lisent en français, la clé en bulle", async () => {
    await ouvrirRuntime();
    const pref = texte("[data-el='rPref']");
    expect(pref).toContain("onglet ouvert");
    expect(pref).toContain("hauteur du panneau");
  });
});

describe("runtimeMode — la règle unique de la console et de la barre", () => {
  it("un instantané de cluster tranche avant l'environnement", () => {
    const m = runtimeMode("development", 4);
    expect(m.id).toBe("cluster");
    expect(m.processes).toBe(4);
    expect(m.vite).toBe(false);
  });
  it("développement : Vite intégré ; tout autre environnement : production", () => {
    expect(runtimeMode("development", null).vite).toBe(true);
    expect(runtimeMode("staging", null).id).toBe("production");
  });
});
