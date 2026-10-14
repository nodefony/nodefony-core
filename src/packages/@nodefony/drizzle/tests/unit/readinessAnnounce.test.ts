import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { Container, CONSOLE_DATA_RUN_PROFILE } from "nodefony";
import type { Module, Pdu } from "nodefony";
import { ormRegistry } from "@nodefony/orm-core";
import DrizzleService from "../../nodefony/service/DrizzleService";

/**
 * Le journal de la sonde de schéma : un état SAIN s'annonce une fois.
 *
 * En `migrations.check: "fail"`, la surveillance revérifie le schéma toutes
 * les 15 s. Chaque passage réécrivait « schéma à jour » : une ligne INFO toutes
 * les 15 s, sans fin, qui noyait le journal sans rien apprendre de neuf.
 */
describe("sonde de schéma — un état sain ne se répète pas", () => {
  let root: string;
  let service: DrizzleService | null = null;
  let terminate: (() => Promise<void>) | null = null;

  beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "nf-readiness-announce-"));
  });
  afterAll(async () => {
    vi.useRealTimers();
    // L'arrêt du service (minuteurs, puis connexions) AVANT d'effacer : sous
    // Windows, un fichier sqlite encore ouvert ne se supprime pas (EPERM).
    await terminate?.();
    await service?.disconnectAll();
    ormRegistry.unregister("default");
    rmSync(root, { recursive: true, force: true });
  });

  it("« schéma à jour » une fois au démarrage, pas à chaque passage de la surveillance", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    // Chaque passage de la sonde se termine par une publication : on attend
    // celle-ci, sinon un passage encore en vol tient la base ouverte.
    let published = 0;
    const container = new Container();
    const kernel = {
      path: root,
      runProfile: { ...CONSOLE_DATA_RUN_PROFILE },
      once: (event: string, cb: () => Promise<void>): void => {
        if (event === "onTerminate") terminate = cb;
      },
      resolveRuntimeEnv: (): string => "production",
      reportBootNotice: (): void => {},
      setReadiness: (): void => {
        published++;
      },
      clearReadiness: (): void => {},
    };
    container.set("kernel", kernel);
    let hook: (() => Promise<void>) | null = null;
    const module = {
      container,
      kernel,
      options: {},
      config: {
        connectors: {
          default: {
            dialect: "sqlite",
            filename: path.join(root, "default.db"),
            ddl: "migrate",
          },
        },
        migrations: { check: "fail" },
      },
      hookKernel: (event: string, cb: () => Promise<void>): unknown => {
        if (event === "onBoot") hook = cb;
        return module;
      },
    };
    service = new DrizzleService(module as unknown as Module);
    const journal: string[] = [];
    service.syslog?.on("onLog", (pdu: Pdu) => {
      journal.push(String(pdu.payload));
    });
    assert.ok(hook, "le service n'a posé aucun hook onBoot");
    await (hook as unknown as () => Promise<void>)();

    const aJour = (): number =>
      journal.filter((l) => l.includes("schéma à jour")).length;
    assert.equal(
      aJour(),
      1,
      `annonce au démarrage : ${JSON.stringify(journal)}`,
    );

    // Trois passages de la surveillance (15 s chacun) sur un schéma inchangé,
    // chacun attendu jusqu'à sa publication.
    const atBoot = published;
    for (let round = 1; round <= 3; round++) {
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.waitFor(() => assert.equal(published, atBoot + round));
    }
    assert.equal(
      aJour(),
      1,
      "un état sain inchangé ne doit pas se réannoncer à chaque passage",
    );
  });
});
