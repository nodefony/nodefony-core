/// <reference types="node" />
/**
 * E2E — la PRÉSENCE d'un canal (#760, ADR-0025), vue par le client du NAVIGATEUR,
 * contre le serveur de développement RÉEL.
 * Requires: server running on 5152 (wss). Start: /start-server
 *
 * Chemin exercé de bout en bout : WebSocket réelle (wss, cookie de session) →
 * `BrowserWsTransport` → `NodefonySocket` → `observePresence` → `PresenceView` du
 * cœur ; côté serveur : pare-feu (zone `test-live`, session puis anonyme), identité
 * résolue, politique `@RealtimeChannel("live:room:*", { presence: true })`
 * (`LiveSalonController.room`), hub, fenêtre de 250 ms, trame `realtime:presence`.
 * Les tests unitaires prouvent chaque maillon sur un faux ; ici, ils doivent
 * s'accorder.
 *
 * Seule différence avec un navigateur, de DÉCOR : Node n'a pas de pot à cookies.
 * Chaque « navigateur » pose son cookie sur la globale `WebSocket` au moment où il
 * ouvre sa socket (le transport la lit à `connect()`), comme
 * `client-isomorphe-e2e.test.ts`. Les reconnexions réelles ne sont donc exercées
 * qu'avec UN seul compte en jeu.
 *
 * Règles du banc : on attend un FAIT (une vue), jamais une durée ; une absence se
 * prouve par un témoin (un présent qui, lui, est vu).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import https from "node:https";
import { randomUUID } from "node:crypto";
import WS from "ws";
import { trustDevAuthority } from "../helpers/devAuthority";
import {
  NodefonySocket,
  observePresence,
  type IPresenceSnapshot,
} from "nodefony/client";

const BASE = { hostname: "127.0.0.1", port: 5152 };
const LOGIN = "/nodefony/security/api/auth/login";
const HUB = "wss://127.0.0.1:5152/api/live/realtime";
/** Mot de passe de développement des comptes seedés (`DEV_FIXTURE_PASSWORD` de l'app). */
const DEV_PASSWORD = "secret-de-dev-42";
const TIMEOUT = 20_000;

/**
 * Ouvre une session par le login réel ; rend le cookie à rejouer. Le mot de passe
 * suit celui que l'application a seedé : ses variables, sinon le défaut de dev.
 */
function login(username: "admin" | "user"): Promise<string> {
  const password =
    (username === "admin"
      ? process.env.NF_ADMIN_PASSWORD
      : process.env.NF_USER_PASSWORD) ?? DEV_PASSWORD;
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({ username, password }));
    const req = https.request(
      {
        ...BASE,
        path: LOGIN,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(body.length),
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          const set = res.headers["set-cookie"];
          const first = Array.isArray(set) ? set[0] : set;
          if (res.statusCode !== 200 || typeof first !== "string") {
            reject(new Error(`login ${username} : HTTP ${res.statusCode}`));
            return;
          }
          resolve(first.split(";")[0] ?? "");
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

/** Un « onglet » : sa socket, et ce que son écran affiche de la salle. */
interface ITab {
  socket: NodefonySocket;
  views: IPresenceSnapshot[];
  view: () => IPresenceSnapshot;
  close: () => void;
}

const tabs: ITab[] = [];

/**
 * Ouvre un onglet sur la salle `room` — avec le cookie `cookie`, ou anonyme
 * (`null`). Rend quand le welcome a annoncé l'identité.
 */
async function openTab(cookie: string | null, room: string): Promise<ITab> {
  class CookieWebSocket extends WS {
    constructor(url: string) {
      super(url, { headers: cookie === null ? {} : { cookie } });
    }
  }
  (globalThis as { WebSocket?: unknown }).WebSocket = CookieWebSocket;
  const socket = new NodefonySocket({ url: HUB, probe: false });
  const views: IPresenceSnapshot[] = [];
  const release = observePresence(socket, room, (s) => views.push(s));
  await socket.connect();
  await until("identité annoncée", () => socket.identity !== null);
  const tab: ITab = {
    socket,
    views,
    // L'écran affiche ce qui lui a été POUSSÉ (le dernier instantané reçu par
    // `observePresence`), comme une liaison Vue, Svelte ou Angular — jamais une
    // lecture tirée de la socket, qui passerait même si l'annonce manquait.
    view: () => views.at(-1) ?? socket.presence(room),
    close: () => {
      release();
      socket.disconnect();
    },
  };
  tabs.push(tab);
  return tab;
}

/** Attend qu'une condition devienne vraie, ou échoue en le DISANT. */
async function until(
  what: string,
  predicate: () => boolean,
  ms = 8000,
  instead: () => string = () => "",
): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`jamais observé en ${ms} ms : ${what}\n${instead()}`);
}

