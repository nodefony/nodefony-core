/**
 * `npm run test:all` — lance **toute** la batterie de tests du monorepo, et rend
 * une image de ce qui a réellement été exercé.
 *
 * ## Pourquoi ce script existe
 *
 * Tester Nodefony demandait de connaître, de tête : quels conteneurs démarrer,
 * quelles variables poser (et sous quelle forme exacte — un mot de passe oublié
 * et Redis répond `NOAUTH`, une variable mal nommée et 14 tests se taisent), dans
 * quel ordre lancer les trois suites, et laquelle exige un serveur en marche.
 * Personne ne retient ça — alors on lance `npm test`, on lit « vert », et on croit
 * avoir testé. C'est ainsi qu'un bug d'authentification a dormi un mois derrière
 * une suite verte, et que 1 200 tests ne s'exécutaient jamais.
 *
 * Ce script rend la chose faisable d'une commande, et surtout **dit ce qu'il n'a
 * pas testé**. Un banc non joué n'est pas un banc réussi.
 *
 * ## Ce qu'il fait
 *
 *  1. inspecte les cibles d'infra (`vitest.gates.ts` — la source unique), démarre
 *     les conteneurs manquants et attend qu'ils soient sains ;
 *  2. pose les variables correspondantes ;
 *  3. enchaîne les phases : build, suite unitaire, serveur de développement,
 *     suite d'intégration, et la suite de charge si on la demande ;
 *  4. clôt par un tableau : ce qui a tourné, ce qui a été sauté, pourquoi — et
 *     ce qu'il ne joue **jamais** (les bancs de mesure, hors périmètre).
 *
 * ## Usage
 *
 * ```bash
 * npm run test:all                 # infra + build + unit + intégration
 * npm run test:all -- --load       # + suite de charge et gate mémoire
 * npm run test:all -- --no-infra   # n'utilise que ce qui tourne déjà
 * npm run test:all -- --unit       # la suite unitaire seule
 * npm run test:all -- --json       # sortie machine (CI)
 * npm run test:all -- --infra      # état de l'infra seul, ne lance aucun test
 * npm run test:all -- --dialects   # + rejoue les suites ORM sur MySQL Community
 * ```
 *
 * Aucune donnée n'est détruite : les conteneurs déjà lancés sont réutilisés tels
 * quels, et le script ne les arrête jamais — c'est un banc de développement, pas
 * un pipeline jetable.
 */
import { spawn, spawnSync } from "node:child_process";
import { besoinDeShell } from "nodefony";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { containerHealthy } from "./lib/docker.ts";
import {
  PG_GATE,
  MYSQL_GATE,
  REDIS_GATE,
  MONGO_GATE,
  MYSQL_COMMUNITY_GATE,
  gateEnv,
  gateUpCommand,
  redactUrl,
  OPT_IN_SWITCHES,
  type EnvGate,
} from "../vitest.gates";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GATES: readonly EnvGate[] = [PG_GATE, MYSQL_GATE, REDIS_GATE, MONGO_GATE];

// ── Présentation ────────────────────────────────────────────────────────────
const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

