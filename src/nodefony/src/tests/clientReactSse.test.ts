// @vitest-environment jsdom
/**
 * `useNodefonySse` EXÉCUTÉ dans un vrai rendu React : monter ouvre le flux, les
 * événements arrivent dans l'état, DÉMONTER le ferme. Les règles du flux sont
 * éprouvées une fois dans `clientObserveSse.test.ts` ; ici, la traduction.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useNodefonySse, type SseSnapshot } from "../client/react/index";
import {
  sseFetchBench,
  settle,
  type ISseFetchBench,
} from "./fixtures/sseFetch";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

/** Monte un composant qui lit le flux, et rend l'état vu au dernier rendu. */
function monter(
  banc: ISseFetchBench,
  url: string | null,
  journal: string[] = [],
): { etat: () => SseSnapshot | null; rendre: (url: string | null) => void } {
  let vu: SseSnapshot | null = null;
  function Lecteur({ adresse }: { adresse: string | null }) {
    // Un objet d'options NEUF à chaque rendu : il ne doit rien rouvrir.
    const etat = useNodefonySse(adresse, {
      fetch: banc.fetch,
      events: ["log"],
      onEvent: (e) => journal.push(e.data),
    });
    // Relevé APRÈS le rendu, comme le ferait n'importe quel effet de la page.
    React.useEffect(() => {
      vu = etat;
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  const rendre = (adresse: string | null) =>
    act(() => root!.render(React.createElement(Lecteur, { adresse })));
  rendre(url);
  return { etat: () => vu, rendre };
}

describe("useNodefonySse — React", () => {
  it("🔴 monter OUVRE le flux, l'état suit, démonter le FERME", async () => {
    const banc = sseFetchBench();
    const journal: string[] = [];
    const { etat } = monter(banc, "http://127.0.0.1/flux", journal);
    expect(banc.open()).toBe(1);
    await act(settle);
    expect(etat()?.readyState).toBe(1);

    banc.calls[0]!.push("event: log\ndata: a\n\nevent: log\ndata: b\n\n");
    await act(settle);
    expect(journal).toEqual(["a", "b"]);
    expect(etat()?.lastEvent?.data).toBe("b");

    act(() => root!.unmount());
    root = null;
    expect(banc.open()).toBe(0);
  });

  it("un nouveau rendu ne rouvre rien ; changer d'adresse ferme l'ancien flux", async () => {
    const banc = sseFetchBench();
    const { rendre } = monter(banc, "http://127.0.0.1/a");
    rendre("http://127.0.0.1/a");
    expect(banc.calls).toHaveLength(1);
    rendre("http://127.0.0.1/b");
    expect(banc.calls).toHaveLength(2);
    expect(banc.open()).toBe(1);
    rendre(null);
    expect(banc.open()).toBe(0);
    await act(settle);
  });
});