/** Ce qu'un écran affiche : présents nommés (identité → onglets), triés. */
function shown(s: IPresenceSnapshot): Record<string, number> {
  return Object.fromEntries(
    [...s.members]
      .map(([id, e]): [string, number] => [id, e.tabs])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** Identité de compte d'un onglet — la clé sous laquelle les autres le voient. */
function idOf(tab: ITab): string {
  const id = tab.socket.identity?.id;
  if (typeof id !== "string") throw new Error("onglet sans identité de compte");
  return id;
}

/** Attend que l'écran de `tab` affiche exactement `members` et `unnamed`, vue complète. */
function screenShows(
  tab: ITab,
  members: Record<string, number>,
  unnamed: number,
): Promise<void> {
  const sorted = Object.fromEntries(
    Object.entries(members).sort(([a], [b]) => a.localeCompare(b)),
  );
  const want = JSON.stringify({
    members: sorted,
    unnamed,
    ready: true,
    partial: false,
  });
  const seen = (): string => {
    const s = tab.view();
    return JSON.stringify({
      members: shown(s),
      unnamed: s.unnamed,
      ready: s.ready,
      partial: s.partial,
    });
  };
  return until(
    `l'écran affiche ${want}`,
    () => seen() === want,
    8000,
    () =>
      `affiché : ${seen()} — trames reçues : ${tab.views.length}, état : ${tab.socket.state}`,
  );
}

let restoreTrust: (() => void) | null = null;
let adminCookie = "";
let userCookie = "";

beforeAll(async () => {
  restoreTrust = trustDevAuthority();
  adminCookie = await login("admin");
  userCookie = await login("user");
}, TIMEOUT);

afterEach(() => {
  for (const tab of tabs.splice(0)) tab.close();
});

afterAll(() => {
  restoreTrust?.();
});

describe("E2E présence — le client du navigateur contre le serveur réel (#760)", () => {
  it(
    "🔴 deux comptes, deux onglets du même, un anonyme : chaque écran affiche la MÊME salle",
    async () => {
      const room = `live:room:${randomUUID()}`;
      const admin1 = await openTab(adminCookie, room);
      const admin2 = await openTab(adminCookie, room);
      const user = await openTab(userCookie, room);
      const anon = await openTab(null, room);
      const expected = { [idOf(admin1)]: 2, [idOf(user)]: 1 };
      for (const tab of [admin1, admin2, user, anon])
        await screenShows(tab, expected, 1);
      // Un compte = UN présent, quel que soit son nombre d'onglets.
      expect(user.view().count).toBe(2);
      // L'état neutre a précédé la liste : « vide » ≠ « pas encore reçu ».
      expect(user.views[0]?.ready).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "🔴 les départs — un onglet fermé, l'anonyme parti, le dernier onglet d'un compte — atteignent les autres écrans",
    async () => {
      const room = `live:room:${randomUUID()}`;
      const admin1 = await openTab(adminCookie, room);
      const admin2 = await openTab(adminCookie, room);
      const user = await openTab(userCookie, room);
      const anon = await openTab(null, room);
      const a = idOf(admin1);
      const u = idOf(user);
      await screenShows(user, { [a]: 2, [u]: 1 }, 1);
      admin2.close();
      await screenShows(user, { [a]: 1, [u]: 1 }, 1);
      anon.close();
      await screenShows(user, { [a]: 1, [u]: 1 }, 0);
      admin1.close();
      // Absence prouvée par un témoin : l'écran de `user` se voit toujours lui-même.
      await screenShows(user, { [u]: 1 }, 0);
    },
    TIMEOUT,
  );

  it(
    "🔴 reconnexion réelle : la vue reste affichée FIGÉE (partial), puis la liste de la nouvelle connexion la refonde",
    async () => {
      const room = `live:room:${randomUUID()}`;
      const user = await openTab(userCookie, room);
      const u = idOf(user);
      await screenShows(user, { [u]: 1 }, 0);
      const before = user.views.length;
      // Coupure réseau sans fermeture propre : seul le transport le sait.
      const internal = user.socket as unknown as {
        transport: { ws: { terminate(): void } };
      };
      internal.transport.ws.terminate();
      await until("vue figée pendant la coupure", () =>
        user.views.slice(before).some((s) => s.partial && shown(s)[u] === 1),
      );
      await screenShows(user, { [u]: 1 }, 0);
    },
    TIMEOUT,
  );
});
