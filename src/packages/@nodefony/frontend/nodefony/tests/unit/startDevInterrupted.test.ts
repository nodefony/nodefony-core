/// <reference types="node" />
/**
 * Unit — un démarrage du front INTERROMPU par un arrêt n'est pas un échec.
 *
 * Le décor vécu : sous `nodefony development`, le superviseur relance le
 * serveur pendant que celui-ci démarre encore ses familles Vite (une rafale de
 * fichiers modifiés). `stopDev` ferme le client des services portés au milieu
 * de `startDev` : chaque famille rejette (« client closed »), et le journal
 * portait quatre ERROR — trois familles « failed to start », puis « no
 * frontend family could start » — pour un arrêt VOULU, sans aucune panne.
 *
 * `startFamily` est remplacé par un double qui attend l'arrêt puis rejette,
 * comme le ferait le vrai teneur : ce banc ne démarre aucun Vite.
 */
import { describe, expect, it } from "vitest";
import { Container } from "nodefony";
import FrontendService from "../../service/FrontendService";
import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder";

function fakeModule() {
  const noop = () => undefined;
  const container = new Container();
  container.set("kernel", {
    environment: "development",
    domain: "nodefony.com",
    fire: noop,
  });
  container.set("firewall", {
    registerCspOrigins: noop,
    unregisterCspOrigins: noop,
  });
  return {
    kernel: container.get("kernel"),
    container,
    notificationsCenter: { on: noop, fire: noop, removeListener: noop },
    options: {},
    log: noop,
  } as unknown as ConstructorParameters<typeof FrontendService>[0];
}

function entry(entryName: string, type: string): IResolvedFrontendEntry {
  return {
    entryName,
    type,
    root: "/tmp/nodefony-interrupted-banc",
    entryFile: "src/main.ts",
    outDir: "/tmp/nodefony-interrupted-banc/dist",
    publicPath: `/_assets/${entryName}/`,
  } as unknown as IResolvedFrontendEntry;
}

/** Un service dont chaque famille rejette quand `release()` est appelé. */
function bench() {
  const svc = new FrontendService(fakeModule());
  const errors: string[] = [];
  (svc as unknown as { log: (m: unknown, s?: string) => void }).log = (
    message,
    severity,
  ) => {
    if (severity === "ERROR") errors.push(String(message));
  };
  (svc as unknown as { entries: IResolvedFrontendEntry[] }).entries.push(
    entry("app", "react19"),
    entry("ng", "angular"),
  );
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  (svc as unknown as { startFamily: () => Promise<void> }).startFamily =
    async () => {
      await released;
      throw new Error('held services of "frontend": client closed');
    };
  return { svc, errors, release };
}

describe("startDev interrompu par un arrêt", () => {
  it("témoin : sans arrêt, des familles qui rejettent sont un ÉCHEC — ERROR et rejet", async () => {
    const { svc, errors, release } = bench();
    const started = svc.startDev();
    release();
    await expect(started).rejects.toThrow("no frontend family could start");
    expect(errors.length).to.equal(2);
  });

  it("arrêt pendant le démarrage : aucun ERROR, et startDev se résout", async () => {
    const { svc, errors, release } = bench();
    const started = svc.startDev();
    await svc.stopDev();
    release();
    await expect(started).resolves.toBeUndefined();
    expect(errors, errors.join("\n")).to.deep.equal([]);
  });
});
