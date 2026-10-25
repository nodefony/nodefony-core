import assert from "node:assert/strict";
import {
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTestbedReport,
  normalizeExpectations,
  suiteLabel,
  type ITestbedInput,
} from "../../../../../scripts/test/lib/testbed.ts";
import type {
  EnvGate,
  ITestbedEntry,
} from "../../../../../scripts/test/vitest/gates.ts";
import { probeTestbedCapability } from "../admin/testbedReport";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");

const pg: EnvGate = {
  label: "PG",
  service: { name: "postgres", profile: "postgres" },
  values: () => ({ NF_PG_URL: "postgres://u:secret@h/db" }),
};
const maria: EnvGate = {
  label: "MariaDB",
  service: { name: "mariadb" },
  values: () => ({ NF_MYSQL_URL: "mysql://u:pw@h:3306/db" }),
};
const community: EnvGate = {
  label: "MySQL",
  service: { name: "mysql" },
  values: () => ({ NF_MYSQL_URL: "mysql://u:pw@h:3307/db" }),
};
const proxy: EnvGate = {
  label: "Proxy",
  service: { name: "nginx", companions: ["haproxy"] },
  values: () => ({ NF_PROXY_URL: "http://localhost:8080" }),
  serverEnv: ["NF_BIND_ALL"],
};
const idp: EnvGate = {
  label: "IdP",
  service: { name: "keycloak" },
  values: () => ({ NF_IDP_CLIENT_SECRET: "très-secret" }),
};

const entry = (
  id: string,
  gate: EnvGate,
  extra: Partial<ITestbedEntry> = {},
): ITestbedEntry => ({ id, gate, family: "database", purpose: id, ...extra });

function input(over: Partial<ITestbedInput> = {}): ITestbedInput {
  return {
    catalog: [
      entry("postgres", pg),
      entry("mariadb", maria),
      entry("mysql", community, { phase: "--dialects" }),
      entry("proxy", proxy, { family: "network" }),
      entry("idp", idp, { family: "identity" }),
    ],
    testAllGates: [pg, maria, idp],
    switches: [{ env: "NF_RUN_X", what: "x" }],
    tools: [{ service: "grafana", label: "Grafana", what: "g" }],
    suites: [
      {
        label: "drizzle",
        config: "src/packages/@nodefony/drizzle/vitest.config.ts",
        expectations: [
          { gate: pg, proof: "(postgres)" },
          { gate: maria, proof: ["a", "b"] },
        ],
      },
      {
        label: "http · proxy",
        config: "src/packages/@nodefony/http/vitest.proxy.config.ts",
        expectations: [{ gate: proxy }, { gate: idp }],
      },
    ],
    switchReaders: { NF_RUN_X: ["core"] },
    composeServices: [
      "postgres",
      "mariadb",
      "mysql",
      "nginx",
      "haproxy",
      "keycloak",
      "grafana",
    ],
    containers: {
      postgres: "healthy",
      mariadb: "running",
      mysql: "healthy",
      nginx: "running",
      haproxy: "stopped",
      keycloak: "starting",
      grafana: "running",
    },
    env: {},
    ...over,
  };
}

const box = (report: ReturnType<typeof buildTestbedReport>, id: string) => {
  const found = report.testbeds.find((d) => d.id === id);
  assert.ok(found, `boîte ${id} absente`);
  return found;
};

describe("Décors — producteur des boîtes (scripts/test/lib/testbed.ts)", () => {
  it("un décor est prêt quand TOUS ses services tournent, partiel sinon", () => {
    const r = buildTestbedReport(input());
    assert.equal(box(r, "postgres").state, "ready");
    assert.equal(box(r, "mariadb").state, "ready");
    // nginx tourne, haproxy est arrêté : le décor est à moitié là.
    assert.equal(box(r, "proxy").state, "partial");
    // « starting » n'est pas prêt : PostgreSQL rejoue son WAL, Keycloak importe son realm.
    assert.equal(box(r, "idp").state, "down");
  });

  it("docker injoignable : état inconnu, jamais « arrêté »", () => {
    const r = buildTestbedReport(input({ containers: null }));
    assert.equal(r.docker, false);
    assert.ok(r.testbeds.every((d) => d.state === "unknown"));
    assert.ok(r.tools.every((t) => t.state === "unknown"));
  });

  it("masque un secret par le NOM de sa variable, et le mot de passe d'une URL", () => {
    const r = buildTestbedReport(input());
    assert.deepEqual(box(r, "idp").vars, [
      { name: "NF_IDP_CLIENT_SECRET", value: "***" },
    ]);
    assert.equal(box(r, "postgres").vars[0]?.value, "postgres://u:***@h/db");
  });

  it("dit quelles variables manquent au versant SERVEUR", () => {
    assert.deepEqual(box(buildTestbedReport(input()), "proxy").server, {
      required: ["NF_BIND_ALL"],
      missing: ["NF_BIND_ALL"],
    });
    const posed = buildTestbedReport(input({ env: { NF_BIND_ALL: "1" } }));
    assert.deepEqual(box(posed, "proxy").server?.missing, []);
    assert.equal(box(posed, "postgres").server, null);
  });

  it("signale deux décors qui posent la même variable", () => {
    const r = buildTestbedReport(input());
    assert.deepEqual(box(r, "mariadb").sharedWith, ["mysql"]);
    assert.deepEqual(box(r, "mysql").sharedWith, ["mariadb"]);
  });

  it("relie chaque décor aux suites qui l'exigent, avec le compte de preuves", () => {
    const r = buildTestbedReport(input());
    assert.deepEqual(box(r, "mariadb").suites, [
      {
        label: "drizzle",
        config: "src/packages/@nodefony/drizzle/vitest.config.ts",
        proofs: 2,
      },
    ]);
  });

  it("dit qui lève le décor : passe par défaut, option, ou personne", () => {
    const r = buildTestbedReport(input());
    assert.equal(box(r, "postgres").playedBy, "default");
    assert.equal(box(r, "mysql").playedBy, "phase");
    assert.equal(box(r, "proxy").playedBy, "manual");
    assert.equal(
      box(r, "proxy").upCommand,
      "docker compose -f docker/docker-compose.yml up -d nginx haproxy",
    );
  });
});

