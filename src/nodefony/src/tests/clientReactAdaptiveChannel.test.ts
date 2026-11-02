// @vitest-environment jsdom
/**
 * Les hooks ADAPTATIFS React exécutés dans un vrai rendu, sous leurs deux formes —
 * la socket typée par le contrat en tête, ou le nom seul sur la socket du Provider —
 * et la socket PARTAGÉE de la page vue par un contrat (`fromContract({ shared })`).
 * Le typage est éprouvé par `clientHooksContract.types.test.ts` ; ici, la socket
 * réellement écoutée.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  NodefonyProvider,
  useNodefonyAdaptiveChannel,
  useNodefonyAdaptiveChannelData,
} from "../client/react/index";
import { NodefonySocket } from "../client/realtime/NodefonySocket";
import {
  connectedContractSocket,
  connectedPlainSocket,
  ContractBenchTransport,
  type BenchContract,
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

/** Le seul canal effectivement suivi par la socket (base + suffixe de cadence). */
function seulCanal(socket: NodefonySocket): string {
  const canaux = socket.subscribedChannels;
  expect(canaux).toHaveLength(1);
  return canaux[0] ?? "";
}

describe("hooks adaptatifs React — la socket du contrat en tête", () => {
  it("🔴 la socket passée en tête est écoutée SANS Provider, et rendue au démontage", async () => {
    const { socket, transport } = await connectedContractSocket();
    const vus: Array<{ present: string[] } | null> = [];
    const cadences: number[] = [];
    function Presence() {
      const { data, intervalMs } = useNodefonyAdaptiveChannelData(
        socket,
        "chat:presence",
        1000,
      );
      vus.push(data);
      cadences.push(intervalMs);
      return null;
    }
    rendre(React.createElement(Presence));
    const canal = seulCanal(socket);
    expect(canal.startsWith("chat:presence")).toBe(true);
    expect(cadences[0]).toBe(1000);

    act(() => transport.push(canal, { present: ["alice"] }));
    expect(vus.at(-1)).toEqual({ present: ["alice"] });

    act(() => root!.unmount());
    root = null;
    expect(socket.subscribedChannels).toEqual([]);
  });

  it("la socket en tête l'emporte sur celle du Provider (forme gestionnaire)", async () => {
    const chat = await connectedContractSocket();
    const autre = await connectedPlainSocket();
    const recus: string[] = [];
    function Salon() {
      useNodefonyAdaptiveChannel(
        chat.socket,
        "chat:room",
        (m) => recus.push(m.text),
        500,
      );
      return null;
    }
    rendre(
      React.createElement(
        NodefonyProvider,
        { client: autre.socket },
        React.createElement(Salon),
      ),
    );
    const canal = seulCanal(chat.socket);
    expect(autre.socket.subscribedChannels).toEqual([]);

    act(() => chat.transport.push(canal, { from: "a", text: "salut" }));
    expect(recus).toEqual(["salut"]);
  });

  it("le nom seul lit toujours la socket du Provider", async () => {
    const { socket, transport } = await connectedContractSocket();
    const vus: unknown[] = [];
    function Presence() {
      vus.push(useNodefonyAdaptiveChannelData("chat:presence", 1000).data);
      return null;
    }
    rendre(
      React.createElement(
        NodefonyProvider,
        { client: socket },
        React.createElement(Presence),
      ),
    );
    act(() => transport.push(seulCanal(socket), { present: ["bob"] }));
    expect(vus.at(-1)).toEqual({ present: ["bob"] });
  });

  it("un appel mal formé est nommé, pas différé à la première trame", async () => {
    const { socket } = await connectedContractSocket();
    function SansCadence() {
      // Appel volontairement hors signature : la cadence manque.
      Reflect.apply(useNodefonyAdaptiveChannelData, undefined, [
        socket,
        "chat:presence",
      ]);
      return null;
    }
    expect(() => rendre(React.createElement(SansCadence))).toThrow(
      /cadence désirée/u,
    );
  });
});

describe("NodefonySocket.fromContract — la socket partagée de la page", () => {
  it("🔴 `shared: true` rend l'instance de `NodefonySocket.shared()` pour la même adresse", () => {
    const page = NodefonySocket.shared({ url: "ws://loopback/partagee" });
    const typee = NodefonySocket.fromContract<BenchContract>({
      url: "ws://loopback/partagee",
      shared: true,
    });
    expect(typee).toBe(page);
  });

  it("sans `shared`, la socket reste neuve et privée", () => {
    const page = NodefonySocket.shared({ url: "ws://loopback/privee" });
    const neuve = NodefonySocket.fromContract<BenchContract>({
      url: "ws://loopback/privee",
    });
    expect(neuve).not.toBe(page);
  });

  it("`shared` refuse une fabrique de transport (la socket de la page a déjà le sien)", () => {
    expect(() =>
      NodefonySocket.fromContract<BenchContract>(
        { url: "ws://loopback/fabrique", shared: true },
        () => new ContractBenchTransport(),
      ),
    ).toThrow(TypeError);
  });
});
