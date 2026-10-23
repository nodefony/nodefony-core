/**
 * Unit — `describeSource` (`frontend/src/routes/logs/logFormat.ts`) : ce que la
 * page des journaux dit de sa source, dans les trois décors qu'un exploitant
 * rencontre — mémoire de dev, Loki alimenté par l'application, Loki relu
 * seulement (un collecteur l'alimente). Logique pure → aucun DOM.
 */
import { describe, it } from "vitest";
import { expect } from "vitest";
import { describeSource } from "../../../frontend/src/routes/logs/logFormat";
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

  it("data plane plus ancien (sans transports) : on suppose l'application", () => {
    expect(describeSource(meta("opensearch", undefined)).feeder).toBe("app");
  });
});
