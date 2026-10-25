/**
 * Producteur PUR de l'onglet Décors de la console (`/nodefony/config?tab=testbed`).
 *
 * Il assemble ce que le dépôt DÉCLARE (catalogue des décors, attentes des
 * configs vitest, passe par défaut de `test:all`, outils du compose) et ce que
 * la machine CONSTATE (état des conteneurs, environnement du serveur) en boîtes
 * prêtes à afficher — et calcule les angles morts plutôt que de les écrire :
 * une liste rédigée à la main ment dès le premier refactor, une règle se vide
 * d'elle-même quand le trou est bouché.
 *
 * Aucune entrée/sortie ici : le script `scripts/test/testbed-report.ts` collecte,
 * cette fonction décide. C'est ce qui la rend testable sans docker.
 */
import {
  asExpectation,
  gateUpCommand,
  redactValue,
  type TestbedFamily,
  type EnvGate,
  type GateExpectation,
  type ITestbedEntry,
  type IDevTool,
} from "../vitest/gates.ts";

/** État d'un conteneur, tel que `docker inspect` le rend. */
export type ContainerState =
  "healthy" | "running" | "starting" | "unhealthy" | "stopped" | "absent";

/** Une passe vitest et ce qu'elle déclare exiger. */
export interface ITestbedSuite {
  /** Libellé lisible (`http · proxy`), voir {@link suiteLabel}. */
  label: string;
  /** Chemin de la config, relatif à la racine, en `/`. */
  config: string;
  /** Attentes exportées ; `null` = la config appelle le rapporteur sans les exporter. */
  expectations: readonly GateExpectation[] | null;
}

/** Ce que le producteur reçoit. */
export interface ITestbedInput {
  catalog: readonly ITestbedEntry[];
  testAllGates: readonly EnvGate[];
  switches: ReadonlyArray<{ env: string; what: string }>;
  tools: readonly IDevTool[];
  suites: readonly ITestbedSuite[];
  /** Interrupteur → paquets dont un test le lit (constaté dans les sources). */
  switchReaders: Readonly<Record<string, readonly string[]>>;
  composeServices: readonly string[];
  /** Service → état ; `null` quand docker ne répond pas. */
  containers: Readonly<Record<string, ContainerState>> | null;
  /** Environnement du SERVEUR (pas du process de test). */
  env: Readonly<Record<string, string | undefined>>;
}

/** Une boîte de l'onglet. */
export interface ITestbedBox {
  id: string;
  label: string;
  family: TestbedFamily;
  purpose: string;
  /** `unknown` quand docker ne répond pas. */
  state: "ready" | "partial" | "down" | "unknown";
  services: Array<{ name: string; state: ContainerState | "unknown" }>;
  vars: Array<{ name: string; value: string }>;
  /** Autres décors qui posent une même variable (`NF_MYSQL_URL`). */
  sharedWith: string[];
  /** Versant serveur, quand le décor en a un. */
  server: { required: string[]; missing: string[] } | null;
  suites: Array<{ label: string; config: string; proofs: number }>;
  /** Qui lève ce décor : la passe par défaut, une option, ou personne. */
  playedBy: "default" | "phase" | "manual";
  phase: string | null;
  upCommand: string | null;
  note: string | null;
}

/** Un trou constaté par une règle. */
export interface IBlindSpot {
  kind:
    | "testbed-without-pass"
    | "testbed-without-suite"
    | "suite-without-expectation"
    | "suite-unreadable"
    | "orphan-service";
  subject: string;
  detail: string;
}

/** Le rapport complet de l'onglet. */
export interface ITestbedReport {
  docker: boolean;
  testbeds: ITestbedBox[];
  switches: Array<{
    env: string;
    what: string;
    open: boolean;
    suites: string[];
  }>;
  tools: Array<{
    service: string;
    label: string;
    what: string;
    oneShot: boolean;
    state: ContainerState | "unknown";
  }>;
  blindSpots: IBlindSpot[];
}

/**
 * Libellé lisible d'une config vitest, d'après son chemin.
 *
 * @param config - chemin relatif en `/` (`src/packages/@nodefony/http/vitest.proxy.config.ts`)
 * @returns `http · proxy`, `core`, `redis`…
 */
export function suiteLabel(config: string): string {
  const parts = config.split("/");
  const file = parts.at(-1) ?? config;
  const pkg = config.startsWith("src/nodefony/")
    ? "core"
    : (parts.at(-2) ?? "?");
  const lot = /^vitest\.(.+)\.config\.ts$/.exec(file)?.[1];
  return lot ? `${pkg} · ${lot}` : pkg;
}

/**
 * Ramène les attentes exportées par une config à une liste.
 *
 * @param exported - la valeur de `export const expectations`, quelle qu'elle soit
 * @returns la liste, ou `null` si la valeur n'a pas la forme attendue
 */
export function normalizeExpectations(
  exported: unknown,
): GateExpectation[] | null {
  // La forme fonction (`GateExpectations`) est appelée comme le ferait le
  // rapporteur en fin de passe.
  const list: unknown =
    typeof exported === "function"
      ? Reflect.apply(exported, undefined, [])
      : exported;
  if (!Array.isArray(list)) return null;
  return list
    .filter(
      (e): e is EnvGate | GateExpectation =>
        typeof e === "object" && e !== null,
    )
    .map((e) => asExpectation(e));
}

