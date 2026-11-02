// @vitest-environment jsdom
/**
 * Les hooks de canal React EXÉCUTÉS dans un vrai rendu, sous leurs deux formes :
 * la socket typée par le contrat passée en tête (#709), et le nom seul lu sur la
 * socket du `<NodefonyProvider>`. Le typage est éprouvé par
 * `clientHooksContract.types.test.ts` ; ici, la socket réellement écoutée.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  NodefonyProvider,
  useNodefonyChannel,
  useNodefonyChannelData,
} from "../client/react/index";
import {
  connectedContractSocket,
  connectedPlainSocket,
} from "./fixtures/contractSocket";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  delete (globalThis as { __nfRealtime__?: unknown }).__nfRealtime__;
});

/** Rend `element` dans un conteneur neuf. */
function rendre(element: React.ReactElement): void {
  root = createRoot(document.createElement("div"));
  act(() => root!.render(element));
}

describe("hooks de canal React — la socket du contrat en tête", () => {
  it("🔴 la socket passée en tête est écoutée SANS Provider, et rendue au démontage", async () => {
    const { socket, transport } = await connectedContractSocket();
    const vus: Array<{ present: string[] } | null> = [];
    function Presence() {
      vus.push(useNodefonyChannelData(socket, "chat:presence"));
      return null;
    }
    rendre(React.createElement(Presence));
    expect(socket.subscribedChannels).toEqual(["chat:presence"]);

    act(() => transport.push("chat:presence", { present: ["alice"] }));
    expect(vus.at(-1)).toEqual({ present: ["alice"] });

    act(() => root!.unmount());
    root = null;
    expect(socket.subscribedChannels).toEqual([]);
  });

  it("la socket en tête l'emporte sur celle du Provider", async () => {
    const chat = await connectedContractSocket();
    const autre = await connectedPlainSocket();
    const recus: string[] = [];
    function Salon() {
      useNodefonyChannel(chat.socket, "chat:room", (m) => recus.push(m.text));
      return null;
    }
    rendre(
      React.createElement(
        NodefonyProvider,
        { client: autre.socket },
        React.createElement(Salon),
      ),
    );
    expect(chat.socket.subscribedChannels).toEqual(["chat:room"]);
    expect(autre.socket.subscribedChannels).toEqual([]);

    act(() => chat.transport.push("chat:room", { from: "a", text: "salut" }));
    expect(recus).toEqual(["salut"]);
  });

  it("la valeur initiale est servie avant le premier message", async () => {
    const { socket } = await connectedContractSocket();
    const vus: Array<{ present: string[] } | null> = [];
    function Presence() {
      vus.push(
        useNodefonyChannelData(socket, "chat:presence", { present: [] }),
      );
      return null;
    }
    rendre(React.createElement(Presence));
    expect(vus[0]).toEqual({ present: [] });
  });
});

describe("hooks de canal React — une connexion par adresse", () => {
  it("🔴 la socket du contrat donnée au Provider sert les DEUX formes, sous un seul abonnement", async () => {
    const { socket, transport } = await connectedContractSocket();
    const typees: Array<{ present: string[] } | null> = [];
    const nommees: unknown[] = [];
    function Page() {
      typees.push(useNodefonyChannelData(socket, "chat:presence"));
      nommees.push(useNodefonyChannelData("chat:presence"));
      return null;
    }
    rendre(
      React.createElement(
        NodefonyProvider,
        { client: socket },
        React.createElement(Page),
      ),
    );
    const abonnements = transport.sent.filter((raw) =>
      raw.includes('"method":"subscribe"'),
    );
    expect(abonnements).toHaveLength(1);
    expect(socket.subscribedChannels).toEqual(["chat:presence"]);

    act(() => transport.push("chat:presence", { present: ["alice"] }));
    expect(typees.at(-1)).toEqual({ present: ["alice"] });
    expect(nommees.at(-1)).toEqual({ present: ["alice"] });
  });
});

describe("hooks de canal React — la forme historique", () => {
  it("le nom seul lit la socket du Provider", async () => {
    const { socket, transport } = await connectedContractSocket();
    const vus: Array<{ present: string[] } | null> = [];
    function Presence() {
      vus.push(useNodefonyChannelData<{ present: string[] }>("chat:presence"));
      return null;
    }
    rendre(
      React.createElement(
        NodefonyProvider,
        { client: socket },
        React.createElement(Presence),
      ),
    );
    act(() => transport.push("chat:presence", { present: ["bob"] }));
    expect(vus.at(-1)).toEqual({ present: ["bob"] });
  });

  it("le nom seul hors Provider : erreur qui dit où le monter", () => {
    function Orphelin() {
      useNodefonyChannelData("chat:presence");
      return null;
    }
    expect(() => rendre(React.createElement(Orphelin))).toThrow(
      /NodefonyProvider/u,
    );
  });
});
