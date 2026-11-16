/**
 * La carte « Socket » de la barre de debug (#783) : lignes clé/valeur du cœur,
 * en-tête qui porte adresse, état et format, et le TABLEAU des canaux tenus
 * avec leur présence — lue par la règle du cœur (`describePresence`), sur une
 * vraie vue (`PresenceView`) derrière la socket double.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from "vitest";
import { DebugBar } from "../client/debugbar/DebugBar";
import { NodefonySocket } from "../client/realtime/NodefonySocket";
import { PresenceView } from "../realtime/presenceView";
import type { SocketPresenceStatus } from "../client/realtime/snapshot";
import { fakeSocket } from "./debugbarFakeSocket";

let bar: DebugBar | null = null;

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
/** Le rendu est regroupé à l'image suivante. */
const image = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

/** La socket de la barre : une vraie, sur un transport qui ne s'ouvre jamais. */
const barSocket = (): NodefonySocket =>
  new NodefonySocket({ url: "ws://loopback/realtime" }, () => ({
    readyState: 0,
    connect: () => {},
    send: () => {},
    close: () => {},
    onOpen: () => {},
    onMessage: () => {},
    onClose: () => {},
    onError: () => {},
  }));

afterEach(() => {
  bar?.unmount?.();
  bar = null;
  Reflect.deleteProperty(globalThis, "__nfSockets__");
  document.getElementById("nodefony-debugbar")?.remove();
});

describe("carte Socket — présence et lignes clé/valeur", () => {
  it("🔴 chaque canal tenu dit sa présence : suivie, non suivie, absente", async () => {
    const salon = new PresenceView("chat:room:salon");
    salon.apply({
      channel: "chat:room:salon",
      version: 4,
      count: 2,
      unnamed: 0,
      // La présence nomme par IDENTIFIANT : le lecteur (u1) se reconnaît,
      // l'autre compte est un UUID raccourci.
      members: ["u1", 1, "0f3a2b1c-047b-4e20-a0e9-a0abc1e80d42", 2],
    });
    const statuses: Record<string, SocketPresenceStatus> = {
      "chat:room:salon": {
        kind: "followed",
        view: salon.snapshot(),
        version: salon.reference,
      },
      "chat:online": { kind: "unfollowed" },
    };
    const app = fakeSocket({
      url: "wss://h/demo/chat/realtime",
      state: "connected",
      subscribedChannels: [
        "chat:room:salon",
        "user:cc644966-047b-4e20-a0e9-a0abc1e80c7a",
        "chat:online",
      ],
      serverChannels: ["chat:room:*", "chat:online"],
      serverMethods: ["api.request"],
      identity: {
        type: "session",
        authenticated: true,
        id: "u1",
        userIdentifier: "admin",
        roles: ["ROLE_ADMIN", "ROLE_DEV"],
        scopes: [],
      },
      presenceStatus: (c: string): SocketPresenceStatus =>
        statuses[c] ?? { kind: "none" },
    });
    Reflect.set(globalThis, "__nfSockets__", new Set([app]));
    bar = new DebugBar({ client: barSocket(), network: false, open: true });
    bar.mount();
    q(".tab[data-tab='socket']").click();
    await image();

    const rows = [
      ...shadow().querySelectorAll("[data-el='skChannels'] tr"),
    ].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
    expect(rows).toEqual([
      [
        "chat:room:salon",
        "admin (vous), 0f3a…d42 (2 onglets) · 0 anonyme",
        "v4",
      ],
      ["user:cc64…c7a", "sans présence", ""],
      ["chat:online", "présence non suivie par la page", ""],
    ]);
    // Le nom entier reste au survol.
    expect(
      shadow()
        .querySelector("[data-el='skChannels'] tr:nth-child(2) td.c")
        ?.getAttribute("title"),
    ).toBe("user:cc644966-047b-4e20-a0e9-a0abc1e80c7a");
    expect(q("[data-el='skChN']").textContent).toBe("(3)");

    // Clé/valeur : l'en-tête porte adresse, état et format — pas de doublon.
    const labels = [
      ...shadow().querySelectorAll("[data-el='skRows'] .kv .k"),
    ].map((k) => k.textContent);
    expect(labels).toEqual([
      "identité",
      "canaux offerts",
      "actions",
      "notifications reçues",
      "trames perdues",
      "dernière notification",
      "journal",
    ]);
    expect(q("[data-el='skState']").textContent).toContain("connecté");
    const v = (label: string): string | null | undefined =>
      [...shadow().querySelectorAll("[data-el='skRows'] .kv")]
        .find((kv) => kv.querySelector(".k")?.textContent === label)
        ?.querySelector(".v")?.textContent;
    // Les rôles passent dans la bulle du libellé : la ligne ne se coupe plus.
    expect(v("identité")).toBe("admin · session · 2 rôles");
    expect(v("trames perdues")).toBe("aucune perte");
  });

  it("aller-retour non offert : la phrase courte, et pas de bouton « mesurer »", async () => {
    const app = fakeSocket({
      url: "wss://h/demo/chat/realtime",
      state: "connected",
      serverChannels: [],
      serverMethods: ["api.request"],
    });
    Reflect.set(globalThis, "__nfSockets__", new Set([app]));
    bar = new DebugBar({ client: barSocket(), network: false, open: true });
    bar.mount();
    q(".tab[data-tab='socket']").click();
    await image();
    await image();
    expect(q("[data-el='rtRtt']").textContent).toBe(
      "non offert par ce serveur",
    );
    expect(q("[data-el='btnRtt']").hidden).toBe(true);
  });
});