function proofCount(e: GateExpectation): number {
  if (e.proof === undefined) return 0;
  return typeof e.proof === "string" ? 1 : e.proof.length;
}

function isBlank(env: ITestbedInput["env"], name: string): boolean {
  return (env[name] ?? "").trim() === "";
}

const UP: ReadonlySet<ContainerState> = new Set(["healthy", "running"]);

/**
 * Construit les boîtes de l'onglet Décors et ses angles morts.
 *
 * @param input - déclarations du dépôt + constats de la machine
 * @returns le rapport, sans un octet d'entrée/sortie
 */
export function buildTestbedReport(input: ITestbedInput): ITestbedReport {
  const { catalog, containers, env } = input;
  const stateOf = (service: string): ContainerState | "unknown" =>
    containers === null ? "unknown" : (containers[service] ?? "absent");

  const varsById = new Map<string, string[]>();
  for (const entry of catalog) {
    varsById.set(entry.id, Object.keys(entry.gate.values()));
  }

  const blindSpots: IBlindSpot[] = [];
  const testbeds = catalog.map((entry): ITestbedBox => {
    const { gate } = entry;
    const serviceNames = gate.service
      ? [gate.service.name, ...(gate.service.companions ?? [])]
      : [];
    const services = serviceNames.map((name) => ({
      name,
      state: stateOf(name),
    }));
    const upCount = services.filter(
      (s) => s.state !== "unknown" && UP.has(s.state),
    ).length;
    const state: ITestbedBox["state"] =
      containers === null
        ? "unknown"
        : upCount === services.length
          ? "ready"
          : upCount === 0
            ? "down"
            : "partial";

    const values = gate.values();
    const names = Object.keys(values);
    const sharedWith = catalog
      .filter(
        (other) =>
          other.id !== entry.id &&
          (varsById.get(other.id) ?? []).some((n) => names.includes(n)),
      )
      .map((other) => other.id);

    const suites = input.suites.flatMap((suite) => {
      const mine = (suite.expectations ?? []).filter((e) => e.gate === gate);
      if (mine.length === 0) return [];
      return [
        {
          label: suite.label,
          config: suite.config,
          proofs: mine.reduce((n, e) => n + proofCount(e), 0),
        },
      ];
    });

    const playedBy: ITestbedBox["playedBy"] = input.testAllGates.includes(gate)
      ? "default"
      : entry.phase
        ? "phase"
        : "manual";

    if (playedBy === "manual") {
      blindSpots.push({
        kind: "testbed-without-pass",
        subject: entry.id,
        detail:
          suites.length > 0
            ? `Aucune passe de test:all ne lève ce décor : ${suites.map((s) => s.label).join(", ")} ne tourne qu'à la main.`
            : "Aucune passe de test:all ne lève ce décor.",
      });
    }
    if (suites.length === 0 && !entry.phase) {
      blindSpots.push({
        kind: "testbed-without-suite",
        subject: entry.id,
        detail:
          "Aucune suite ne l'exige : monté ou non, aucun vert n'en dépend.",
      });
    }

    return {
      id: entry.id,
      label: gate.label,
      family: entry.family,
      purpose: entry.purpose,
      state,
      services,
      vars: names.map((name) => ({
        name,
        value: redactValue(name, values[name] ?? ""),
      })),
      sharedWith,
      server: gate.serverEnv
        ? {
            required: [...gate.serverEnv],
            missing: gate.serverEnv.filter((n) => isBlank(env, n)),
          }
        : null,
      suites,
      playedBy,
      phase: entry.phase ?? null,
      upCommand: gateUpCommand(gate),
      note: gate.note ?? null,
    };
  });

  for (const suite of input.suites) {
    if (suite.expectations === null) {
      blindSpots.push({
        kind: "suite-unreadable",
        subject: suite.label,
        detail: `${suite.config} appelle le rapporteur sans exporter ses attentes : l'onglet ne peut pas dire ce qu'elle exige.`,
      });
    } else if (suite.expectations.length === 0) {
      blindSpots.push({
        kind: "suite-without-expectation",
        subject: suite.label,
        detail: `${suite.config} appelle le rapporteur sans rien exiger : son vert ne dit rien d'un décor.`,
      });
    }
  }

  const known = new Set<string>(input.tools.map((t) => t.service));
  for (const entry of catalog) {
    if (!entry.gate.service) continue;
    known.add(entry.gate.service.name);
    for (const c of entry.gate.service.companions ?? []) known.add(c);
  }
  for (const service of input.composeServices) {
    if (!known.has(service)) {
      blindSpots.push({
        kind: "orphan-service",
        subject: service,
        detail:
          "Service du compose qui n'appartient à aucun décor ni à aucun outil : aucune commande affichée ne le démarre.",
      });
    }
  }

  const switches = input.switches.map((s) => {
    const declared = input.suites
      .filter((suite) =>
        (suite.expectations ?? []).some((e) => e.switch === s.env),
      )
      .map((suite) => suite.label);
    const readers = input.switchReaders[s.env] ?? [];
    return {
      env: s.env,
      what: s.what,
      open: (env[s.env] ?? "") === "1",
      suites: [...new Set([...declared, ...readers])].sort(),
    };
  });

  const tools = input.tools.map((t) => ({
    service: t.service,
    label: t.label,
    what: t.what,
    oneShot: t.oneShot === true,
    state: stateOf(t.service),
  }));

  return { docker: containers !== null, testbeds, switches, tools, blindSpots };
}
