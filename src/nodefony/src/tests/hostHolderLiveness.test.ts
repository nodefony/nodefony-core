/**
 * Les preuves de vie manquées d'un hôte porté (ADR-0030 §D6, audit M6) :
 * publiées dans l'instantané (`missedPongs`), pour que l'enfant — et Studio,
 * par `healthFailures` — voient un hôte qui va mal AVANT qu'il soit tué.
 * Éprouvé sur de VRAIS process : l'hôte de fixture se fige après `ready`.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { HostHolder, type IHostHolderOptions } from "../service/dev/HostHolder";
import type { IHeldHostStatus } from "../service/dev/heldChannel";

const HOST = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "held",
  "host.mjs",
);

const hosts: HostHolder[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.stop()));
});

function makeHost(mode: string, extra: Partial<IHostHolderOptions> = {}) {
  const seen: IHeldHostStatus[] = [];
  const host = new HostHolder({
    key: `liveness:${mode}`,
    module: HOST,
    spec: { mode },
    cwd: path.dirname(HOST),
    env: { ...process.env },
    startupTimeoutMs: 5_000,
    restartBackoffBaseMs: 10,
    restartBackoffMaxMs: 20,
    onStatus: (s) => seen.push(s),
    ...extra,
  });
  hosts.push(host);
  return { host, seen };
}

async function until(
  predicate: () => boolean,
  what: string,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(what);
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe("HostHolder — preuves de vie manquées dans l'instantané", () => {
  it("hôte gelé : le compte monte 1, 2, 3 AVANT la mise à mort ; l'hôte relancé repart de 0", async () => {
    const { host, seen } = makeHost("freeze-after-ready", {
      livenessIntervalMs: 60,
      livenessTimeoutMs: 40,
      livenessMissedLimit: 4,
      maxRestarts: 3,
    });
    const first = await host.start();
    expect(first.missedPongs).to.equal(0);
    await until(
      () => seen.some((s) => s.restartCount >= 1 && s.state === "ready"),
      "jamais relancé",
    );
    // Les comptes publiés de l'hôte GELÉ : croissants, un par tour, jusqu'au plafond.
    const counts = seen
      .filter((s) => s.pid === first.pid)
      .map((s) => s.missedPongs)
      .filter((n, i, all) => i === 0 || n !== all[i - 1]);
    expect(counts.slice(0, 5)).to.deep.equal([0, 1, 2, 3, 4]);
    // L'hôte neuf ne porte pas le compte de celui qu'on a tué.
    const relaunched = seen.find(
      (s) => s.state === "ready" && s.pid !== first.pid,
    );
    expect(relaunched?.missedPongs).to.equal(0);
  });

  it("hôte sain : aucune republication à chaque pong — le compte reste 0 sans bruit", async () => {
    const { host, seen } = makeHost("ok", {
      livenessIntervalMs: 30,
      livenessTimeoutMs: 1_000,
    });
    await host.start();
    const before = seen.length;
    // Une dizaine de tours de preuve de vie, tous à l'heure.
    await new Promise((r) => setTimeout(r, 350));
    expect(seen.length).to.equal(before);
    expect(host.status().missedPongs).to.equal(0);
  });
});
