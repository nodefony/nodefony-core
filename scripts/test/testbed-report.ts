/**
 * Constat des décors de développement du cœur, en JSON sur la sortie standard.
 *
 * Lancé par le module `test` (data plane `GET /nodefony/test/api/testbed`) dans
 * un process séparé : le serveur n'embarque ainsi ni les configs vitest ni
 * l'outillage du dépôt, et ce script n'existe que dans le dépôt du framework —
 * son absence EST le constat « hors dépôt ».
 *
 * Il collecte (configs vitest, sources de test, compose, `docker inspect`,
 * environnement hérité du serveur) ; la décision vit dans `lib/testbed.ts`.
 *
 * Usage : `tsx scripts/test/testbed-report.ts` → `{ supported: true, … }`.
 */
import { spawnSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "../lib/repo-root.mjs";
import {
  composeServices,
  TESTBED_CATALOG,
  DEV_TOOLS,
  OPT_IN_SWITCHES,
  TEST_ALL_GATES,
} from "./vitest/gates.ts";
import {
  buildTestbedReport,
  normalizeExpectations,
  suiteLabel,
  type ContainerState,
  type ITestbedSuite,
} from "./lib/testbed.ts";

const skipBuildDirs = (path: string): boolean =>
  /(^|[\\/])(node_modules|dist)([\\/]|$)/.test(path);

/** Chemin relatif en `/` — il voyage jusqu'à l'écran. */
const toPosix = (path: string): string => path.split("\\").join("/");

async function readSuites(): Promise<ITestbedSuite[]> {
  const configs = globSync("src/**/vitest*.config.ts", {
    cwd: REPO_ROOT,
    exclude: skipBuildDirs,
  })
    .map(toPosix)
    .sort();
  const suites: ITestbedSuite[] = [];
  for (const config of configs) {
    const abs = join(REPO_ROOT, config);
    if (!readFileSync(abs, "utf8").includes("gateReporter(")) continue;
    const mod: Record<string, unknown> = await import(pathToFileURL(abs).href);
    suites.push({
      label: suiteLabel(config),
      config,
      expectations:
        "expectations" in mod ? normalizeExpectations(mod.expectations) : null,
    });
  }
  return suites;
}

/** Paquets dont un test lit chaque interrupteur — constaté, pas déclaré. */
function readSwitchReaders(): Record<string, string[]> {
  const readers: Record<string, Set<string>> = Object.create(null);
  const files = globSync("src/**/*.test.ts", {
    cwd: REPO_ROOT,
    exclude: skipBuildDirs,
  }).map(toPosix);
  for (const file of files) {
    const text = readFileSync(join(REPO_ROOT, file), "utf8");
    for (const { env } of OPT_IN_SWITCHES) {
      if (!text.includes(env)) continue;
      const pkg = file.startsWith("src/nodefony/")
        ? "core"
        : (/^src\/(?:packages\/@nodefony|modules)\/([^/]+)\//.exec(file)?.[1] ??
          "?");
      (readers[env] ??= new Set()).add(pkg);
    }
  }
  const out: Record<string, string[]> = Object.create(null);
  for (const [env, set] of Object.entries(readers)) out[env] = [...set].sort();
  return out;
}

/**
 * État des conteneurs `nodefony-<service>`, en UN appel `docker inspect`.
 *
 * @returns `null` quand docker ne répond pas (absent, démon arrêté)
 */
function readContainers(
  services: readonly string[],
): Record<string, ContainerState> | null {
  if (services.length === 0) return {};
  const res = spawnSync(
    "docker",
    [
      "inspect",
      "-f",
      "{{.Name}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
      ...services.map((s) => `nodefony-${s}`),
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  // Un service inconnu fait sortir `docker inspect` en 1 SANS rien dire de faux :
  // seuls l'absence du binaire et le démon injoignable rendent le constat nul.
  if (res.error || /Cannot connect|daemon/i.test(res.stderr ?? "")) return null;
  const states: Record<string, ContainerState> = Object.create(null);
  for (const service of services) states[service] = "absent";
  for (const line of (res.stdout ?? "").split("\n")) {
    const [name = "", status = "", health = ""] = line.trim().split("|");
    const service = name.replace(/^\/?nodefony-/, "");
    if (!service || !(service in states)) continue;
    states[service] =
      status !== "running"
        ? "stopped"
        : health === "healthy"
          ? "healthy"
          : health === "starting"
            ? "starting"
            : health === "unhealthy"
              ? "unhealthy"
              : "running";
  }
  return states;
}

const services = composeServices();
const report = buildTestbedReport({
  catalog: TESTBED_CATALOG,
  testAllGates: TEST_ALL_GATES,
  switches: OPT_IN_SWITCHES,
  tools: DEV_TOOLS,
  suites: await readSuites(),
  switchReaders: readSwitchReaders(),
  composeServices: services,
  containers: readContainers(services),
  env: process.env,
});
process.stdout.write(
  JSON.stringify({
    supported: true,
    generatedAt: new Date().toISOString(),
    ...report,
  }),
);