interface Options {
  infra: boolean;
  /** Rejoue les suites ORM sur les dialectes qui partagent une même variable. */
  dialects: boolean;
  /** Ne prépare que l'infra et rend son état — aucune suite lancée. */
  infraOnly: boolean;
  unit: boolean;
  integration: boolean;
  load: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Options {
  const has = (flag: string) => argv.includes(flag);
  // `--unit` / `--integration` SÉLECTIONNENT (« seulement celle-ci »). `--load` et
  // `--dialects`, eux, AJOUTENT une phase optionnelle : les traiter comme une
  // sélection faisait taire les deux suites principales — `--load` rendait un
  // rapport « complet » qui n'avait lancé ni l'unitaire ni l'intégration.
  const picked = has("--unit") || has("--integration");
  return {
    infra: !has("--no-infra"),
    infraOnly: has("--infra"),
    dialects: has("--dialects"),
    unit: picked ? has("--unit") : true,
    integration: picked ? has("--integration") : true,
    load: has("--load"),
    json: has("--json"),
  };
}

// ── Infra ───────────────────────────────────────────────────────────────────

interface InfraState {
  gate: EnvGate;
  /** `true` si les variables de la cible sont posées à l'issue de la préparation. */
  ready: boolean;
  /** Ce qui empêche la cible d'être exercée, quand elle ne l'est pas. */
  reason?: string;
  /**
   * Les valeurs RÉELLEMENT utilisées pour cette cible, figées à la préparation.
   *
   * Nécessaire parce que deux cibles peuvent se partager une variable (MariaDB et
   * MySQL Community sur `NF_MYSQL_URL`) : relire `process.env` au moment du
   * rapport afficherait la dernière posée pour les deux, et le rapport mentirait
   * sur ce qui a été exercé.
   */
  used?: Record<string, string>;
}

/** Le conteneur `name` est-il en marche ET sain (ou sans sonde de santé) ? */

function dockerAvailable(): boolean {
  return spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
}

/**
 * Prépare une cible : démarre son conteneur au besoin, attend qu'il soit sain,
 * puis pose ses variables dans `process.env`.
 *
 * Une variable déjà posée par l'utilisateur est **respectée** : il peut viser une
 * base distante, un port inhabituel, un serveur managé. Le script ne l'écrase
 * jamais.
 */
async function prepare(
  gate: EnvGate,
  useDocker: boolean,
  force = false,
): Promise<InfraState> {
  const vars = gate.values();
  // `force` : la cible PARTAGE sa variable avec une autre (MariaDB ↔ MySQL
  // Community). La trouver « déjà posée » signifierait alors qu'on exerce la
  // voisine en croyant l'exercer elle — et le rapport afficherait l'URL de
  // l'autre serveur. Dans ce cas, ses propres valeurs font foi.
  const already =
    !force && gateEnv(gate).every((k) => (process.env[k] ?? "").trim());
  if (already) {
    const used: Record<string, string> = {};
    for (const k of gateEnv(gate)) used[k] = process.env[k] ?? "";
    return { gate, ready: true, used };
  }

  if (!useDocker) {
    return { gate, ready: false, reason: "infra désactivée (--no-infra)" };
  }
  if (!gate.service) {
    return { gate, ready: false, reason: "aucun service docker déclaré" };
  }
  if (!dockerAvailable()) {
    return { gate, ready: false, reason: "docker indisponible" };
  }

  if (!containerHealthy(gate.service.name)) {
    const up = gateUpCommand(gate)!;
    process.stdout.write(`  ${C.dim("→")} démarrage ${gate.label}… `);
    const res = spawnSync(up, { shell: true, cwd: ROOT, stdio: "ignore" });
    if (res.status !== 0) {
      process.stdout.write(`${C.red("échec")}\n`);
      return { gate, ready: false, reason: "le conteneur n'a pas démarré" };
    }
    // Un conteneur « started » n'est pas un serveur prêt : Postgres rejoue son
    // WAL, Mongo initie son replica set. On attend la sonde de santé, pas le
    // démarrage — sinon les premiers tests échouent sur une connexion refusée.
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (containerHealthy(gate.service.name)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!containerHealthy(gate.service.name)) {
      process.stdout.write(`${C.red("pas sain")}\n`);
      return { gate, ready: false, reason: "conteneur jamais devenu sain" };
    }
    process.stdout.write(`${C.green("prêt")}\n`);
  }

  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
  return { gate, ready: true, used: vars };
}

// ── Phases ──────────────────────────────────────────────────────────────────

interface PhaseResult {
  name: string;
  ok: boolean;
  skipped?: string;
  durationMs: number;
  /** Totaux agrégés depuis la sortie vitest, quand ils sont lisibles. */
  tests?: { passed: number; failed: number; skipped: number };
}

/** Lance une commande en héritant du terminal, et rend son code de sortie. */
function run(cmd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { shell: true, cwd: ROOT, env: process.env });
    let output = "";
    const capture = (chunk: Buffer): void => {
      const text = String(chunk);
      output += text;
      process.stdout.write(text);
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

/**
 * Agrège les lignes `Tests N passed | M failed | K skipped` de toutes les suites.
 * Chaque workspace imprime la sienne ; le total du monorepo n'existe nulle part
 * ailleurs.
 */
function tally(output: string): {
  passed: number;
  failed: number;
  skipped: number;
} {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
  const total = { passed: 0, failed: 0, skipped: 0 };
  for (const line of clean.split("\n")) {
    const m = /^\s*(?:\S+\s+)?Tests\s+(.+)$/.exec(line);
    if (!m) continue;
    for (const part of m[1]!.split("|")) {
      const p = /(\d+)\s+(passed|failed|skipped)/.exec(part);
      if (p) total[p[2] as keyof typeof total] += Number(p[1]);
    }
  }
  return total;
}

async function phase(
  name: string,
  cmd: string,
  results: PhaseResult[],
): Promise<boolean> {
  console.log(`\n${C.cyan("▸")} ${C.bold(name)}  ${C.dim(cmd)}`);
  const started = Date.now();
  const { code, output } = await run(cmd);
  const result: PhaseResult = {
    name,
    ok: code === 0,
    durationMs: Date.now() - started,
    tests: tally(output),
  };
  results.push(result);
  return result.ok;
}

// ── Serveur de développement (requis par la suite d'intégration) ────────────

function serverRunning(): boolean {
  const pidfile = join(ROOT, "node_modules/.cache/nodefony/dev-supervisor.pid");
  if (!existsSync(pidfile)) return false;
  return (
    spawnSync("npx", ["nodefony", "status"], {
      cwd: ROOT,
      stdio: "ignore",
      // `npx` est un `.cmd` sous Windows — sans shell, Node rend `ENOENT` et cette
      // sonde conclurait « aucun serveur » quel que soit l'état réel.
      shell: besoinDeShell("npx"),
    }).status === 0
  );
}

// ── Rapport ─────────────────────────────────────────────────────────────────

/**
 * Les bancs autonomes que cette commande ne joue **jamais**, pas même sous
 * `--load` : ce sont des instruments de MESURE (débit, latence, plafond de
 * connexions, fan-out entre pods), qui exigent un décor et un protocole propres.
 * Les taire ferait mentir le rapport par omission — un « tout est vert » qui
 * couvre la non-régression et laisse croire que la charge l'est aussi.
 *
 * Le compte est LU SUR DISQUE : une liste écrite ici se périmerait au premier
 * banc ajouté, et l'omission reviendrait par la porte de derrière.
 *
 * @returns Les lots présents (dossier, nombre de bancs, ce qu'ils mesurent).
 */
function standaloneBenches(): {
  dir: string;
  count: number;
  what: string;
}[] {
  const lots = [
    {
      dir: ".claude/skills/nodefony-load-test/scripts",
      what: "charge, RPS et percentiles, plafond de connexions WS, capacité d'un pod",
    },
    {
      dir: ".claude/skills/nodefony-multipod-bench/scripts",
      what: "fan-out cross-pod, cloisonnement des apps, bus Redis partagé",
    },
  ];
  const out: { dir: string; count: number; what: string }[] = [];
  for (const lot of lots) {
    const abs = join(ROOT, lot.dir);
    if (!existsSync(abs)) continue; // dépôt réduit (paquet publié) : rien à annoncer
    const count = readdirSync(abs).filter((f) => f.endsWith(".mjs")).length;
    if (count > 0) out.push({ ...lot, count });
  }
  return out;
}

function report(
  infra: InfraState[],
  phases: PhaseResult[],
  options: Options,
): void {
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          infra: infra.map((i) => ({
            target: i.gate.label,
            exercised: i.ready,
            reason: i.reason ?? null,
          })),
          phases: phases.map((p) => ({
            name: p.name,
            ok: p.ok,
            skipped: p.skipped ?? null,
            durationMs: p.durationMs,
            tests: p.tests ?? null,
          })),
          outOfScope: standaloneBenches(),
        },
        null,
        2,
      ),
    );
    return;
  }

  const bar = "─".repeat(72);
  console.log(`\n${bar}\n${C.bold("CE QUI A ÉTÉ TESTÉ")}\n${bar}`);

  console.log(`\n${C.bold("Cibles d'infrastructure")}`);
  for (const state of infra) {
    const mark = state.ready ? C.green("✔") : C.yellow("○");
    if (!state.ready) {
      console.log(
        `  ${mark} ${state.gate.label.padEnd(26)} ${C.yellow(`non exercée — ${state.reason}`)}`,
      );
      continue;
    }
    // La valeur RÉELLEMENT utilisée, secret masqué : savoir quelle cible a
    // répondu vaut mieux que savoir quelle variable existe — c'est l'URL qui
    // distingue MariaDB de MySQL Community, ou une base locale d'une distante.
    console.log(`  ${mark} ${state.gate.label}`);
    for (const [key, value] of Object.entries(state.used ?? {})) {
      console.log(`      ${C.dim(`${key} = ${redactUrl(value)}`)}`);
    }
  }

  console.log(`\n${C.bold("Phases")}`);
  const totals = { passed: 0, failed: 0, skipped: 0 };
  for (const p of phases) {
    if (p.skipped) {
      console.log(
        `  ${C.yellow("○")} ${p.name.padEnd(26)} ${C.yellow(p.skipped)}`,
      );
      continue;
    }
    const mark = p.ok ? C.green("✔") : C.red("✖");
    const secs = `${(p.durationMs / 1000).toFixed(0)}s`;
    const t = p.tests;
    const detail = t
      ? `${t.passed} passés` +
        (t.failed ? `, ${C.red(`${t.failed} échoués`)}` : "") +
        (t.skipped ? `, ${t.skipped} sautés` : "")
      : "";
    console.log(
      `  ${mark} ${p.name.padEnd(26)} ${detail.padEnd(40)} ${C.dim(secs)}`,
    );
    if (t) {
      totals.passed += t.passed;
      totals.failed += t.failed;
      totals.skipped += t.skipped;
    }
  }

  console.log(
    `\n  ${C.bold("Total")} : ${totals.passed} passés` +
      (totals.failed ? `, ${C.red(`${totals.failed} échoués`)}` : "") +
      (totals.skipped ? `, ${totals.skipped} sautés` : ""),
  );

  const closed = OPT_IN_SWITCHES.filter(
    (sw) => !(process.env[sw.env] ?? "").trim(),
  );
  if (closed.length > 0) {
    console.log(
      `\n${C.bold("Interrupteurs fermés")} ${C.dim("(l'essentiel des tests « sautés »)")}`,
    );
    for (const sw of closed) {
      console.log(`  ${C.yellow("○")} ${sw.env.padEnd(16)} ${C.dim(sw.what)}`);
    }
    console.log(
      `  ${C.dim(`→ pour les ouvrir : ${closed.map((c) => `${c.env}=1`).join(" ")} npm run test:all`)}`,
    );
  }

  const benches = standaloneBenches();
  if (benches.length > 0) {
    console.log(
      `\n${C.bold("Hors périmètre")} ${C.dim("(bancs de MESURE — jamais joués ici, même avec --load)")}`,
    );
    for (const b of benches) {
      console.log(
        `  ${C.yellow("○")} ${`${b.count} bancs`.padEnd(16)} ${C.dim(`${b.dir}`)}`,
      );
      console.log(`    ${C.dim(b.what)}`);
    }
    console.log(
      `  ${C.dim("→ un banc ne se lance pas seul : son protocole (décor, médiane de N runs) vit dans les skills nodefony-load-test / nodefony-multipod-bench")}`,
    );
  }

  const unmet = infra.filter((i) => !i.ready);
  if (unmet.length > 0) {
    console.log(
      `\n${C.yellow(`  ⚠ ${unmet.length} cible(s) non exercée(s) — ce résultat ne dit rien d'elles.`)}`,
    );
  }
  console.log(bar);
}

