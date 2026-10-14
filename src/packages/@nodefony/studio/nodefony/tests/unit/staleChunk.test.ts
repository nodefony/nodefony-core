/**
 * Unit — un onglet périmé se recharge UNE fois (`frontend/src/utils/staleChunk.ts`).
 *
 * Après un redéploiement, un onglet resté ouvert demande les fichiers de la
 * génération précédente et le premier changement d'écran échouait sur
 * « Failed to fetch dynamically imported module ». Ce que ces cas gardent : le
 * rechargement a lieu, et il ne BOUCLE pas quand l'écran reste introuvable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reloadForStaleChunk } from "../../../frontend/src/utils/staleChunk";

describe("reloadForStaleChunk", () => {
  let store: Map<string, string>;
  let reloads: number;

  beforeEach(() => {
    store = new Map();
    reloads = 0;
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    vi.stubGlobal("window", { location: { reload: () => void reloads++ } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("recharge au premier échec", () => {
    expect(reloadForStaleChunk()).toBe(true);
    expect(reloads).toBe(1);
  });

  it("ne recharge pas une seconde fois dans la fenêtre : pas de boucle", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    expect(reloadForStaleChunk()).toBe(true);
    vi.setSystemTime(1_000_000 + 5_000);
    expect(reloadForStaleChunk()).toBe(false);
    expect(reloads).toBe(1);
  });

  it("recharge de nouveau une fois la fenêtre passée (nouveau déploiement)", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    reloadForStaleChunk();
    vi.setSystemTime(1_000_000 + 11_000);
    expect(reloadForStaleChunk()).toBe(true);
    expect(reloads).toBe(2);
  });

  it("sans stockage de session, ne recharge pas — sans mémoire, ce serait une boucle", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    });
    expect(reloadForStaleChunk()).toBe(false);
    expect(reloads).toBe(0);
  });
});
