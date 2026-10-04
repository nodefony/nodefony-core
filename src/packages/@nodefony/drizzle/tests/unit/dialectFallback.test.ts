import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BootConfigurationError,
  Container,
  CONSOLE_DATA_RUN_PROFILE,
} from "nodefony";
import type { IBootNotice, Module, Pdu } from "nodefony";
import { ormRegistry } from "@nodefony/orm-core";
import DrizzleService from "../../nodefony/service/DrizzleService";
import { isDialectFallback } from "../../nodefony/config/defineModuleConfig";

/**
 * **Le repli sur sqlite ne vise jamais un dialecte que les entités ne parlent
 * pas, et il se DIT quand il a lieu.**
 *
 * Constaté sur une application générée pour postgres, `NF_DATABASE_URL`
 * commentée : le connecteur `default` retombait sur sqlite en silence, puis
 * échouait sur le pilote absent (`better-sqlite3`) — une dépendance désignée,
 * alors que la cause était une variable d'environnement manquante.
 */

const INFRA_VARS = ["NF_DATABASE_URL", "DATABASE_URL"] as const;

/**
 * Une application dont l'entité fige son dialecte, dans l'écriture du gabarit
 * (`User.ts.tpl`) — que le banc de `doctor` confronte au gabarit lui-même.
 */
function appWithEntity(dialect: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "nf-fallback-"));
  mkdirSync(path.join(root, "nodefony", "entity"), { recursive: true });
  writeFileSync(
    path.join(root, "nodefony", "entity", "User.ts"),
    `import type { SqlDialect } from "@nodefony/drizzle";\n` +
      `const DIALECT = "${dialect}" as const satisfies SqlDialect;\n` +
      `export const table = DIALECT;\n`,
  );
  return root;
}

/** Démarre le service sur cette application, sans connecteur déclaré. */
async function boot(
  root: string,
  journal: string[],
  notices: IBootNotice[] = [],
): Promise<{ service: DrizzleService; run: Promise<void> }> {
  const container = new Container();
  const kernel = {
    path: root,
    runProfile: { ...CONSOLE_DATA_RUN_PROFILE },
    once: (): void => {},
    resolveRuntimeEnv: (): string => "development",
    setReadiness: (): void => {},
    reportBootNotice: (notice: IBootNotice): void => {
      notices.push(notice);
    },
  };
  container.set("kernel", kernel);
  let hook: (() => Promise<void>) | null = null;
  const module = {
    container,
    kernel,
    options: {},
    // Ce que l'application a ÉCRIT : rien — le connecteur vient du défaut.
    appOptions: {},
    // Ce que le parse rend : le dialecte du défaut Zod, indiscernable d'un écrit.
    config: { connectors: { default: { dialect: "sqlite", ddl: "auto" } } },
    hookKernel: (event: string, cb: () => Promise<void>): unknown => {
      if (event === "onBoot") hook = cb;
      return module;
    },
  };
  const service = new DrizzleService(module as unknown as Module);
  service.syslog?.on("onLog", (pdu: Pdu) => journal.push(String(pdu.payload)));
  assert.ok(hook, "le service n'a posé aucun hook onBoot");
  return { service, run: (hook as unknown as () => Promise<void>)() };
}

describe("repli sqlite — refusé sur des entités d'un autre dialecte, annoncé sinon", () => {
  const saved: Partial<
    Record<(typeof INFRA_VARS)[number], string | undefined>
  > = {};
  const roots: string[] = [];

  beforeAll(() => {
    for (const v of INFRA_VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
  });
  afterAll(() => {
    for (const v of INFRA_VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  it("isDialectFallback : seul le connecteur principal sans rien d'écrit ni d'infra se replie", () => {
    const connectors = { default: {}, analytics: {} };
    assert.equal(isDialectFallback("default", connectors, {}, {}), true);
    assert.equal(
      isDialectFallback(
        "default",
        connectors,
        {},
        {
          NF_DATABASE_URL: "postgres://u:p@h:5432/db",
        },
      ),
      false,
      "l'infrastructure déclarée a choisi le dialecte",
    );
    assert.equal(
      isDialectFallback(
        "default",
        connectors,
        { connectors: { default: { dialect: "sqlite" } } },
        {},
      ),
      false,
      "un `dialect` écrit est un choix, pas un repli",
    );
    assert.equal(
      isDialectFallback(
        "default",
        connectors,
        { connectors: { default: { filename: ":memory:" } } },
        {},
      ),
      false,
      "un `filename` écrit désigne sqlite",
    );
    assert.equal(
      isDialectFallback("analytics", connectors, {}, {}),
      false,
      "un secondaire n'est jamais configuré par l'infrastructure",
    );
  });

  it("🔴 entités postgres, aucune adresse : le démarrage REFUSE et nomme la cause", async () => {
    const root = appWithEntity("postgres");
    roots.push(root);
    const { run } = await boot(root, []);
    await assert.rejects(run, (e: unknown) => {
      assert.ok(e instanceof BootConfigurationError, String(e));
      assert.match(e.message, /écrite pour postgres/u);
      assert.match(e.message, /NF_DATABASE_URL/u);
      assert.match(e.message, /nodefony[/\\]entity[/\\]User\.ts/u);
      assert.doesNotMatch(e.message, /better-sqlite3/u);
      return true;
    });
    assert.equal(
      existsSync(path.join(root, "var", "databases")),
      false,
      "le refus précède toute création de base",
    );
    ormRegistry.unregister("default");
  });

  it("🔴 entités sqlite, aucune adresse : le repli a lieu ET s'annonce avec son fichier", async () => {
    const root = appWithEntity("sqlite");
    roots.push(root);
    const journal: string[] = [];
    const notices: IBootNotice[] = [];
    const { service, run } = await boot(root, journal, notices);
    await run;
    try {
      const line = journal.find((l) => l.includes("repli sur sqlite"));
      assert.ok(line, `repli non annoncé : ${JSON.stringify(journal)}`);
      assert.ok(
        line.includes(path.join(root, "var", "databases")),
        `le fichier employé n'est pas nommé : ${line}`,
      );
      // Et au BILAN de démarrage (#533) : en haut de l'écran, chemin relatif.
      const notice = notices.find((n) => n.code === "DB_SQLITE_FALLBACK");
      assert.ok(notice, `repli absent du bilan : ${JSON.stringify(notices)}`);
      assert.ok(
        notice.message.includes(`(${path.join("var", "databases")}`),
        `chemin non relatif au projet : ${notice.message}`,
      );
      assert.ok(!notice.message.includes(root), notice.message);
    } finally {
      await service.disconnectAll();
      ormRegistry.unregister("default");
    }
  });
});
