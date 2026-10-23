/**
 * Unit — `describeSource` (`frontend/src/routes/logs/logFormat.ts`) : ce que la
 * page des journaux dit de sa source, dans les trois décors qu'un exploitant
 * rencontre — mémoire de dev, Loki alimenté par l'application, Loki relu
 * seulement (un collecteur l'alimente). Logique pure → aucun DOM.
 */
import { describe, it } from "vitest";
import { expect } from "vitest";
import {
  STALE_AFTER_MS,
  describeFreshness,
  describeSource,
  fmtAge,
} from "../../../frontend/src/routes/logs/logFormat";
import type {
  BackplaneMeta,
  TransportInfo,
} from "../../../frontend/src/routes/logs/logsTypes";

const meta = (
  driver: string,
  transports: TransportInfo[] | undefined,
): BackplaneMeta => ({
  activeDriver: {
    name: driver,
    capabilities: { write: driver !== "memory", query: true, stream: false },
  },
  drivers: [],
  write: {
    sink: "stdout",
    ...(transports === undefined ? {} : { transports }),
  },
  counters: {
    valid: 0,
    invalid: 0,
    missed: 0,
    errorTotal: 0,
    criticTotal: 0,
    buffered: 1820,
    bufferCapacity: 2000,
  },
  environment: "development",
});

describe("describeSource", () => {
  it("méta absente : une attente qui ne nomme rien de faux", () => {
    const d = describeSource(null);
    expect(d.driverName).toBe(null);
    expect(d.loadingMessage).toBe("Lecture de la source des journaux…");
  });

  it("mémoire : ce processus, son remplissage, l'effacement au redémarrage", () => {
    const d = describeSource(
      meta("memory", [{ name: "console", enabled: true }]),
    );
    expect(d.feeder).toBe("process");
    expect(d.remote).toBe(false);
    expect(d.label).toBe("la mémoire de ce processus");
    expect(d.feederText).toBe(
      "1820 lignes gardées sur 2000, effacées au redémarrage",
    );
    expect(d.loadingMessage).toBe("Lecture de la mémoire de ce processus…");
  });

  it("Loki avec un transport loki actif : alimenté par l'application", () => {
    const d = describeSource(
      meta("loki", [
        { name: "console", enabled: true },
        { name: "loki", enabled: true },
      ]),
    );
    expect(d.feeder).toBe("app");
    expect(d.remote).toBe(true);
    expect(d.label).toBe("Grafana Loki");
    expect(d.feederText).toBe("alimenté par cette application");
  });

  it("Loki sans transport loki (relecture seule) : un collecteur externe", () => {
    const d = describeSource(meta("loki", [{ name: "file", enabled: true }]));
    expect(d.feeder).toBe("collector");
    expect(d.feederText).toContain("collecteur externe");
    expect(d.emptyMessage).toContain("Vérifiez que le collecteur tourne");
  });

  it("transport loki présent mais coupé : c'est encore un collecteur", () => {
    const d = describeSource(meta("loki", [{ name: "loki", enabled: false }]));
    expect(d.feeder).toBe("collector");
  });

  it("cartes de la Source : qui envoie, où c'est gardé, ce qui s'écrit d'autre", () => {
    const mem = describeSource(
      meta("memory", [
        { name: "console", enabled: true },
        { name: "file", enabled: false },
      ]),
    );
    expect(mem.senderText).toBe("Ce processus lui-même.");
    expect(mem.retentionText).toContain("effacées au redémarrage");
    expect(mem.alsoWrites).toEqual(["Console (stdout)"]);

    const pushed = describeSource(
      meta("loki", [
        { name: "console", enabled: true },
        { name: "loki", enabled: true },
      ]),
    );
    expect(pushed.senderText).toContain("NF_LOG_PUSH=true");
    // La source elle-même n'est pas « écrite en plus ».
    expect(pushed.alsoWrites).toEqual(["Console (stdout)"]);

    const collected = describeSource(
      meta("loki", [{ name: "console", enabled: true }]),
    );
    expect(collected.senderText).toContain("collecteur externe");
    expect(collected.retentionText).toBe(
      "Dans Grafana Loki, selon sa rétention. Rien n'est gardé sur ce serveur.",
    );
  });

  it("data plane plus ancien (sans transports) : on suppose l'application", () => {
    expect(describeSource(meta("opensearch", undefined)).feeder).toBe("app");
  });
});

describe("describeFreshness", () => {
  const NOW = 1_800_000_000_000;
  const memory = describeSource(meta("memory", []));
  const collected = describeSource(
    meta("loki", [{ name: "file", enabled: true }]),
  );

  it("pas encore lu : rien à dire", () => {
    expect(describeFreshness(collected, undefined, NOW)).toEqual({
      text: "",
      stale: false,
    });
  });

  it("source distante muette depuis 6 h : signalée", () => {
    const f = describeFreshness(collected, NOW - 6 * 3_600_000, NOW);
    expect(f).toEqual({ text: "dernière ligne il y a 6 h", stale: true });
  });

  it("source distante récente : pas d'alerte, seuil compris", () => {
    expect(describeFreshness(collected, NOW - STALE_AFTER_MS, NOW).stale).toBe(
      false,
    );
    expect(
      describeFreshness(collected, NOW - STALE_AFTER_MS - 1, NOW).stale,
    ).toBe(true);
  });

  it("mémoire d'un processus calme : jamais périmée", () => {
    expect(describeFreshness(memory, NOW - 6 * 3_600_000, NOW).stale).toBe(
      false,
    );
  });

  it("source distante vide : signalée", () => {
    expect(describeFreshness(collected, null, NOW)).toEqual({
      text: "aucune ligne reçue",
      stale: true,
    });
  });

  it("fmtAge : à l'instant, secondes, minutes, heures, jours", () => {
    expect(fmtAge(2_000)).toBe("à l'instant");
    expect(fmtAge(12_000)).toBe("il y a 12 s");
    expect(fmtAge(6 * 60_000)).toBe("il y a 6 min");
    expect(fmtAge(3 * 3_600_000)).toBe("il y a 3 h");
    expect(fmtAge(3 * 86_400_000)).toBe("il y a 3 j");
  });
});
