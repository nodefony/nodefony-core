/// <reference types="node" />
/**
 * Unit — fraîcheur d'un canal dans la popup temps réel (anti-clignotement).
 *
 * Le défaut corrigé : un seuil fixe de 1,5 s, lu par une horloge d'écran à 1 Hz
 * sur des stats recopiées à 1 Hz, coupait l'âge d'un canal à 1 s ou 2 s en son
 * milieu — « à l'instant » / « il y a 2s » en alternance à chaque tick. On rejoue
 * ici les âges que l'écran voit réellement, tick par tick.
 */
import { describe, it, expect } from "vitest";
import {
  expectedIntervalMs,
  freshnessLabel,
  freshnessWindowMs,
  STATS_SAMPLE_MS,
} from "../../../frontend/src/utils/channelFreshness";

/**
 * Âges vus par l'écran pendant `seconds` : un canal publie toutes les
 * `cadenceMs`, l'échantillonneur recopie `lastMessage` à 1 Hz (phase `samplePhase`),
 * l'horloge de l'écran avance à 1 Hz (phase `screenPhase`).
 */
function observedAges(
  cadenceMs: number,
  samplePhase: number,
  screenPhase: number,
  seconds = 60,
): number[] {
  const ages: number[] = [];
  for (let k = 1; k <= seconds; k += 1) {
    const now = k * 1000 + screenPhase;
    // dernier échantillonnage avant `now`
    const sampleAt =
      Math.floor((now - samplePhase) / STATS_SAMPLE_MS) * STATS_SAMPLE_MS +
      samplePhase;
    // dernier message publié avant cet échantillonnage
    const lastMessage = Math.floor(sampleAt / cadenceMs) * cadenceMs;
    ages.push(now - lastMessage);
  }
  return ages;
}

describe("fraîcheur d'un canal — le libellé ne clignote plus", () => {
  for (const cadenceMs of [250, 1000, 2000, 5000]) {
    it(`canal à ${cadenceMs} ms : « à l'instant » à chaque tick, toutes phases confondues`, () => {
      const window = freshnessWindowMs(expectedIntervalMs(cadenceMs, []));
      for (const samplePhase of [0, 137, 499, 870, 999]) {
        for (const screenPhase of [0, 250, 501, 999]) {
          const labels = new Set(
            observedAges(cadenceMs, samplePhase, screenPhase).map((a) =>
              freshnessLabel(a, window),
            ),
          );
          expect([...labels], `phases ${samplePhase}/${screenPhase}`).toEqual([
            "à l'instant",
          ]);
        }
      }
    });
  }

  it("cadence inconnue : déduite du débit mesuré (0,5 msg/s → 2 s)", () => {
    expect(expectedIntervalMs(null, [1, 0, 1, 0])).toBe(2000);
    expect(expectedIntervalMs(null, [4, 4])).toBe(250);
    expect(expectedIntervalMs(null, [0, 0])).toBe(null);
    expect(expectedIntervalMs(null, [])).toBe(null);
    expect(expectedIntervalMs(3000, [9])).toBe(3000);
  });

  it("un canal qui se TAIT finit par le dire, en unités entières", () => {
    const window = freshnessWindowMs(1000);
    expect(freshnessLabel(window - 1, window)).toBe("à l'instant");
    expect(freshnessLabel(12_400, window)).toBe("il y a 12s");
    expect(freshnessLabel(185_000, window)).toBe("il y a 3min");
    expect(freshnessLabel(7_300_000, window)).toBe("il y a 2h");
  });
});
