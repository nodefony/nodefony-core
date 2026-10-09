// @vitest-environment jsdom
/**
 * L'onglet « Noyau » de la barre de debug, sur un VRAI `NodefonyKernel` :
 * détection quel que soit l'ordre de montage, état, identité déclarée,
 * journal des événements, diagnostic identique à celui de la console, et
 * aucun écouteur laissé sur le noyau au démontage de la barre.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DebugBar } from "../client/debugbar/DebugBar";
import { NodefonyKernel } from "../client/NodefonyKernel";
import { exposedKernels } from "../client/announce";
import { NodefonySocket } from "../client/realtime/NodefonySocket";
import {
  TransportState,
  type IRealtimeTransport,
} from "../realtime/IRealtimeTransport";

/** Un transport qui ne s'ouvre jamais : la barre peut demander la connexion, rien ne part. */
class TransportMuet implements IRealtimeTransport {
  readyState: number = TransportState.CONNECTING;
  connect(): void {}
  send(): void {}
  close(): void {
    this.readyState = TransportState.CLOSED;
  }
  onOpen(): void {}
  onMessage(): void {}
  onClose(): void {}
  onError(): void {}
}
/** Une VRAIE socket, sur un transport muet — pas de double à convertir. */
const fakeClient = (): NodefonySocket =>
  new NodefonySocket(
    { url: "ws://loopback/realtime" },
    () => new TransportMuet(),
  );

let bar: DebugBar | null = null;
const kernels: NodefonyKernel[] = [];

function noyau(name = "MON APP"): NodefonyKernel {
  const k = new NodefonyKernel({ name, browserEvents: false, banner: false });
  kernels.push(k);
  return k;
}
function monter(): void {
  bar = new DebugBar({ client: fakeClient(), network: false, open: true });
  bar.mount();
}
const shadow = (): ShadowRoot => {
  const root = document.getElementById("nodefony-debugbar")?.shadowRoot;
  if (!root) throw new Error("barre non montée");
  return root;
};
const q = (sel: string): HTMLElement => {
  const el = shadow().querySelector(sel);
  if (!(el instanceof HTMLElement)) throw new Error(`introuvable : ${sel}`);
  return el;
};
/** Le rendu est regroupé à l'image suivante. */
const image = (): Promise<void> => new Promise((r) => setTimeout(r, 40));
async function ongletNoyau(): Promise<HTMLElement> {
  q(".tab[data-tab='kernel']").click();
  await image();
  return q("[data-el='kBody']");
}

beforeEach(() => {
  Reflect.deleteProperty(globalThis, "__nfKernels__");
});
afterEach(async () => {
  bar?.unmount();
  bar = null;
  document.getElementById("nodefony-debugbar")?.remove();
  for (const k of kernels.splice(0)) await k.terminate();
  try {
    localStorage.clear();
  } catch {
    /* jsdom sans stockage */
  }
});

describe("onglet Noyau — détection", () => {
  it("sans noyau : l'onglet explique comment en avoir un, la puce reste cachée", async () => {
    monter();
    expect(q("[data-el='kChip']").hidden).toBe(true);
    const body = await ongletNoyau();
    expect(body.textContent).toContain("Aucun noyau client sur cette page");
    expect(body.textContent).toContain("new NodefonyKernel");
  });

  it("🔴 un noyau créé AVANT la barre est détecté", async () => {
    noyau();
    expect(exposedKernels()).toHaveLength(1);
    monter();
    expect(q("[data-el='kChip']").hidden).toBe(false);
    expect(q("[data-el='kChipState']").textContent).toBe("créé");
    const body = await ongletNoyau();
    expect(body.textContent).toContain("MON APP");
  });

  it("🔴 un noyau créé APRÈS la barre est détecté (événement de la page)", async () => {
    monter();
    expect(q("[data-el='kChip']").hidden).toBe(true);
    noyau("TARDIF");
    await image();
    expect(q("[data-el='kChip']").hidden).toBe(false);
    const body = await ongletNoyau();
    expect(body.textContent).toContain("TARDIF");
  });
});

describe("onglet Noyau — ce qu'il montre", () => {
  it("l'état suit le cycle, l'identité suit setIdentity, chaque événement est journalisé", async () => {
    const k = noyau();
    monter();
    await k.boot();
    k.setIdentity({ key: "alice", data: { secret: "ne-pas-afficher" } });
    k.setIdentity({ key: "bob" });
    await image();
    expect(q("[data-el='kChipState']").textContent).toBe("prêt");
    const body = await ongletNoyau();
    const texte = body.textContent ?? "";
    expect(texte).toContain("bob");
    expect(texte).toContain("onIdentityChange");
    expect(texte).toContain("alice → bob");
    expect(texte).toContain("anonyme → alice");
    expect(texte).toContain("onReady");
    // La charge de l'identité appartient à l'application.
    expect(texte).not.toContain("ne-pas-afficher");
  });

  it("le diagnostic est CELUI de la console — mêmes lignes, une seule source", async () => {
    const k = noyau();
    k.setIdentity({ key: "carol" });
    monter();
    const body = await ongletNoyau();
    for (const v of ["état", "identité", "carol", "temps réel", "aucun"])
      expect(body.textContent).toContain(v);
  });

  it("un noyau terminé reste affiché — « terminé », pas un onglet qui disparaît", async () => {
    const k = noyau();
    monter();
    await k.terminate();
    await image();
    expect(exposedKernels()).toHaveLength(0);
    expect(q("[data-el='kChip']").hidden).toBe(false);
    expect(q("[data-el='kChipState']").textContent).toBe("terminé");
  });
});

describe("onglet Noyau — chaque valeur s'explique", () => {
  it("les heures viennent du NOYAU — y compris celles d'avant la barre", async () => {
    const k = noyau();
    await k.boot(); // AVANT que la barre existe
    monter();
    const body = await ongletNoyau();
    const ligne = (nom: string): string =>
      [...body.querySelectorAll(".kv")]
        .find((r) => r.querySelector(".k")?.textContent === nom)
        ?.querySelector(".v")?.textContent ?? "";
    expect(ligne("démarrage")).toMatch(/^\d\d:\d\d:\d\d/);
    expect(ligne("prêt")).toMatch(/^\d\d:\d\d:\d\d/);
  });

  it("chaque libellé porte une explication, atteignable au clavier", async () => {
    const k = noyau();
    k.setIdentity({ key: "dora" });
    monter();
    const body = await ongletNoyau();
    const libelles = [...body.querySelectorAll(".kv .k")];
    expect(libelles.length).toBeGreaterThan(10);
    for (const l of libelles) {
      expect(l.getAttribute("data-tip"), l.textContent ?? "").toBeTruthy();
      expect(l.getAttribute("tabindex"), l.textContent ?? "").toBe("0");
    }
  });
});

describe("onglet Noyau — sans fuite", () => {
  it("🔴 démonter la barre ne laisse AUCUN écouteur sur le noyau", () => {
    const k = noyau();
    const on = vi.spyOn(k, "on");
    const off = vi.spyOn(k, "off");
    monter();
    expect(on).toHaveBeenCalled();
    bar?.unmount();
    bar = null;
    expect(off.mock.calls).toEqual(on.mock.calls);
  });
});
