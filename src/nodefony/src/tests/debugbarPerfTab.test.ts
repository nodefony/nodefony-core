/**
 * L'onglet Perf de la barre — une carte par mesure du process serveur, et ce
 * que le navigateur sait du chargement de la page.
 *
 * Aucun réseau : les mesures arrivent par la socket double, sur le canal de la
 * barre, comme le serveur les pousse.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DebugBar } from "../client/debugbar/DebugBar";
import { fakeSocket } from "./debugbarFakeSocket";
import { PLATFORM_CHANNELS } from "../realtime/platformChannels";

type Handler = (...a: unknown[]) => void;
let pousser: Handler = () => {};
let bar: DebugBar | null = null;

const q = (sel: string): HTMLElement => {
  const el = document
    .getElementById("nodefony-debugbar")
    ?.shadowRoot?.querySelector(sel);
  if (!el) throw new Error(`introuvable : ${sel}`);
  return el as HTMLElement;
};
const texte = (sel: string): string => q(sel).textContent ?? "";
const tour = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

beforeEach(() => {
  bar = new DebugBar({
    client: fakeSocket({
      on: (channel: string, h: Handler) => {
        if (channel === PLATFORM_CHANNELS.debugbar) pousser = h;
        return () => {};
      },
    }),
    network: false,
    open: true,
  });
  bar.mount();
  q(".tab[data-tab='perf']").click();
});
afterEach(() => {
  bar?.unmount?.();
  bar = null;
  document.getElementById("nodefony-debugbar")?.remove();
  try {
    localStorage.clear();
  } catch {
    /* jsdom sans stockage */
  }
});

describe("onglet Perf — une carte par mesure", () => {
  it("🔴 Temps réel éteint : un bandeau le dit, et son bouton l'allume", async () => {
    await tour();
    expect(q("[data-el='pfOff']").hidden).toBe(false);
    expect(q("[data-el='pfOn']").hidden).toBe(true);
    expect(q("[data-el='pGrid']").classList.contains("stale")).toBe(true);
    // Aucune mesure encore reçue : un tiret, pas un zéro qui passerait pour une mesure.
    expect(texte("[data-el='cpuVal']")).toBe("—");
    expect(texte("[data-el='heapRows']")).not.toContain("0 B");
    q("[data-el='btnPfLive']").click();
    await tour();
    expect(q("[data-el='pfOff']").hidden).toBe(true);
    expect(q("[data-el='pfOn']").hidden).toBe(false);
    expect(q("[data-el='pGrid']").classList.contains("stale")).toBe(false);
  });

  it("🔴 chaque carte dit sa valeur, son pic, sa moyenne — en français", async () => {
    q("[data-el='btnPfLive']").click();
    const tick = (cpuPercent: number, heapUsed: number, ts: number): void =>
      pousser({
        ts,
        cpuPercent,
        eventLoopMs: 2,
        pid: 1,
        instanceId: "w1",
        memory: { heapUsed, heapTotal: 80, heapLimit: 100, rss: 200 },
      });
    tick(40, 50, 1);
    tick(20, 60, 2);
    await tour();
    expect(texte("[data-el='cpuVal']")).toBe("20 %");
    expect(texte("[data-el='cpuPeak']")).toBe("pic 40 %");
    expect(texte("[data-el='cpuRows']")).toContain("30 %");
    expect(texte("[data-el='heapRows']")).toContain("limite");
    expect(texte("[data-el='loopVal']")).toBe("2 ms");
    expect(texte("[data-pane='perf']")).not.toContain("peak");
  });

  it("la carte « Cette page » dit quand le navigateur ne rend pas de minutage", async () => {
    await tour();
    // jsdom n'implémente pas Navigation Timing : la carte le dit, sans planter.
    expect(texte("[data-el='pfPage']")).toContain("minutage");
  });
});
