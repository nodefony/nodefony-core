/**
 * Unit — ce qui vaut SANS noyau (#136, révision de l'ADR-0007 D7).
 *
 * Les quatre vitrines du dépôt montent `<NodefonyProvider url="…">` et rien
 * d'autre : c'est délibéré — « deux concepts pour afficher un message temps
 * réel » est l'argument produit de toute la grappe #54, et D7 interdit le péage.
 * Le corollaire de #91 vaut pourtant ici : ce que nos applications n'utilisent
 * pas n'est éprouvé par personne. L'arbitrage rendu : **les vitrines restent
 * nues, et le DIAGNOSTIC sort du noyau.**
 *
 * Ce banc verrouille les deux moitiés de cet arbitrage :
 *  - une socket nue annonce le framework et se rend inspectable ;
 *  - le noyau, quand il y en a un, garde ce qui lui appartient — son nom sur le
 *    badge, et le fait d'être lâché à sa mort.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { RealtimeClient } from "../client/realtime/RealtimeClient";
import { createClientKernel } from "../client/ClientKernel";

type Globals = {
  nodefony?: {
    kernel?: unknown;
    socket?: { url?: string };
    sockets(): Array<{ url: string; state: string }>;
    identity(): unknown;
  };
  __nfRealtime__?: Map<string, unknown>;
  __nfAnnounced__?: boolean;
  __nfDetailed__?: boolean;
};

const g = globalThis as Globals;

/** Console double : on compte ce qui est écrit, sans polluer la sortie. */
function spyConsole() {
  const calls: string[] = [];
  const vraie = globalThis.console;
  globalThis.console = {
    ...vraie,
    log: (...a: unknown[]) => calls.push(String(a[0])),
    groupCollapsed: () => undefined,
    groupEnd: () => undefined,
    table: () => undefined,
  } as Console;
  return { calls, restore: () => (globalThis.console = vraie) };
}

/** Une page vierge — sans quoi un banc précédent aurait déjà sorti le badge. */
function pageVierge(): void {
  delete g.nodefony;
  delete g.__nfAnnounced__;
  delete g.__nfDetailed__;
  delete g.__nfRealtime__;
}

describe("Sans noyau — une socket nue annonce, et se laisse inspecter", () => {
  beforeEach(pageVierge);
  afterEach(pageVierge);

  it("une socket NUE pose le badge et le handle — c'est le cas des vitrines", () => {
    const spy = spyConsole();
    try {
      RealtimeClient.shared({ url: "https://exemple.test/api/live/realtime" });
      // Le badge : sans lui, une page qui emploie Nodefony ne le dit nulle part.
      expect(spy.calls.filter((l) => l.includes("nodefony"))).toHaveLength(1);
      // Le handle : `nodefony` qui rend `undefined` se lit « pas chargé ».
      expect(
        g.nodefony,
        "`nodefony` doit exister sans aucun noyau",
      ).toBeDefined();
      expect(g.nodefony?.kernel, "aucun noyau ici").toBeUndefined();
      expect(g.nodefony?.sockets()).toHaveLength(1);
      expect(g.nodefony?.sockets()[0]!.url).toContain("/api/live/realtime");
      // Sans noyau, l'identité se lit sur la socket — `null` tant qu'aucun
      // accueil n'est arrivé, jamais une exception.
      expect(g.nodefony?.identity()).toBeNull();
    } finally {
      spy.restore();
    }
  });

  it("UN seul badge par page, quel que soit le nombre de sockets", () => {
    const spy = spyConsole();
    try {
      RealtimeClient.shared({ url: "https://exemple.test/a" });
      RealtimeClient.shared({ url: "https://exemple.test/b" });
      new RealtimeClient({ url: "https://exemple.test/c" });
      // Une console de navigateur est partagée : trois badges pour une page,
      // c'est du bruit qui pousse les messages de l'application hors de vue.
      expect(spy.calls.filter((l) => l.includes("nodefony"))).toHaveLength(1);
      // Les deux sockets PARTAGÉES sont listées ; la troisième, construite hors
      // du partage, ne l'est pas — la retenir ici en ferait une fuite.
      expect(g.nodefony?.sockets()).toHaveLength(2);
    } finally {
      spy.restore();
    }
  });

  it("`banner: false` fait taire l'annonce ET le handle", () => {
    const spy = spyConsole();
    try {
      new RealtimeClient({ url: "https://exemple.test/muet", banner: false });
      expect(spy.calls).toEqual([]);
      expect(g.nodefony).toBeUndefined();
    } finally {
      spy.restore();
    }
  });
});