// ── Programme ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const phases: PhaseResult[] = [];

  console.log(C.bold("\n⬢ Nodefony — batterie de tests complète\n"));

  console.log(C.bold("Infrastructure"));
  const infra: InfraState[] = [];
  for (const gate of GATES) infra.push(await prepare(gate, options.infra));
  for (const state of infra) {
    if (state.ready) console.log(`  ${C.green("✔")} ${state.gate.label}`);
    else
      console.log(`  ${C.yellow("○")} ${state.gate.label} — ${state.reason}`);
  }

  if (options.infraOnly) {
    // Ce qu'on n'a pas lancé se dit aussi : une batterie « complète » qui tait ses
    // absences est exactement le genre de demi-vérité que ce script combat.
    if (!options.load) {
      phases.push({
        name: "Suite de charge + mémoire",
        ok: true,
        skipped: "non lancée — `npm run test:all -- --load`",
        durationMs: 0,
      });
    }
    if (!options.dialects) {
      phases.push({
        name: "Suites ORM — MySQL Community",
        ok: true,
        skipped: "non lancée — `npm run test:all -- --dialects`",
        durationMs: 0,
      });
    }

    report(infra, phases, options);
    process.exit(infra.every((i) => i.ready) ? 0 : 1);
  }

  // `--continue`, jamais `--force`. Deux pièges appris à la dure :
  //
  //  - `--force` invalide TOUT le graphe, y compris les builds dont `test`
  //    dépend : un `rimraf dist` repartait alors PENDANT qu'un test bootait
  //    l'application, qui échouait sur un module introuvable. On rebâtit une fois,
  //    proprement, puis on laisse le cache faire son travail.
  //  - sans `--continue`, la première suite en échec emporte les suivantes : 8
  //    suites n'étaient pas jouées, et le rapport comptait 4 000 tests au lieu de
  //    6 000. Un échec doit coûter un échec, pas l'aveuglement sur le reste.
  //
  // Le build précède TOUT : un test qui boote l'application tombe sinon sur le
  // `rimraf dist` d'un autre paquet, et l'échec pointe un sujet sans rapport.
  //
  // `npm run build`, PAS `turbo run build` : le premier enchaîne les workspaces
  // ET l'application racine (`dist/index.js`). Sans elle, le kernel ne trouve pas
  // le point d'entrée, aucun module ne se charge, et un banc CLI se plaint qu'une
  // commande manque — un symptôme qui ne parle jamais de la vraie cause.
  let ok = await phase("Build", "npm run build", phases);

  if (ok && options.unit) {
    ok = await phase("Suite unitaire", "npx turbo run test --continue", phases);
  } else if (options.unit) {
    phases.push({
      name: "Suite unitaire",
      ok: false,
      skipped: "build en échec",
      durationMs: 0,
    });
  }

  // MariaDB et MySQL Community partagent `NF_MYSQL_URL` : ils ne peuvent pas être
  // couverts dans la même passe. « Même dialecte » n'est pas « même serveur » —
  // collation, bornes numériques et arbitrage des upserts ont déjà divergé entre
  // les deux. Sans cette passe, la moitié de la cible reste non exercée.
  if (options.dialects) {
    const community = await prepare(MYSQL_COMMUNITY_GATE, options.infra, true);
    infra.push(community);
    if (community.ready) {
      const saved = process.env.NF_MYSQL_URL;
      Object.assign(process.env, MYSQL_COMMUNITY_GATE.values());
      await phase(
        "Suites ORM — MySQL Community",
        "npx turbo run test --filter=@nodefony/drizzle --filter=@nodefony/orm-core --continue",
        phases,
      );
      if (saved !== undefined) process.env.NF_MYSQL_URL = saved;
    } else {
      phases.push({
        name: "Suites ORM — MySQL Community",
        ok: false,
        skipped: community.reason ?? "cible indisponible",
        durationMs: 0,
      });
    }
  }

  if (options.integration) {
    if (!serverRunning()) {
      console.log(`\n${C.cyan("▸")} ${C.bold("Serveur de développement")}`);
      const started = await run(
        "bash .claude/skills/nodefony-start-server/start.sh",
      );
      if (started.code !== 0) {
        phases.push({
          name: "Suite d'intégration",
          ok: false,
          skipped: "le serveur n'a pas démarré",
          durationMs: 0,
        });
      }
    }
    if (serverRunning()) {
      await phase(
        "Suite d'intégration",
        "npx turbo run test:integration --continue",
        phases,
      );
    }
  }

  if (options.load) {
    if (serverRunning()) {
      await phase(
        "Suite de charge",
        "npx turbo run test:load --continue",
        phases,
      );
    } else {
      phases.push({
        name: "Suite de charge",
        ok: false,
        skipped: "exige un serveur en marche",
        durationMs: 0,
      });
    }
  }

  // Ce qu'on n'a pas lancé se dit aussi : une batterie « complète » qui tait ses
  // absences est exactement le genre de demi-vérité que ce script combat.
  if (!options.load) {
    phases.push({
      name: "Suite de charge + mémoire",
      ok: true,
      skipped: "non lancée — `npm run test:all -- --load`",
      durationMs: 0,
    });
  }
  if (!options.dialects) {
    phases.push({
      name: "Suites ORM — MySQL Community",
      ok: true,
      skipped: "non lancée — `npm run test:all -- --dialects`",
      durationMs: 0,
    });
  }

  report(infra, phases, options);

  const failed = phases.some((p) => !p.ok && !p.skipped);
  process.exit(failed ? 1 : 0);
}

void main();
