/// <reference types="node" />
/**
 * Unit — le CSP doit couvrir le port Vite AVANT que Vite l'ait résolu.
 *
 * Le décor du défaut (#135) : `startDev()` est déclenché sur `onServersReady`,
 * donc **les serveurs Nodefony écoutent déjà** quand Vite commence à démarrer.
 * Une page servie pendant cette fenêtre reçoit le CSP de base — `connect-src
 * 'self'` — et un CSP est **figé pour la durée de la page** : le navigateur ne
 * le renégocie jamais. Le socket du rechargement à chaud de cet onglet est mort
 * jusqu'au prochain rechargement dur, sans qu'aucune erreur serveur ne le dise.
 *
 * Ce banc verrouille les deux moitiés de la réparation :
 *  - le CONTENU : les ports déclarés couvrent la plage que Vite PEUT prendre
 *    (bloc de chaque famille, port-retry compris), pas les seules instances
 *    déjà résolues ;
 *  - le MOMENT : le fragment est remis au firewall **avant** le premier spawn.
 *
 * `startFamily` est remplacé par un double : ce banc ne démarre aucun Vite et
 * n'écrit aucun fichier. Les membres privés sont atteints par notation crochet
 * — assumé (même parti pris que `originDerivationPolicy`) : la politique n'a pas
 * de surface publique, et un renommage doit casser ce banc bruyamment.
 */
import { describe, it } from "vitest";
import { expect } from "chai";
import { Container } from "nodefony";
import FrontendService from "../../service/FrontendService";
import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder";

/** Horloge LOGIQUE partagée — deux `Date.now()` ne prouvent aucun ordre. */
let tick = 0;
const now = () => ++tick;

type CspCall = { at: number; fragment: Record<string, string[]> };

function firewallSpy() {
  const calls: CspCall[] = [];
  return {
    calls,
    registerCspOrigins(_m: string, fragment: Record<string, string[]>) {
      calls.push({ at: now(), fragment });
    },
    unregisterCspOrigins() {},
  };
}

function fakeModule(firewall: unknown, options: object = {}) {
  const noop = () => undefined;
  const container = new Container();
  container.set("kernel", {
    environment: "development",
    domain: "nodefony.com",
    fire: noop,
  });
  container.set("firewall", firewall);
  return {
    kernel: container.get("kernel"),
    container,
    notificationsCenter: { on: noop, fire: noop, removeListener: noop },
    options,
    log: noop,
  } as unknown as ConstructorParameters<typeof FrontendService>[0];
}

/** Entrée résolue minimale — seuls `entryName` et `type` sont lus ici. */
function entry(entryName: string, type: string): IResolvedFrontendEntry {
  return {
    entryName,
    type,
    root: "/tmp/nodefony-csp-banc",
    entryFile: "src/main.ts",
    outDir: "/tmp/nodefony-csp-banc/dist",
    publicPath: `/_assets/${entryName}/`,
  } as unknown as IResolvedFrontendEntry;
}

/** Ports cités dans une directive, quel que soit l'hôte ou le schéma. */
function portsOf(directive: string[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const src of directive ?? []) {
    const m = /:(\d+)$/.exec(src);
    if (m) out.add(m[1]!);
  }
  return out;
}

/**
 * Lance `startDev` sans spawner Vite : `startFamily` est remplacé par un double
 * qui note SON instant. Aucune famille ne devient `ready` → `startDev` rejette
 * (`no frontend family could start`), ce qui est le comportement attendu et ne
 * regarde pas ce banc : on observe ce que le firewall a reçu, et quand.
 */
async function runStartDev(
  svc: FrontendService,
  entries: IResolvedFrontendEntry[],
): Promise<number[]> {
  const spawnedAt: number[] = [];
  (svc as unknown as { entries: IResolvedFrontendEntry[] }).entries.push(
    ...entries,
  );
  (svc as unknown as { startFamily: () => Promise<void> }).startFamily =
    async () => {
      spawnedAt.push(now());
    };
  await svc.startDev().catch(() => undefined);
  return spawnedAt;
}

describe("CSP du rechargement à chaud — contenu (plage planifiée)", () => {
  it("déclare la plage de ports d'une famille AVANT toute résolution", async () => {
    const fw = firewallSpy();
    const svc = new FrontendService(fakeModule(fw));
    await runStartDev(svc, [entry("app", "react19")]);

    expect(
      fw.calls.length,
      "le firewall doit avoir reçu un fragment",
    ).to.be.at.least(1);
    const ports = portsOf(fw.calls[0]!.fragment["connect-src"]);
    // Bloc = `portRetryAttempts + 1` = 4 ports (défaut) : le superviseur peut
    // glisser sur EADDRINUSE, et la page déjà servie ne rejouera pas son CSP.
    for (const p of ["5173", "5174", "5175", "5176"]) {
      expect(ports.has(p), `connect-src doit couvrir le port ${p}`).to.equal(
        true,
      );
    }
  });

  it("couvre le bloc de CHAQUE famille (angular n'est pas oubliée)", async () => {
    const fw = firewallSpy();
    const svc = new FrontendService(fakeModule(fw));
    await runStartDev(svc, [
      entry("app", "react19"),
      entry("admin", "angular"),
      entry("shop", "vue3"),
    ]);

    const ports = portsOf(fw.calls[0]!.fragment["connect-src"]);
    // 3 familles × bloc de 4 → 5173..5184. `default` en tête (port habituel),
    // puis les autres par ordre alphabétique : angular, vue.
    for (let p = 5173; p <= 5184; p++) {
      expect(ports.has(String(p)), `connect-src doit couvrir ${p}`).to.equal(
        true,
      );
    }
    // Et rien au-delà de la plage : le CSP reste une garantie, pas un blanc-seing.
    expect(ports.has("5185"), "5185 est hors plage").to.equal(false);
  });

  it("le socket du rechargement à chaud est couvert, pas seulement les assets", async () => {
    const fw = firewallSpy();
    const svc = new FrontendService(fakeModule(fw));
    await runStartDev(svc, [entry("app", "react19")]);

    const connect = fw.calls[0]!.fragment["connect-src"] ?? [];
    // Le symptôme constaté est un refus de `wss://localhost:5173` : l'origine
    // WS doit être là, avec son hôte — jamais un `ws:` nu, qui rendrait la page
    // joignable depuis n'importe où.
    expect(connect).to.include("ws://localhost:5173");
    expect(connect.some((s) => s === "ws:" || s === "wss:")).to.equal(false);
  });
});

