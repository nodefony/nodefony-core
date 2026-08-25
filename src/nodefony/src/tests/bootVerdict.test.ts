import { describe, it } from "vitest";
import { expect } from "chai";
import {
  extractSkippedModules,
  probeBootDegraded,
  waitBootVerdict,
} from "../service/dev/bootVerdict";
import { parseDetachArgs } from "../service/dev/detachedStart";

/**
 * SPEC — « des ports qui écoutent ne disent pas que l'application est ENTIÈRE ».
 *
 * Un module du manifeste qui ne charge pas est écarté en fail-soft : le boot
 * poursuit, les serveurs montent, et TOUTES les routes de ce module rendent 404.
 * Le mode détaché — celui qui sert la production et la suite e2e de toute
 * application générée — n'avait aucun superviseur pour le dire. Ces tests figent
 * les trois règles qui referment le silence : le verdict se DEMANDE au runtime, il
 * ne se déduit jamais ; l'absence de réponse ne vaut pas absolution ; et le refus
 * NOMME les modules manquants, sinon il ne vaut pas mieux que le silence.
 */

/** Corps de `livez` tel que le rend `KernelAdminApi` à un appelant anonyme. */
const livez = (booted: boolean, degraded: boolean): string =>
  JSON.stringify({ status: "ok", booted, ready: booted, degraded });

describe("probeBootDegraded — le verdict se demande, il ne se déduit pas", () => {
  it("boot terminé et dégradé → true", async () => {
    const p = await probeBootDegraded(5151, {
      fetchLivez: () => Promise.resolve(livez(true, true)),
    });
    expect(p).to.equal(true);
  });

  it("boot terminé et sain → false", async () => {
    const p = await probeBootDegraded(5151, {
      fetchLivez: () => Promise.resolve(livez(true, false)),
    });
    expect(p).to.equal(false);
  });

  it("boot EN COURS → « booting », jamais un verdict", async () => {
    // `degraded` est transitoirement vrai le temps que les serveurs montent :
    // le lire ici ferait crier « dégradé » sur une application saine.
    const p = await probeBootDegraded(5151, {
      fetchLivez: () => Promise.resolve(livez(false, true)),
    });
    expect(p).to.equal("booting");
  });

  it("aucune réponse → « unreachable », et surtout PAS false", async () => {
    // Le point de la distinction : une sonde muette ne certifie rien.
    const p = await probeBootDegraded(5151, {
      fetchLivez: () => Promise.resolve(null),
    });
    expect(p).to.equal("unreachable");
  });

  it("réponse illisible → « unreachable »", async () => {
    const p = await probeBootDegraded(5151, {
      fetchLivez: () => Promise.resolve("<html>proxy</html>"),
    });
    expect(p).to.equal("unreachable");
  });

  it("port absent → « unreachable » sans requête", async () => {
    let appels = 0;
    const p = await probeBootDegraded(undefined, {
      fetchLivez: () => {
        appels++;
        return Promise.resolve(livez(true, false));
      },
    });
    expect(p).to.equal("unreachable");
    expect(appels).to.equal(0);
  });
});

describe("waitBootVerdict — attendre ce qui vient, pas ce qui ne viendra jamais", () => {
  /** Horloge et attente contrôlées : le test ne dort pas, il fait AVANCER le temps. */
  const horloge = (): {
    now: () => number;
    delay: (ms: number) => Promise<void>;
  } => {
    let t = 0;
    return {
      now: () => t,
      delay: (ms: number) => {
        t += ms;
        return Promise.resolve();
      },
    };
  };

  it("re-sonde tant que le boot est EN COURS, puis rend le verdict", async () => {
    let appels = 0;
    const v = await waitBootVerdict(5151, 3000, {
      ...horloge(),
      fetchLivez: () => {
        appels++;
        return Promise.resolve(
          appels < 4 ? livez(false, true) : livez(true, true),
        );
      },
    });
    expect(v).to.equal(true);
    expect(appels).to.equal(4);
  });

  it("un boot qui ne se stabilise pas → null (pas de verdict), pas un rouge", () => {
    return waitBootVerdict(5151, 1000, {
      ...horloge(),
      fetchLivez: () => Promise.resolve(livez(false, true)),
    }).then((v) => {
      expect(v).to.equal(null);
    });
  });

  it("INJOIGNABLE → rend la main TOUT DE SUITE (une seule sonde)", async () => {
    // Sans cette coupure, chaque démarrage d'une application qui n'expose pas
    // cette route en clair paierait la fenêtre de stabilisation entière.
    let appels = 0;
    const v = await waitBootVerdict(5151, 60_000, {
      ...horloge(),
      fetchLivez: () => {
        appels++;
        return Promise.resolve(null);
      },
    });
    expect(v).to.equal(null);
    expect(appels).to.equal(1);
  });

  it("interruption (arrêt, redémarrage) → null sans sonder", async () => {
    let appels = 0;
    const v = await waitBootVerdict(5151, 3000, {
      ...horloge(),
      aborted: () => true,
      fetchLivez: () => {
        appels++;
        return Promise.resolve(livez(true, true));
      },
    });
    expect(v).to.equal(null);
    expect(appels).to.equal(0);
  });
});

describe("extractSkippedModules — un refus qui ne nomme personne ne vaut pas mieux que le silence", () => {
  /** Le format ÉMIS par `Kernel.loadModulesFromManifest` — copié du source. */
  const ligne = (nom: string, motif: string): string =>
    `MODULE LOAD: échec non bloquant (fail-soft) de "${nom}" — ${motif}`;

  it("rend le nom ET le motif de chaque module écarté", () => {
    const journal = [
      "boot start",
      ligne("@app/blog", "Cannot find package '@app/blog'"),
      "MODULE ADD : http",
      ligne("@app/shop", "dist non construit"),
    ].join("\n");
    expect(extractSkippedModules(journal)).to.deep.equal([
      "@app/blog — Cannot find package '@app/blog'",
      "@app/shop — dist non construit",
    ]);
  });

  it("traverse les couleurs du terminal — le journal en porte", () => {
    const journal = `[33m${ligne("@app/blog", "boum")}[39m`;
    expect(extractSkippedModules(journal)).to.deep.equal(["@app/blog — boum"]);
  });

  it("dédoublonne : un module relancé n'est pas deux modules", () => {
    const journal = [
      ligne("@app/blog", "boum"),
      ligne("@app/blog", "boum"),
    ].join("\n");
    expect(extractSkippedModules(journal)).to.have.lengthOf(1);
  });

  it("journal sain → aucun module écarté", () => {
    expect(extractSkippedModules("MODULE ADD : http\nREADY")).to.deep.equal([]);
  });
});

describe("parseDetachArgs — assumer un boot dégradé s'ÉCRIT", () => {
  it("le défaut REFUSE un boot dégradé", () => {
    expect(
      parseDetachArgs(["production", "--detach", "--wait"]).allowDegraded,
    ).to.equal(false);
  });

  it("`--allow-degraded` l'accepte, et n'est PAS relayé au child", () => {
    const p = parseDetachArgs(["production", "--detach", "--allow-degraded"]);
    expect(p.allowDegraded).to.equal(true);
    // Relayé, il serait relu par le child qui, lui, ne détache rien : un drapeau
    // du lanceur n'a rien à faire dans la ligne de commande du runtime.
    expect(p.relayArgs).to.deep.equal(["production"]);
  });
});
