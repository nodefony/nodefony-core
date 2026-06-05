/// <reference types="node" />
/**
 * P3.7 — Context.logPhasesVerbose(): trace verbose des phases au teardown.
 *
 * Teste la LOGIQUE de rendu + le triple gate perf-first en isolation (pas de
 * serveur) via `Context.prototype.logPhasesVerbose.call(stub)`. Le gate
 * `_timingVerbose` est résolu au constructeur depuis `kernel.options.timing.verbose`
 * (validé en intégration) ; ici on vérifie qu'en `false` la méthode n'alloue/ne
 * logge RIEN (coût nul prod), et qu'en `true` le format est correct.
 */
import { expect } from "chai";
import Context from "../../src/context/Context";
import type { PhaseTiming } from "../../interfaces/IContext";

type LogCall = [unknown, unknown, unknown];

function makeStub(opts: { verbose: boolean; phases: PhaseTiming[] }): {
  calls: LogCall[];
  ctx: Context;
} {
  const calls: LogCall[] = [];
  const stub = {
    _timingVerbose: opts.verbose,
    phases: opts.phases,
    type: "http",
    log: (pci: unknown, severity?: unknown, msgid?: unknown) => {
      calls.push([pci, severity, msgid]);
    },
  };
  return { calls, ctx: stub as unknown as Context };
}

function run(stub: { ctx: Context }): void {
  (Context.prototype.logPhasesVerbose as () => void).call(stub.ctx);
}

describe("P3.7 — Context.logPhasesVerbose()", () => {
  it("verbose OFF → aucun log (early-return, 0 alloc)", () => {
    const s = makeStub({
      verbose: false,
      phases: [{ name: "parse", startMs: 0, endMs: 1, durationMs: 1 }],
    });
    run(s);
    expect(s.calls).to.have.lengthOf(0);
  });

  it("verbose ON mais phases vides → aucun log", () => {
    const s = makeStub({ verbose: true, phases: [] });
    run(s);
    expect(s.calls).to.have.lengthOf(0);
  });

  it("verbose ON + phases fermées → 1 log DEBUG formaté (noms, durées, total)", () => {
    const s = makeStub({
      verbose: true,
      phases: [
        { name: "parse", startMs: 0, endMs: 0.5, durationMs: 0.5 },
        { name: "action", startMs: 0.5, endMs: 12.8, durationMs: 12.3 },
      ],
    });
    run(s);
    expect(s.calls).to.have.lengthOf(1);
    const [text, severity, msgid] = s.calls[0];
    expect(severity).to.equal("DEBUG");
    expect(msgid).to.equal("http TIMING");
    expect(text).to.be.a("string");
    const str = text as string;
    expect(str).to.contain("TRACE phases");
    expect(str).to.contain("parse=0.50ms");
    expect(str).to.contain("action=12.30ms");
    expect(str).to.contain("·"); // séparateur entre phases
    expect(str).to.contain("Σ 12.80ms"); // total = somme des durées fermées
  });

  it("phase ouverte (endMs absent) → rendue '…' sans casser, total = somme des fermées", () => {
    const s = makeStub({
      verbose: true,
      phases: [
        { name: "parse", startMs: 0, endMs: 1, durationMs: 1 },
        { name: "action", startMs: 1 }, // ouverte — controller en cours
      ],
    });
    run(s);
    expect(s.calls).to.have.lengthOf(1);
    const str = s.calls[0][0] as string;
    expect(str).to.contain("parse=1.00ms");
    expect(str).to.contain("action=…");
    expect(str).to.contain("Σ 1.00ms");
  });

  it("durée dérivée de endMs-startMs si durationMs absent", () => {
    const s = makeStub({
      verbose: true,
      phases: [{ name: "render", startMs: 2, endMs: 4.5 }], // pas de durationMs
    });
    run(s);
    const str = s.calls[0][0] as string;
    expect(str).to.contain("render=2.50ms");
  });
});
