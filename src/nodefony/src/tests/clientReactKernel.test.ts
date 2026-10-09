// @vitest-environment jsdom
/**
 * Le noyau client EXÉCUTÉ dans un vrai rendu React : un composant profond lit
 * le noyau fourni au `<NodefonyProvider kernel>`, son identité suit
 * `setIdentity()`, et démonter ne laisse aucun handler sur le noyau. Les règles
 * (précédence, observation) sont éprouvées une fois dans
 * `clientObserve.test.ts` ; ici, la traduction.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  NodefonyProvider,
  useNodefony,
  useNodefonyKernel,
  useNodefonyKernelIdentity,
  useNodefonyKernelState,
  type ClientIdentity,
  type ClientKernelState,
  type IClientKernel,
} from "../client/react/index";
import { NodefonySocket } from "../client/realtime/NodefonySocket";
import { createClientKernel } from "../client/ClientKernel";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  delete (globalThis as { __nfRealtime__?: unknown }).__nfRealtime__;
});

/** Une socket qu'aucun test n'ouvre : le noyau en garde le cycle. */
function socketInerte(): NodefonySocket {
  return new NodefonySocket({ url: "ws://loopback/realtime" }, () => {
    throw new Error("le Provider ne doit pas ouvrir la socket du noyau");
  });
}

function noyau(realtime: NodefonySocket | false = socketInerte()) {
  return createClientKernel({ realtime, browserEvents: false, banner: false });
}

interface IVu {
  kernel: IClientKernel | null;
  socket: NodefonySocket | null;
  state: ClientKernelState | null;
  identity: ClientIdentity | null;
}

/** Un composant PROFOND qui lit le noyau par les hooks — et rien d'autre. */
function monter(props: {
  kernel?: IClientKernel;
  client?: NodefonySocket;
}): () => IVu {
  let vu: IVu | null = null;
  function Profond() {
    const kernel = useNodefonyKernel();
    const socket = useNodefony();
    const state = useNodefonyKernelState();
    const identity = useNodefonyKernelIdentity();
    // Relevé APRÈS le rendu, comme le ferait n'importe quel effet de la page.
    React.useEffect(() => {
      vu = { kernel, socket, state, identity };
    });
    return null;
  }
  function Intermediaire() {
    return React.createElement(Profond);
  }
  root = createRoot(document.createElement("div"));
  act(() =>
    root!.render(
      React.createElement(
        NodefonyProvider,
        props,
        React.createElement(Intermediaire),
      ),
    ),
  );
  return () => vu!;
}

describe("noyau client — React", () => {
  it("🔴 un composant profond lit le noyau fourni, et son identité suit setIdentity()", () => {
    const kernel = noyau();
    const vu = monter({ kernel });
    expect(vu().kernel).toBe(kernel);
    // La socket des hooks est celle que le noyau a composée.
    expect(vu().socket).toBe(kernel.get("realtime"));
    expect(vu().state).toBe("created");
    expect(vu().identity).toBeNull();

    act(() => kernel.setIdentity({ key: "alice" }));
    expect(vu().identity?.key).toBe("alice");
    act(() => kernel.setIdentity({ key: "bob" }));
    expect(vu().identity?.key).toBe("bob");
  });

  it("l'état du noyau suit son cycle", async () => {
    const kernel = noyau(false);
    const vu = monter({ kernel, client: socketInerte() });
    await act(() => kernel.boot());
    expect(vu().state).toBe("ready");
    await act(() => kernel.terminate());
    expect(vu().state).toBe("terminated");
  });

  it("démonter ne laisse AUCUN handler sur le noyau", () => {
    const kernel = noyau();
    const on = vi.spyOn(kernel, "on");
    const off = vi.spyOn(kernel, "off");
    monter({ kernel });
    expect(on).toHaveBeenCalled();
    act(() => root!.unmount());
    root = null;
    const branches = on.mock.calls.length - off.mock.calls.length;
    expect(branches).toBe(0);
  });

  it("sans noyau fourni : `null` partout, la socket fournie reste servie", () => {
    const vu = monter({ client: socketInerte() });
    expect(vu().kernel).toBeNull();
    expect(vu().state).toBeNull();
    expect(vu().identity).toBeNull();
    expect(vu().socket).toBeInstanceOf(NodefonySocket);
  });
});