describe("Avec noyau — le noyau garde ce qui lui appartient", () => {
  beforeEach(pageVierge);
  afterEach(pageVierge);

  it("le badge porte le NOM du noyau, pas le générique de la socket", async () => {
    // Le noyau compose sa socket dans son CONSTRUCTEUR : s'il ne s'annonçait pas
    // avant, c'est le badge générique de la socket qui sortirait le premier, et
    // le nom de l'application ne s'afficherait jamais.
    const spy = spyConsole();
    try {
      const k = createClientKernel({
        browserEvents: false,
        name: "MON APP",
        realtime: { url: "https://exemple.test/api/live/realtime" },
        // On observe l'ANNONCE, pas la connexion : sans ce réglage le boot
        // attendrait une socket qui ne s'ouvrira jamais sur une adresse de banc.
        connectOnBoot: false,
      });
      await k.boot();
      const badges = spy.calls.filter((l) => l.includes("◆ nodefony"));
      expect(badges, "un seul badge, malgré noyau + socket").toHaveLength(1);
      expect(badges[0]).toContain("MON APP");
      expect(g.nodefony?.kernel).toBe(k);
      await k.terminate();
    } finally {
      spy.restore();
    }
  });
});

describe("La décision de #136 est gravée : les vitrines restent NUES", () => {
  /**
   * Les quatre vitrines démontrent délibérément le cas simple — « deux concepts
   * pour afficher un message temps réel », l'argument produit de la grappe #54.
   * L'ADR-0007 D7 l'exige (« le kernel compose, il n'impose pas »), et le
   * corollaire de #91 — ce que nos applications n'utilisent pas n'est éprouvé
   * par personne — est satisfait ailleurs : la console d'administration exerce
   * le noyau de bout en bout, avec identité, bascule de compte et services.
   *
   * Ce banc empêche la dérive INVERSE, la seule qui menace : qu'on « améliore »
   * une vitrine en lui composant un noyau, et qu'on perde la démonstration du
   * chemin court sans que rien ne le signale.
   */
  // `.pathname` d'une URL `file:` rend `/D:/a/…` sous Windows : concaténé à un
  // chemin, il produit `D:\D:\…` (axiome #3 — un chemin qu'on OUVRE ne se dérive
  // jamais d'une URL à la main).
  const racine = fileURLToPath(
    new URL("../../../../src/modules/", import.meta.url),
  );
  const vitrines = [
    "test-frontend-react",
    "test-frontend-vue",
    "test-frontend-angular",
    "test-frontend-svelte",
  ];

  it("aucune vitrine ne compose un noyau client", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const lire = async (dir: string): Promise<string[]> => {
      const out: string[] = [];
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === "dist") continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...(await lire(p)));
        else if (/\.(ts|tsx|vue|svelte|js|jsx)$/.test(e.name)) out.push(p);
      }
      return out;
    };

    for (const v of vitrines) {
      const fichiers = await lire(join(racine, v, "frontend"));
      expect(
        fichiers.length,
        `${v} doit avoir des sources front`,
      ).toBeGreaterThan(0);
      for (const f of fichiers) {
        const src = await readFile(f, "utf8");
        expect(
          src.includes("createClientKernel"),
          `${f} compose un noyau — la vitrine doit rester nue (#136, ADR-0007 D7)`,
        ).toBe(false);
      }
    }
  });
});