describe("Décors — angles morts CALCULÉS", () => {
  const kinds = (r: ReturnType<typeof buildTestbedReport>) =>
    r.blindSpots.map((b) => `${b.kind}:${b.subject}`).sort();

  it("décor qu'aucune passe ne lève, et suite qui n'exige rien", () => {
    const base = input();
    const r = buildTestbedReport({
      ...base,
      suites: [
        ...base.suites,
        {
          label: "http · load",
          config: "x/vitest.load.config.ts",
          expectations: [],
        },
        { label: "z", config: "z/vitest.config.ts", expectations: null },
      ],
    });
    assert.deepEqual(kinds(r), [
      "suite-unreadable:z",
      "suite-without-expectation:http · load",
      "testbed-without-pass:proxy",
    ]);
  });

  it("décor qu'aucune suite n'exige, hors passe dédiée", () => {
    const base = input();
    const r = buildTestbedReport({ ...base, suites: [] });
    // mysql a sa passe (--dialects) : pas un trou. Les autres, si.
    assert.deepEqual(
      kinds(r).filter((k) => k.startsWith("testbed-without-suite")),
      [
        "testbed-without-suite:idp",
        "testbed-without-suite:mariadb",
        "testbed-without-suite:postgres",
        "testbed-without-suite:proxy",
      ],
    );
  });

  it("service du compose qui n'appartient à aucun décor ni à aucun outil", () => {
    const r = buildTestbedReport(
      input({ composeServices: [...input().composeServices, "kafka"] }),
    );
    assert.deepEqual(
      kinds(r).filter((k) => k.startsWith("orphan-service")),
      ["orphan-service:kafka"],
    );
    // Le compagnon déclaré n'est PAS orphelin : c'était le trou du proxy.
    assert.ok(!kinds(r).includes("orphan-service:haproxy"));
  });

  it("le trou bouché, l'angle mort disparaît de lui-même", () => {
    const r = buildTestbedReport(
      input({ testAllGates: [pg, maria, idp, proxy] }),
    );
    assert.deepEqual(kinds(r), []);
  });
});

describe("Décors — interrupteurs et outils", () => {
  it("un interrupteur est ouvert à `1`, et réunit suites déclarées et lectrices", () => {
    const base = input();
    const r = buildTestbedReport({
      ...base,
      env: { NF_RUN_X: "1" },
      suites: [
        ...base.suites,
        {
          label: "realtime · cluster",
          config: "c/vitest.cluster.config.ts",
          expectations: [{ switch: "NF_RUN_X" }],
        },
      ],
    });
    assert.deepEqual(r.switches, [
      {
        env: "NF_RUN_X",
        what: "x",
        open: true,
        suites: ["core", "realtime · cluster"],
      },
    ]);
  });

  it("libellé lisible d'une config", () => {
    assert.equal(suiteLabel("src/nodefony/vitest.config.ts"), "core");
    assert.equal(
      suiteLabel("src/packages/@nodefony/http/vitest.proxy.config.ts"),
      "http · proxy",
    );
    assert.equal(
      suiteLabel("src/packages/@nodefony/redis/vitest.config.ts"),
      "redis",
    );
  });

  it("accepte la forme fonction et la gate nue", () => {
    assert.deepEqual(
      normalizeExpectations(() => [pg]),
      [{ gate: pg }],
    );
    assert.equal(normalizeExpectations(42), null);
  });
});

describe("Décors — contrat du dépôt", () => {
  it("toute config qui appelle le rapporteur EXPORTE ses attentes", () => {
    const configs = globSync("src/**/vitest*.config.ts", {
      cwd: REPO,
      exclude: (p: string) => /node_modules|dist/.test(p),
    });
    const callers = configs.filter((c) =>
      readFileSync(join(REPO, c), "utf8").includes("gateReporter("),
    );
    assert.ok(callers.length >= 12, `${callers.length} configs seulement`);
    const silent = callers.filter(
      (c) =>
        !readFileSync(join(REPO, c), "utf8").includes(
          "export const expectations",
        ),
    );
    assert.deepEqual(silent, []);
  });
});

describe("Décors — capacité constatée (le verrou « dépôt seul »)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nf-testbed-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("hors du dépôt du framework : supported false, avec la raison", async () => {
    const cap = await probeTestbedCapability(root);
    assert.equal(cap.supported, false);
    assert.match(
      cap.supported ? "" : cap.reason,
      /scripts\/test\/testbed-report\.ts absent/,
    );
  });

  it("un seul fichier manquant suffit à refuser", async () => {
    for (const parts of [
      ["scripts", "test", "testbed-report.ts"],
      ["docker", "docker-compose.yml"],
    ]) {
      mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
      writeFileSync(join(root, ...parts), "");
    }
    const cap = await probeTestbedCapability(root);
    assert.equal(cap.supported, false);
    assert.match(cap.supported ? "" : cap.reason, /tsx/);
  });

  it("racine inconnue : refus", async () => {
    assert.equal((await probeTestbedCapability(null)).supported, false);
  });

  it("dans le dépôt : supported true", async () => {
    assert.deepEqual(await probeTestbedCapability(REPO), { supported: true });
  });
});
