/// <reference types="node" />
/**
 * Unit — le CSP du rechargement à chaud est posé AVANT le démarrage de Vite.
 *
 * Le décor du défaut (#135) : `startDev()` est déclenché sur `onServersReady`,
 * donc **les serveurs Nodefony écoutent déjà** quand Vite commence à démarrer.
 * Une page servie pendant cette fenêtre reçoit le CSP de base — `connect-src
 * 'self'` — et un CSP est **figé pour la durée de la page** : le navigateur ne
 * le renégocie jamais. Le socket du rechargement à chaud de cet onglet est mort
 * jusqu'au prochain rechargement dur, sans qu'aucune erreur serveur ne le dise.
 *
 * Ce banc verrouille les deux moitiés :
 *  - le CONTENU : depuis #528, tout passe par l'origine de la page
 *    (`/_vite/<famille>/`, proxy inverse) — le fragment ne nomme AUCUNE
 *    origine ni aucun port, il ne dépend donc plus de ce que Vite résoudra ;
 *    `'self'` figure dans chaque directive (elles n'héritent pas de
 *    `default-src`) et couvre le socket `ws(s):` de même hôte (CSP niveau 3) ;
 *  - le MOMENT : le fragment est remis au firewall **avant** le premier spawn.
 *
 * `startFamily` est remplacé par un double : ce banc ne démarre aucun Vite et
 * n'écrit aucun fichier. Les membres privés sont atteints par notation crochet
 * — assumé : la politique n'a pas de surface publique, et un renommage doit
 * casser ce banc bruyamment.
 */
import { describe, it } from "vitest";
import { expect } from "vitest";
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

describe("CSP du rechargement à chaud — contenu (une seule origine)", () => {
  it("aucune origine, aucun port : rien ne dépend de ce que Vite résoudra", async () => {
    const fw = firewallSpy();
    const svc = new FrontendService(fakeModule(fw));
    await runStartDev(svc, [entry("app", "react19"), entry("ng", "angular")]);
    const fragment = fw.calls[0]?.fragment ?? {};
    // Seules origines nommées : les avatars externes, alignés sur le défaut
    // de @nodefony/security — aucune n'est un serveur Vite.
    const avatars = new Set([
      "https://www.gravatar.com",
      "https://*.googleusercontent.com",
      "https://avatars.githubusercontent.com",
    ]);
    for (const [directive, sources] of Object.entries(fragment)) {
      for (const src of sources) {
        if (avatars.has(src)) continue;
        expect(src, `${directive} : ${src}`).to.not.match(
          /^(https?|wss?):\/\//,
        );
        expect(src, `${directive} : ${src}`).to.not.match(/:\d+$/);
      }
    }
  });

  it("`'self'` dans chaque directive — elles n'héritent pas de default-src", async () => {
    const fw = firewallSpy();
    const svc = new FrontendService(fakeModule(fw));
    await runStartDev(svc, [entry("app", "react19")]);
    const fragment = fw.calls[0]?.fragment ?? {};
    for (const d of [
      "script-src",
      "style-src",
      "img-src",
      "font-src",
      "connect-src",
      "worker-src",
    ]) {
      expect(fragment[d], d).to.include("'self'");
    }
    // Fast Refresh évalue du code ; les styles de Vite sont injectés en ligne.
    expect(fragment["script-src"]).to.include("'unsafe-eval'");
    expect(fragment["style-src"]).to.include("'unsafe-inline'");
    // Jamais de script en ligne sans nonce.
    expect(fragment["script-src"]).to.not.include("'unsafe-inline'");
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
