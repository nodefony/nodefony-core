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
import { HELD_HOST_CWD } from "./fixtures/held/hostCwd";

const HOST = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "held",
  "host.mjs",
);

const ROGUE = path.join(path.dirname(HOST), "rogue.mjs");

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
    cwd: HELD_HOST_CWD,
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

  it("🔴 pong plus lent qu'un tour mais dans son délai : rien de manqué, aucune republication", async () => {
    // Le cas d'une machine chargée, rendu CERTAIN : chaque pong part après
    // 80 ms, soit plus de deux tours de 30 ms, et bien avant le délai de 1 s.
    // Le contrat (`livenessTimeoutMs`) dit qu'il est à l'heure.
    let pongs = 0;
    const { host, seen } = makeHost("slow-pong", {
      module: ROGUE,
      spec: { mode: "slow-pong", pongDelayMs: 80 },
      livenessIntervalMs: 30,
      livenessTimeoutMs: 1_000,
      onOutput: (_stream, lines) => {
        pongs += lines.toString("utf8").split("pong ").length - 1;
      },
    });
    await host.start();
    const before = seen.length;
    // Un FAIT, pas une durée : cinq preuves de vie rendues, toutes en retard
    // sur le tour, toutes dans le délai.
    await until(() => pongs >= 5, "moins de cinq pongs rendus");
    expect(seen.length, "aucune republication").to.equal(before);
    expect(host.status().missedPongs).to.equal(0);
  });
});
