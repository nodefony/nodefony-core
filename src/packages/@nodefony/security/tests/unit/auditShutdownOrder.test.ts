/**
 * ADR-0027 D3 point 4 — l'audit vide son agrégateur dans un store dont le
 * connecteur est encore ouvert, même quand la sécurité est construite AVANT le
 * connecteur de base : sa libération s'inscrit à la résolution du store
 * (`onBoot`), pas à la construction du service.
 */
import assert from "node:assert/strict";
import { CliKernel, Kernel } from "nodefony";
import type { Module } from "nodefony";
import AuditService from "../../nodefony/service/auditService";

let origQuit: typeof CliKernel.quit;
beforeEach(() => {
  origQuit = CliKernel.quit;
  Object.defineProperty(CliKernel, "quit", {
    value: () => {},
    configurable: true,
    writable: true,
  });
});
afterEach(() => {
  Object.defineProperty(CliKernel, "quit", {
    value: origQuit,
    configurable: true,
    writable: true,
  });
});

describe("audit — ordre d'arrêt face au connecteur de base", () => {
  it("la sécurité construite AVANT le connecteur : l'audit est arrêté avant la fermeture de la base", async () => {
    const kernel = new Kernel("development", null, { log: { active: false } });
    const module = {
      container: kernel.container,
      notificationsCenter: kernel.notificationsCenter,
      options: { audit: { enabled: true, store: "memory" } },
    } as unknown as Module;
    // 1. La sécurité est construite d'abord (ordre des modules du manifeste).
    const audit = new AuditService(module);
    // 2. Le connecteur de base ensuite : il inscrit sa fermeture à sa
    //    construction (`DrizzleService`, `MongooseService`).
    let auditActiveWhenDbClosed: boolean | null = null;
    kernel.once("onTerminate", () => {
      auditActiveWhenDbClosed = audit.isEnabled();
    });
    // 3. L'audit résout son store au démarrage.
    kernel.emit("onBoot", kernel);
    assert.equal(audit.isEnabled(), true, "audit non armé : décor faux");
    await kernel.terminate(0);
    assert.equal(
      auditActiveWhenDbClosed,
      false,
      "la base s'est fermée alors que l'audit n'avait pas encore vidé son agrégateur",
    );
  });
});
