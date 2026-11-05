/**
 * La barre de débogage RELIT la session après une connexion — sans recharger.
 *
 * Le défaut fermé (#719) : la première lecture d'identité (`/auth/me` →
 * `{ user: null }`) était mémorisée pour toute la vie de la page. Connecté
 * ensuite (dans la console, un autre onglet, après un redémarrage du serveur),
 * l'administrateur voyait encore « réservé aux administrateurs » sur les
 * Journaux et un 401 au détail d'une requête — un 401 que la barre FABRIQUAIT
 * elle-même, sans appeler le serveur. Seul un rechargement rétablissait tout.
 *
 * Aucun réseau : la socket est un double, `fetch` répond selon un état que le
 * test bascule.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DebugBar } from "../client/debugbar/DebugBar";
import type { NodefonySocket } from "../client/realtime/NodefonySocket";
import { AUTH_ME_PATH } from "../runtime/authRoutes";

const SYSLOG = "/nodefony/syslog/api/logs/search";

let connexions = 0;
const fakeClient = (): NodefonySocket =>
  ({
    state: "disconnected",
    on: () => () => {},
    off: () => {},
    onState: () => () => {},
    onIdentity: () => () => {},
    onNotice: () => () => {},
    onStats: () => () => {},
    onReconnect: () => () => {},
    subscribe: () => {},
    unsubscribe: () => {},
    connect: () => {
      connexions++;
      return Promise.resolve();
    },
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
let connecte = false;
/** Chemins réellement partis au « serveur », dans l'ordre. */
let appels: string[] = [];
const fetchAvant = window.fetch;

const q = (sel: string): HTMLElement => {
  const el = document
    .getElementById("nodefony-debugbar")
    ?.shadowRoot?.querySelector(sel);
  if (!el) throw new Error(`introuvable : ${sel}`);
  return el as HTMLElement;
};
const tour = (): Promise<void> => new Promise((r) => setTimeout(r, 60));
const serveurLu = (): number =>
  appels.filter((u) => u.startsWith(SYSLOG)).length;

beforeEach(() => {
  connecte = false;
  appels = [];
  connexions = 0;
  window.fetch = (input: RequestInfo | URL): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    appels.push(url);
    if (url.startsWith("/nodefony/profiler/api/")) {
      return Promise.resolve(
        Response.json({
          requestId: "rid-x",
          ts: 1,
          method: "GET",
          url: "/api/x",
          status: 200,
          durationMs: 1,
          route: "profil-lu",
          error: null,
          phases: [],
          queries: [],
        }),
      );
    }
    if (url === "/api/x") {
      return Promise.resolve(
        new Response("{}", {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": "rid-x",
          },
        }),
      );
    }
    // Recherche de la ligne d'accès du DOCUMENT (fenêtre `from`/`to`).
    if (url.startsWith(SYSLOG) && url.includes("to=")) {
      return Promise.resolve(
        Response.json({
          result: {
            rows: [
              {
                uid: 1,
                severity: 6,
                severityName: "INFO",
                moduleName: "app",
                msgid: "req",
                msg: "",
                timeStamp: 1_700_000_000_000,
                pid: 1,
                payload: `GET 200 https://h${location.pathname} 3ms`,
                requestId: "rid-doc",
              },
            ],
          },
        }),
      );
    }
    if (url.startsWith(AUTH_ME_PATH)) {
      const user = connecte ? { id: "1", roles: ["ROLE_ADMIN"] } : null;
      return Promise.resolve(Response.json({ user }));
    }
    return Promise.resolve(Response.json({ items: [], total: 0 }));
  };
  bar = new DebugBar({ client: fakeClient(), network: true, open: true });
  bar.mount();
  // Les Journaux vivent dans l'onglet Requêtes.
  q(".tab[data-tab='requests']").click();
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

describe("session — un NON se relit, seul le OUI se mémorise (#719)", () => {
  it("🔴 page ouverte déconnectée, connexion ensuite : les Journaux partent au serveur SANS recharger", async () => {
    // Panneau ouvert sans session : aucune lecture des Journaux ne part, la
    // barre se dit le 401 elle-même (la console de la page reste muette).
    q("[data-flow='server']").click();
    await tour();
    expect(serveurLu()).toBe(0);
    expect(connexions).toBe(0);

    // Connexion faite ailleurs : le panneau reste ouvert, on ne recharge rien.
    connecte = true;
    q("[data-flow='page']").click();
    q("[data-flow='server']").click();
    await tour();
    expect(serveurLu()).toBeGreaterThan(0);
    // Le refus que la barre s'était dit tombe : la socket s'ouvre aussi.
    expect(connexions).toBe(1);
  });

  it("un OUI se mémorise : une seule lecture d'identité pour plusieurs appels", async () => {
    // Le montage, panneau ouvert, a déjà lu un NON : on compte à partir d'ici.
    await tour();
    connecte = true;
    appels = [];
    q("[data-flow='server']").click();
    await tour();
    q("[data-flow='page']").click();
    q("[data-flow='server']").click();
    await tour();
    expect(appels.filter((u) => u.startsWith(AUTH_ME_PATH))).toHaveLength(1);
    expect(serveurLu()).toBeGreaterThan(1);
  });

  it("🔴 le détail d'une requête refusé AVANT la connexion se relit APRÈS, sans la rechoisir", async () => {
    // Un appel de l'application, choisi sans session : son profil est refusé.
    await window.fetch("/api/x");
    await tour();
    const ligne = [
      ...(document
        .getElementById("nodefony-debugbar")
        ?.shadowRoot?.querySelectorAll<HTMLElement>(".row.req") ?? []),
    ].find((r) => r.querySelector(".path")?.textContent === "/api/x");
    if (!ligne) throw new Error("requête /api/x absente");
    ligne.click();
    await tour();
    const volet = (): string => q("[data-el='logSide']").textContent ?? "";
    expect(volet()).toContain("réservé à une session administrateur");
    const profilsAvant = appels.filter((u) =>
      u.startsWith("/nodefony/profiler/api/"),
    ).length;
    expect(profilsAvant).toBe(0); // le 401 était fabriqué : rien n'est parti

    // Connexion ailleurs ; le panneau se replie puis se rouvre, la requête
    // reste choisie — son profil se relit sans qu'on le redemande.
    connecte = true;
    q("[data-el='btnToggle']").click();
    q("[data-el='btnToggle']").click();
    await tour();
    expect(volet()).not.toContain("réservé à une session administrateur");
    expect(volet()).toContain("profil-lu");
  });

  it("🔴 le DOCUMENT, dont le requestId se cherche dans les Journaux, le retrouve après la connexion", async () => {
    // Sans session, la recherche de sa ligne d'accès n'a rien pu lire.
    const ligne = [
      ...(document
        .getElementById("nodefony-debugbar")
        ?.shadowRoot?.querySelectorAll<HTMLElement>(".row.req") ?? []),
    ].find((r) => r.querySelector(".path")?.textContent === location.pathname);
    if (!ligne) throw new Error("document absent de la vue Page");
    ligne.click();
    await tour();
    const volet = (): string => q("[data-el='logSide']").textContent ?? "";
    expect(volet()).toContain("requestId inconnu");

    connecte = true;
    q("[data-el='btnToggle']").click();
    q("[data-el='btnToggle']").click();
    await tour();
    await tour();
    expect(volet()).not.toContain("requestId inconnu");
    expect(volet()).toContain("profil-lu");
  });
});