describe("CSP du rechargement à chaud — moment (avant le spawn)", () => {
  it("le fragment est remis au firewall AVANT le premier démarrage de famille", async () => {
    const fw = firewallSpy();
    const svc = new FrontendService(fakeModule(fw));
    const spawnedAt = await runStartDev(svc, [entry("app", "react19")]);

    expect(spawnedAt.length, "une famille doit avoir été démarrée").to.equal(1);
    expect(fw.calls.length, "un fragment doit avoir été posé").to.be.at.least(
      1,
    );
    expect(
      fw.calls[0]!.at,
      "le CSP doit être posé avant le spawn — une page servie pendant le " +
        "démarrage de Vite garde son CSP pour toute sa durée",
    ).to.be.lessThan(spawnedAt[0]!);
  });
});

describe("CSP du rechargement à chaud — la plage cède au port qui SERT", () => {
  /** Accès aux ports déclarés, sans passer par le firewall. */
  const cspPorts = (svc: FrontendService): Set<string> =>
    (svc as unknown as { cspPorts: () => Set<string> }).cspPorts();

  /**
   * Double de superviseur. `state` compte AUTANT que `port` : l'implémentation
   * réelle rend le port ESPÉRÉ (`resolvedPort ?? devPort`) tant que rien n'est
   * résolu — jamais `null`, contrairement à ce que promet `IViteSupervisorStatus`.
   */
  const fakeSupervisor = (port: number, state = "ready") =>
    ({
      status: () => ({ port, host: "127.0.0.1", state }),
      stop: async () => undefined,
    }) as never;

  const setSupervisor = (svc: FrontendService, f: string, sup: unknown) =>
    (svc as unknown as { supervisors: Map<string, unknown> }).supervisors.set(
      f,
      sup,
    );

  it("aucun plan, aucune instance → repli sur le port configuré", () => {
    const svc = new FrontendService(fakeModule(firewallSpy()));
    expect([...cspPorts(svc)]).to.deep.equal(["5173"]);
  });

  it("famille SERVIE → son port réel remplace son bloc", async () => {
    // La plage est le prix d'une incertitude : elle ne doit pas lui survivre.
    // Mesuré sur ce dépôt (3 familles × 4 hôtes) : garder les douze ports porte
    // l'en-tête CSP à ~8 Ko sur CHAQUE réponse — au bord des 8 Ko que refusent
    // beaucoup de relais. Une fois le port connu, la garantie tient sur lui seul.
    const svc = new FrontendService(fakeModule(firewallSpy()));
    await runStartDev(svc, [
      entry("app", "react19"),
      entry("admin", "angular"),
    ]);
    expect(
      cspPorts(svc).size,
      "avant résolution : deux blocs entiers",
    ).to.equal(8);

    setSupervisor(svc, "default", fakeSupervisor(5174));
    const ports = cspPorts(svc);
    expect(ports.has("5174"), "le port qui sert est déclaré").to.equal(true);
    expect(ports.has("5173"), "le reste du bloc servi est retiré").to.equal(
      false,
    );
    expect(
      ports.has("5177"),
      "le bloc d'angular, non résolu, reste entier",
    ).to.equal(true);
  });

  it("un port ESPÉRÉ ne vaut pas un port résolu — le bloc reste entier", async () => {
    // Piège du contrat : `status().port` retombe sur `devPort` avant toute
    // résolution. S'y fier rétrécirait le bloc sur une espérance, et le
    // glissement sur `EADDRINUSE` rouvrirait exactement le trou de #135.
    const svc = new FrontendService(fakeModule(firewallSpy()));
    await runStartDev(svc, [entry("app", "react19")]);
    setSupervisor(svc, "default", fakeSupervisor(5173, "starting"));

    const ports = cspPorts(svc);
    for (const p of ["5173", "5174", "5175", "5176"]) {
      expect(
        ports.has(p),
        `le bloc reste entier tant que rien ne sert (${p})`,
      ).to.equal(true);
    }
  });

  it("une instance HORS plan garde son port déclaré", () => {
    // Aucun plan (démarrage manuel, famille apparue autrement) : on ne perd
    // jamais un port qui sert réellement.
    const svc = new FrontendService(fakeModule(firewallSpy()));
    setSupervisor(svc, "default", fakeSupervisor(5999));
    expect([...cspPorts(svc)]).to.deep.equal(["5999"]);
  });

  it("`stopDev` oublie le plan — pas de port d'une topologie révolue", async () => {
    const svc = new FrontendService(fakeModule(firewallSpy()));
    await runStartDev(svc, [
      entry("app", "react19"),
      entry("admin", "angular"),
    ]);
    expect(cspPorts(svc).has("5180"), "plage du 2e bloc en place").to.equal(
      true,
    );

    setSupervisor(svc, "default", fakeSupervisor(5173));
    await svc.stopDev();
    expect([...cspPorts(svc)]).to.deep.equal(["5173"]);
  });
});
