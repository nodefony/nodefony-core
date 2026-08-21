/*
 *   Tests UNITAIRES du helper d'introspection des process dev (devProcess.ts) —
 *   parsing `ps`, formatage, valeurs partagées. Fonctions PURES → déterministes,
 *   sans spawn `ps` ni dépendance machine. Couvre en particulier le parsing `%CPU`
 *   avec virgule décimale (bug locale FR qui avait fait passer la détection à zéro).
 */

import assert from "node:assert";
import path from "node:path";
import os from "node:os";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  clearRuntimeState,
  defaultDevPorts,
  formatForeignRuntimes,
  discoverDevProcessesDetailed,
  discoverFromRuntimeState,
  detectRuntimeMode,
  devSupervisorPidFile,
  findRuntimeConflict,
  formatUptime,
  killTreeCommand,
  missingWorkspaceDists,
  parsePsRow,
  parseTasklistImage,
  signalProcessGroup,
  processCwd,
  readRuntimeState,
  runtimeModes,
  runtimeStateFile,
  splitByProject,
  writeRuntimeState,
  type DevProcessInfo,
} from "../service/dev/devProcess";
import { scopeAllToNodefonyProjects } from "../service/dev/devStop";
import { buildDevStatus } from "../service/dev/devStatusReport";

describe("devProcess — parsePsRow (parsing ps)", () => {
  it("superviseur, %CPU à VIRGULE décimale (locale FR) → cpu numérique correct", () => {
    const r = parsePsRow(
      "15326 15293 108564   0,0   47:27 nodefony-dev-supervisor",
    );
    assert.ok(r);
    assert.strictEqual(r.role, "supervisor");
    assert.strictEqual(r.label, "supervisor");
    assert.strictEqual(r.pid, 15326);
    assert.strictEqual(r.ppid, 15293);
    assert.strictEqual(r.rssKb, 108564);
    assert.strictEqual(r.cpu, 0); // "0,0" ne doit PAS casser le parse
    assert.strictEqual(r.uptimeSec, 47 * 60 + 27); // 47:27 = MM:SS
  });

  it("serveur, %CPU à POINT décimal → cpu numérique correct", () => {
    const r = parsePsRow(
      "40482 15326 305444   12.7   01:08 nodefony-dev-server",
    );
    assert.ok(r);
    assert.strictEqual(r.role, "server");
    assert.strictEqual(r.cpu, 12.7);
    assert.strictEqual(r.uptimeSec, 68); // 01:08 = MM:SS
  });

  it("Vite mono-entry → label court `vite` + detail = bundle", () => {
    const r = parsePsRow(
      "40514 40482 436508 0,0 01:03 nodefony-vite[studio] /path/vite.js --port 5173",
    );
    assert.ok(r);
    assert.strictEqual(r.role, "vite");
    assert.strictEqual(r.label, "vite"); // colonne courte → alignement stable
    assert.strictEqual(r.detail, "studio");
  });

  it("Vite multi-entry → detail = bundles joints", () => {
    const r = parsePsRow(
      "40515 40482 132076 0,0 01:03 nodefony-vite[react+vue+studio] /path/vite.js",
    );
    assert.ok(r);
    assert.strictEqual(r.label, "vite");
    assert.strictEqual(r.detail, "react+vue+studio");
  });

  it("uptime HH:MM:SS et DD-HH:MM:SS → secondes", () => {
    const h = parsePsRow("100 1 1000 0,0 01:02:03 nodefony-dev-server");
    assert.strictEqual(h?.uptimeSec, 1 * 3600 + 2 * 60 + 3);
    const d = parsePsRow("100 1 1000 0,0 2-03:04:05 nodefony-dev-server");
    assert.strictEqual(d?.uptimeSec, 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  });

  it("process INNOCENT qui MENTIONNE un titre → null (jamais une cible de kill)", () => {
    // Le titre d'un runtime Nodefony REMPLACE l'argv : `ps` rend le titre SEUL.
    // Un process qui porte le motif ailleurs dans sa ligne (fichier ouvert,
    // argument, grep) n'est PAS un runtime — et `nodefony stop --all`, qui ne
    // filtre pas par projet, le tuerait sur la seule foi d'une sous-chaîne.
    for (const cmd of [
      "tail -f /dev/null nodefony server",
      "vim src/nodefony master.ts",
      "node -e setInterval(()=>{}) nodefony worker 3 [cluster]",
      "grep -r nodefony-dev-server src/",
      "less /var/log/nodefony-vite.log",
      "npm exec nodefony development", // fenêtre PRÉ-titre : pas encore un runtime
    ]) {
      assert.strictEqual(
        parsePsRow(`700 1 20000 0.0 10:00 ${cmd}`),
        null,
        `doit rester hors périmètre : ${cmd}`,
      );
    }
  });

  it("titres RÉELS (argv remplacé par process.title) → toujours reconnus", () => {
    // Contre-épreuve du test ci-dessus : le durcissement ne doit tuer aucune
    // détection légitime, padding d'espaces de `ps` compris.
    const cases: [string, string][] = [
      ["nodefony-dev-supervisor  ", "supervisor"],
      ["nodefony-dev-server", "server"],
      ["nodefony-vite[studio] /path/vite.js", "vite"],
      ["nodefony master [cluster 6w]", "master"],
      ["nodefony worker 3 [cluster]", "worker"],
      ["nodefony server", "server"],
    ];
    for (const [cmd, role] of cases) {
      const r = parsePsRow(`700 1 20000 0.0 10:00 ${cmd}`);
      assert.strictEqual(r?.role, role, `doit rester détecté : ${cmd}`);
    }
  });

  it("process NON-dev → null (hors périmètre)", () => {
    assert.strictEqual(
      parsePsRow("500 1 20000 0.0 10:00 /usr/libexec/some-daemon"),
      null,
    );
  });

  it("serveur PROD mono (`nodefony server`) → mode prod, role server", () => {
    const r = parsePsRow("200 1 30000 0.0 05:00 nodefony server");
    assert.ok(r);
    assert.strictEqual(r.mode, "prod");
    assert.strictEqual(r.role, "server");
  });

  it("master cluster → mode cluster, role master, detail = nb workers", () => {
    const r = parsePsRow("300 1 18000 0.0 05:00 nodefony master [cluster 6w]");
    assert.ok(r);
    assert.strictEqual(r.mode, "cluster");
    assert.strictEqual(r.role, "master");
    assert.strictEqual(r.detail, "6 workers");
  });

  it("worker cluster → mode cluster, role worker, detail = #id", () => {
    const r = parsePsRow("301 300 32000 0.0 05:00 nodefony worker 3 [cluster]");
    assert.ok(r);
    assert.strictEqual(r.mode, "cluster");
    assert.strictEqual(r.role, "worker");
    assert.strictEqual(r.detail, "#3");
  });

  it("dev-server (tiret) ≠ prod-server (espace) → mode dev, pas prod", () => {
    const r = parsePsRow("100 1 30000 0.0 05:00 nodefony-dev-server");
    assert.ok(r);
    assert.strictEqual(r.mode, "dev");
    assert.strictEqual(r.role, "server");
  });
});

describe("devProcess — détection de mode & conflit (gardes anti-collision)", () => {
  const mk = (
    pid: number,
    mode: DevProcessInfo["mode"],
    role: DevProcessInfo["role"],
    ppid = 1,
  ): DevProcessInfo => ({
    pid,
    ppid,
    mode,
    role,
    label: role,
    rssKb: 1000,
    cpu: 0,
    uptimeSec: 1,
  });

  it("detectRuntimeMode : priorité dev > cluster > prod ; null si vide", () => {
    assert.strictEqual(detectRuntimeMode([]), null);
    assert.strictEqual(detectRuntimeMode([mk(1, "prod", "server")]), "prod");
    assert.strictEqual(
      detectRuntimeMode([
        mk(1, "cluster", "master"),
        mk(2, "cluster", "worker"),
      ]),
      "cluster",
    );
    // Cohabitation anormale dev+prod → dev domine (le superviseur a la priorité).
    assert.strictEqual(
      detectRuntimeMode([mk(1, "prod", "server"), mk(2, "dev", "supervisor")]),
      "dev",
    );
  });

  it("runtimeModes ignore Vite (enfant, ne tient pas les ports)", () => {
    const modes = runtimeModes([
      mk(1, "dev", "supervisor"),
      mk(2, "dev", "server"),
      mk(3, "dev", "vite"),
    ]);
    assert.deepStrictEqual([...modes], ["dev"]);
  });

  it("findRuntimeConflict(dev) : un prod/cluster est un conflit, un résiduel dev non", () => {
    const procs = [
      mk(1, "dev", "supervisor"),
      mk(2, "dev", "server"),
      mk(3, "prod", "server"),
    ];
    const conflict = findRuntimeConflict(procs, "dev");
    assert.strictEqual(conflict.length, 1);
    assert.strictEqual(conflict[0].pid, 3);
    assert.strictEqual(conflict[0].mode, "prod");
  });

  it("findRuntimeConflict(prod) : un dev qui tourne bloque le démarrage prod", () => {
    const conflict = findRuntimeConflict(
      [mk(1, "dev", "supervisor"), mk(2, "dev", "vite")],
      "prod",
    );
    // Le superviseur dev est un conflit ; le Vite (enfant) est exclu.
    assert.strictEqual(conflict.length, 1);
    assert.strictEqual(conflict[0].role, "supervisor");
  });

  it("ligne vide / header → null", () => {
    assert.strictEqual(parsePsRow(""), null);
    assert.strictEqual(parsePsRow("  PID PPID RSS %CPU ELAPSED COMMAND"), null);
  });
});

describe("devProcess — formatUptime", () => {
  it("formate par paliers lisibles", () => {
    assert.strictEqual(formatUptime(0), "0s");
    assert.strictEqual(formatUptime(45), "45s");
    assert.strictEqual(formatUptime(134), "2m14s");
    assert.strictEqual(formatUptime(3600), "1h00m");
    assert.strictEqual(formatUptime(90061), "1d 01h");
  });
});

describe("devProcess — valeurs partagées (anti-divergence)", () => {
  it("devSupervisorPidFile pointe node_modules/.cache/nodefony", () => {
    const f = devSupervisorPidFile("/app");
    assert.strictEqual(
      f,
      path.join(
        "/app",
        "node_modules",
        ".cache",
        "nodefony",
        "dev-supervisor.pid",
      ),
    );
  });

  it("defaultDevPorts : défaut, override CSV, valeur invalide", () => {
    const save = process.env.NODEFONY_DEV_PORTS;
    // cwd ISOLÉ : sans lui, le test lirait le state file du serveur de dev
    // éventuellement lancé dans le repo (il en écrit un) → verdict machine-dépendant.
    const cwd = mkdtempSync(path.join(os.tmpdir(), "nf-ports-"));
    try {
      delete process.env.NODEFONY_DEV_PORTS;
      assert.deepStrictEqual(defaultDevPorts(cwd), [5151, 5152]);
      process.env.NODEFONY_DEV_PORTS = "3000, 3001 ";
      assert.deepStrictEqual(defaultDevPorts(cwd), [3000, 3001]);
      process.env.NODEFONY_DEV_PORTS = "nope";
      assert.deepStrictEqual(defaultDevPorts(cwd), [5151, 5152]); // fallback
    } finally {
      if (save === undefined) delete process.env.NODEFONY_DEV_PORTS;
      else process.env.NODEFONY_DEV_PORTS = save;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("formatForeignRuntimes : la voie CIBLÉE est proposée avant la voie qui tue tout", () => {
    // 🔴 Vécu au banc devkit : un agent bloqué par un port tenu a lu ce bloc,
    // n'a pas pu `cd` (son répertoire courant est celui de SON application), et
    // a donc pris la seule autre voie affichée — `nodefony stop --all`. Il a
    // arrêté le serveur du développeur pour faire passer son contrôle. La
    // commande ciblée `nodefony stop <projet>` existait, elle n'était nulle
    // part : ce message est le SEUL endroit où l'on apprend qu'un voisin
    // tourne, donc c'est là que la voie sûre doit se lire — AVANT la voie
    // trans-projets. Un geste destructeur ne se propose jamais en premier.
    const proc = (pid: number, cwd: string, label: string) =>
      ({
        pid,
        ppid: 1,
        mode: "dev",
        role: "supervisor",
        label,
        rssKb: 1000,
        cpu: 0,
        uptimeSec: 10,
        cwd,
      }) as const;
    const lignes = formatForeignRuntimes([
      proc(101, path.join(path.sep, "tmp", "boutique"), "supervisor"),
      proc(102, path.join(path.sep, "tmp", "boutique"), "server"),
    ] as unknown as Parameters<typeof formatForeignRuntimes>[0]);
    const texte = lignes.join("\n");

    const cible = lignes.findIndex((l) => l.includes("nodefony stop boutique"));
    const tout = lignes.findIndex((l) => l.includes("nodefony stop --all"));
    assert.notStrictEqual(cible, -1, "la voie ciblée doit être proposée");
    assert.notStrictEqual(tout, -1, "la voie trans-projets reste proposée");
    assert.ok(cible < tout, "la voie ciblée passe AVANT `--all`");
    // La portée de `--all` reste dite : on ne masque pas ce qu'il fait.
    assert.match(texte, /--all.*tous projets/u);
  });

  it("defaultDevPorts : l'application qui DÉCLARE ses ports n'est plus jugée sur ceux d'une autre", () => {
    // 🔴 Vécu, et coûteux : une application témoin lancée avec `NF_PORT=5371`
    // faisait sonder 5151/5152 à `nodefony check` — les ports du dépôt voisin.
    // Le vérificateur rendait donc « port déjà tenu » sur du code parfait, dès
    // qu'un AUTRE serveur tournait sur le poste. Deux sources de vérité pour
    // « quels ports cette application utilise » : le gabarit d'app déclare
    // `NF_PORT`/`NF_PORT_HTTPS`, cette fonction ne connaissait que la forme
    // héritée `NODEFONY_DEV_PORTS`. Elles divergeaient en silence.
    const sauve = {
      dev: process.env.NODEFONY_DEV_PORTS,
      port: process.env.NF_PORT,
      https: process.env.NF_PORT_HTTPS,
      alias: process.env.PORT,
    };
    const cwd = mkdtempSync(path.join(os.tmpdir(), "nf-ports-decl-"));
    try {
      delete process.env.NODEFONY_DEV_PORTS;
      delete process.env.PORT;
      process.env.NF_PORT = "5371";
      process.env.NF_PORT_HTTPS = "5372";
      assert.deepStrictEqual(defaultDevPorts(cwd), [5371, 5372]);

      // Un seul des deux déclaré : on ne sonde que ce qui est déclaré, jamais
      // un port par défaut qui appartient peut-être à quelqu'un d'autre.
      delete process.env.NF_PORT_HTTPS;
      assert.deepStrictEqual(defaultDevPorts(cwd), [5371]);

      // L'alias plateforme `PORT` reste IGNORÉ ici : il appartient au gabarit
      // d'application, pas au cœur. Un `PORT` posé pour un autre outil ne doit
      // pas détourner la sonde — c'est la collision que `NF_` évite.
      delete process.env.NF_PORT;
      process.env.PORT = "8080";
      assert.deepStrictEqual(defaultDevPorts(cwd), [5151, 5152]);
      process.env.NF_PORT = "5371";
      assert.deepStrictEqual(defaultDevPorts(cwd), [5371]);

      // L'override explicite de l'opérateur garde la priorité.
      process.env.NODEFONY_DEV_PORTS = "3000,3001";
      assert.deepStrictEqual(defaultDevPorts(cwd), [3000, 3001]);

      // Rien de déclaré → la convention historique, inchangée.
      delete process.env.NODEFONY_DEV_PORTS;
      delete process.env.NF_PORT;
      delete process.env.PORT;
      assert.deepStrictEqual(defaultDevPorts(cwd), [5151, 5152]);
    } finally {
      for (const [cle, valeur] of [
        ["NODEFONY_DEV_PORTS", sauve.dev],
        ["NF_PORT", sauve.port],
        ["NF_PORT_HTTPS", sauve.https],
        ["PORT", sauve.alias],
      ] as const) {
        if (valeur === undefined) delete process.env[cle];
        else process.env[cle] = valeur;
      }
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

/**
 * **State file runtime** — le canal par lequel le serveur dit sur quels ports il
 * écoute VRAIMENT.
 *
 * Il n'existe que parce que le port n'est plus une certitude : `servers.portPolicy:
 * "auto"` peut faire glisser l'écoute (5151 → 5153). `status`, `stop` et la
 * readiness sondaient `[5151, 5152]` en dur — sans ce canal, ils déclareraient
 * « serveur down » sur un serveur parfaitement vivant.
 */
describe("devProcess — state file runtime (ports effectifs)", () => {
  let cwd: string;
  const savedEnv = process.env.NODEFONY_DEV_PORTS;

  beforeEach(() => {
    delete process.env.NODEFONY_DEV_PORTS;
    cwd = mkdtempSync(path.join(os.tmpdir(), "nf-runtime-"));
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.NODEFONY_DEV_PORTS;
    else process.env.NODEFONY_DEV_PORTS = savedEnv;
    rmSync(cwd, { recursive: true, force: true });
  });

  it("écrit puis relit les ports effectifs (aller-retour)", () => {
    writeRuntimeState(cwd, {
      pid: process.pid,
      ports: [5153, 5154],
      desiredPorts: [5151, 5152],
    });
    const state = readRuntimeState(cwd);
    assert.ok(state);
    assert.deepStrictEqual(state.ports, [5153, 5154]);
    // Le port DÉSIRÉ est conservé : un outil peut dire « tu voulais 5151, tu
    // écoutes sur 5153 » sans avoir à le deviner.
    assert.deepStrictEqual(state.desiredPorts, [5151, 5152]);
    assert.strictEqual(state.pid, process.pid);
  });

  it("crée l'arborescence si `node_modules/.cache` n'existe pas encore", () => {
    writeRuntimeState(cwd, { pid: process.pid, ports: [7000] });
    assert.ok(existsSync(runtimeStateFile(cwd)));
  });

  it("un rapport privé d'observation le DIT (il ne se contente pas d'un tableau nu)", () => {
    // Sans cet avertissement, un tableau sans mémoire ni CPU se lit comme un serveur au
    // repos plutôt que comme une mesure absente — et l'on cherche la panne au mauvais
    // endroit. Le verdict est injecté, donc la règle s'éprouve depuis n'importe quel
    // système : c'est le comportement attendu sur Windows COMME dans un conteneur mince.
    const proc = {
      pid: 42,
      ppid: 0,
      mode: "dev" as const,
      role: "server" as const,
      label: "server",
      rssKb: 0,
      cpu: 0,
      uptimeSec: 1,
    };
    const blind = buildDevStatus(cwd, null, false, [proc], [], true, false);
    assert.strictEqual(blind.supported, false);
    assert.ok(
      blind.warnings.some((w) => w.includes("non observables")),
      `le rapport doit annoncer l'absence d'observation : ${JSON.stringify(blind.warnings)}`,
    );
    // Et il rapporte quand même la topologie : se taire serait le vrai défaut.
    assert.strictEqual(blind.running, true);

    // Observation disponible → aucun avertissement de ce type.
    const seen = buildDevStatus(cwd, null, false, [proc], [], true, true);
    assert.strictEqual(seen.supported, true);
    assert.ok(!seen.warnings.some((w) => w.includes("non observables")));
  });

  // ⏱️ Ce test SPAWNE un process : le défaut de 5 s de vitest est un budget
  // d'assertion, pas de démarrage. Sous `test:all` (workspaces en parallèle)
  // il est dépassé sans qu'aucun défaut n'existe — vert en isolation, rouge
  // en suite. Le délai n'est pas une mesure ici : rien ne s'évalue en temps.
  it(
    "discoverDevProcessesDetailed CONSTATE la disponibilité, il ne la déduit pas",
    { timeout: 60_000 },
    () => {
      // La règle ne peut pas être « tout ce qui n'est pas Windows a `ps` » : `procps`
      // n'est pas installé dans les images Node minces — celles du Dockerfile de
      // production — ni garanti sur une BSD avec cette syntaxe. Le verdict doit donc
      // venir de l'exécution, et il doit distinguer « aucun process » de « je n'ai pas
      // pu regarder », faute de quoi aucun repli ne peut se déclencher.
      const d = discoverDevProcessesDetailed();
      assert.strictEqual(typeof d.supported, "boolean");
      assert.ok(Array.isArray(d.procs));
      // Là où l'observation a lieu, elle rend une liste (vide ou non) ; là où elle
      // n'a pas lieu, la liste est vide ET le drapeau le dit.
      if (!d.supported) assert.deepStrictEqual(d.procs, []);
    },
  );

  it("discoverFromRuntimeState rend le SUPERVISEUR AVANT le serveur (sinon il respawn)", () => {
    // Le superviseur relance son enfant dès qu'il le voit mourir : rendre le serveur
    // seul revenait à provoquer un rechargement au lieu d'un arrêt — l'arrêt sortait 0
    // et le port se rouvrait derrière. L'ordre EST le correctif.
    mkdirSync(path.dirname(devSupervisorPidFile(cwd)), { recursive: true });
    writeFileSync(devSupervisorPidFile(cwd), String(process.pid), "utf8");
    writeRuntimeState(cwd, { pid: process.pid, ports: [5153] });
    const found = discoverFromRuntimeState(cwd);
    assert.deepStrictEqual(
      found.map((p) => p.role),
      ["supervisor", "server"],
    );
    // Un superviseur vivant signe un runtime de développement.
    assert.strictEqual(found[1].mode, "dev");
  });

  it("discoverFromRuntimeState sans superviseur → serveur SEUL, en mode prod", () => {
    writeRuntimeState(cwd, { pid: process.pid, ports: [5153] });
    const found = discoverFromRuntimeState(cwd);
    assert.deepStrictEqual(
      found.map((p) => p.role),
      ["server"],
    );
    assert.strictEqual(found[0].mode, "prod");
  });

  it("discoverFromRuntimeState retrouve le runtime SANS observer les process", () => {
    // Le repli employé là où `ps` n'existe pas (Windows). Il n'observe rien : il lit
    // le fichier d'état du projet, qui porte le PID de qui écoute. L'appartenance au
    // projet est donc acquise par construction — c'est précisément ce que
    // l'introspection système ne peut pas garantir sous Windows, faute de pouvoir
    // lire le répertoire courant d'un process tiers.
    writeRuntimeState(cwd, { pid: process.pid, ports: [5153, 5154] });
    const found = discoverFromRuntimeState(cwd);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].pid, process.pid);
    assert.strictEqual(found[0].role, "server");
  });

  it("discoverFromRuntimeState : aucun état → rien (jamais un PID inventé)", () => {
    assert.deepStrictEqual(discoverFromRuntimeState(cwd), []);
  });

  it("discoverFromRuntimeState : état d'un process MORT → rien (pas de PID recyclé)", () => {
    // Un PID mort réattribué par l'OS à un process tiers ferait tuer un innocent.
    writeRuntimeState(cwd, { pid: 999_999_998, ports: [5153, 5154] });
    assert.deepStrictEqual(discoverFromRuntimeState(cwd), []);
  });

  it("defaultDevPorts LIT le state file — c'est tout l'intérêt du canal", () => {
    writeRuntimeState(cwd, { pid: process.pid, ports: [5153, 5154] });
    assert.deepStrictEqual(defaultDevPorts(cwd), [5153, 5154]);
  });

  it("NODEFONY_DEV_PORTS reste PRIORITAIRE (l'opérateur a toujours le dernier mot)", () => {
    writeRuntimeState(cwd, { pid: process.pid, ports: [5153, 5154] });
    process.env.NODEFONY_DEV_PORTS = "9000,9001";
    assert.deepStrictEqual(defaultDevPorts(cwd), [9000, 9001]);
  });

  it("state file d'un process MORT : ignoré ET purgé (jamais sonder les ports d'hier)", () => {
    // PID hautement improbable → traité comme mort.
    writeRuntimeState(cwd, { pid: 999_999_998, ports: [5153, 5154] });
    assert.strictEqual(readRuntimeState(cwd), null);
    // Purgé : un reliquat ferait mentir tous les lecteurs suivants.
    assert.strictEqual(existsSync(runtimeStateFile(cwd)), false);
    // Et on retombe proprement sur la convention.
    assert.deepStrictEqual(defaultDevPorts(cwd), [5151, 5152]);
  });

  it("state file absent → convention historique (premier boot : personne n'a rien publié)", () => {
    assert.strictEqual(readRuntimeState(cwd), null);
    assert.deepStrictEqual(defaultDevPorts(cwd), [5151, 5152]);
  });

  it("state file CORROMPU → null, jamais un crash (best-effort)", () => {
    const file = runtimeStateFile(cwd);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "{ pas du json", "utf8");
    assert.strictEqual(readRuntimeState(cwd), null);
    assert.deepStrictEqual(defaultDevPorts(cwd), [5151, 5152]);
  });

  it("state file SANS port valide → rejeté (un canal vide ne vaut pas mieux qu'absent)", () => {
    const file = runtimeStateFile(cwd);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({ pid: process.pid, ports: [0, -1, "x"] }),
      "utf8",
    );
    assert.strictEqual(readRuntimeState(cwd), null);
  });

  it("clearRuntimeState : idempotent (purger deux fois n'explose pas)", () => {
    writeRuntimeState(cwd, { pid: process.pid, ports: [5151] });
    clearRuntimeState(cwd);
    assert.strictEqual(existsSync(runtimeStateFile(cwd)), false);
    clearRuntimeState(cwd); // déjà parti
    assert.strictEqual(readRuntimeState(cwd), null);
  });

  it("le state file est PAR PROJET (deux apps ne se marchent pas dessus)", () => {
    const other = mkdtempSync(path.join(os.tmpdir(), "nf-runtime-b-"));
    try {
      writeRuntimeState(cwd, { pid: process.pid, ports: [5151, 5152] });
      writeRuntimeState(other, { pid: process.pid, ports: [5153, 5154] });
      assert.deepStrictEqual(defaultDevPorts(cwd), [5151, 5152]);
      assert.deepStrictEqual(defaultDevPorts(other), [5153, 5154]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe("devProcess — missingWorkspaceDists (post-condition build)", () => {
  it("détecte un workspace à rolldown SANS dist ; ignore dist présent et workspace sans rolldown", () => {
    const root = path.join(os.tmpdir(), `nf-devbuild-${process.pid}`);
    try {
      mkdirSync(path.join(root, "pkgs", "a", "dist"), { recursive: true });
      mkdirSync(path.join(root, "pkgs", "b"), { recursive: true });
      mkdirSync(path.join(root, "pkgs", "c"), { recursive: true });
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ workspaces: ["pkgs/*"] }),
      );
      // a : rolldown + dist présent → OK (absent de la liste)
      writeFileSync(path.join(root, "pkgs", "a", "rolldown.config.ts"), "");
      writeFileSync(
        path.join(root, "pkgs", "a", "package.json"),
        JSON.stringify({ name: "@x/a", main: "dist/index.js" }),
      );
      writeFileSync(path.join(root, "pkgs", "a", "dist", "index.js"), "");
      // b : rolldown mais PAS de dist → MANQUANT
      writeFileSync(path.join(root, "pkgs", "b", "rolldown.config.ts"), "");
      writeFileSync(
        path.join(root, "pkgs", "b", "package.json"),
        JSON.stringify({ name: "@x/b", main: "dist/index.js" }),
      );
      // c : PAS de config bundler (WIP non câblé) → ignoré même sans dist
      writeFileSync(
        path.join(root, "pkgs", "c", "package.json"),
        JSON.stringify({ name: "@x/c" }),
      );
      assert.deepStrictEqual(missingWorkspaceDists(root), ["@x/b"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("pas de package.json racine → liste vide (ne throw pas)", () => {
    const root = path.join(os.tmpdir(), `nf-devbuild-empty-${process.pid}`);
    try {
      mkdirSync(root, { recursive: true });
      assert.deepStrictEqual(missingWorkspaceDists(root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ─── Multi-projet : scoping par cwd (splitByProject / processCwd) ─────────────

/**
 * Chemins du décor, dans la grammaire de la PLATEFORME.
 *
 * `splitByProject` et `scopeAllToNodefonyProjects` normalisent les chemins qu'on leur
 * donne (`path.resolve`) avant de les comparer, et rendent la forme résolue. Un littéral
 * POSIX écrit en dur revient donc transformé sous Windows (`D:\home\dev\app-1`) et ne
 * s'égale plus lui-même — l'assertion tombe sans qu'aucun rattachement n'ait été mal
 * calculé. Construire le décor avec `path` éprouve le RATTACHEMENT, qui est le mécanisme
 * en cause, au lieu de la façon dont la plateforme écrit ses séparateurs.
 */
const P = (...seg: string[]): string => path.resolve(path.sep, ...seg);
const APP1 = P("home", "dev", "app-1");
const APP2 = P("home", "dev", "app-2");

describe("splitByProject — plusieurs apps Nodefony sur le même poste", () => {
  const proc = (pid: number, role: DevProcessInfo["role"]): DevProcessInfo => ({
    pid,
    ppid: 1,
    mode: "dev",
    role,
    label: role,
    detail: "",
    rssKb: 0,
    cpu: 0,
    uptimeSec: 1,
  });

  it("cwd exact → mine ; autre dossier → foreign (JAMAIS tué)", () => {
    const cwds: Record<number, string | null> = {
      1: APP1,
      2: APP2,
    };
    const { mine, foreign } = splitByProject(
      [proc(1, "supervisor"), proc(2, "supervisor")],
      APP1,
      (pid) => cwds[pid] ?? null,
    );
    assert.deepStrictEqual(
      mine.map((p) => p.pid),
      [1],
    );
    assert.deepStrictEqual(
      foreign.map((p) => [p.pid, p.cwd]),
      [[2, APP2]],
    );
  });

  it("vite en SOUS-dossier du projet → mine ; server en sous-dossier → foreign (spawn racine)", () => {
    const cwds: Record<number, string> = {
      3: P("home", "dev", "app-1", "frontend"),
      4: P("home", "dev", "app-1", "frontend"),
    };
    const { mine, foreign } = splitByProject(
      [proc(3, "vite"), proc(4, "server")],
      APP1,
      (pid) => cwds[pid] ?? null,
    );
    assert.deepStrictEqual(
      mine.map((p) => p.pid),
      [3],
    );
    assert.deepStrictEqual(
      foreign.map((p) => p.pid),
      [4],
    );
  });

  it("cwd IRRÉSOLU → foreign (on préfère un orphelin vivant à un projet tué)", () => {
    const { mine, foreign } = splitByProject(
      [proc(5, "supervisor")],
      APP1,
      () => null,
    );
    assert.deepStrictEqual(mine, []);
    assert.deepStrictEqual(
      foreign.map((p) => [p.pid, p.cwd]),
      [[5, null]],
    );
  });

  // Timeout large : `lsof` (macOS) met plusieurs secondes quand la suite complète
  // sature le CPU — flake de contention sous les 5 s par défaut, vert en isolation.
  it("processCwd(process.pid) résout le cwd RÉEL du process courant", () => {
    const cwd = processCwd(process.pid);
    // Sonde réelle (lsof/procfs) : résolution possible → doit matcher notre cwd.
    if (cwd !== null) {
      assert.strictEqual(path.resolve(cwd), path.resolve(process.cwd()));
    }
  }, 30_000);
});

// ─── `stop --all` : le titre ne suffit pas à autoriser un kill trans-projets ──

describe("scopeAllToNodefonyProjects — seconde preuve avant un kill sans projet", () => {
  const proc = (pid: number, role: DevProcessInfo["role"]): DevProcessInfo => ({
    pid,
    ppid: 1,
    mode: "dev",
    role,
    label: role,
    detail: "",
    rssKb: 0,
    cpu: 0,
    uptimeSec: 1,
  });

  it("titre Nodefony mais cwd HORS projet → épargné (homonyme)", () => {
    const cwds: Record<number, string | null> = {
      1: APP1, // vrai projet
      2: P("opt", "random-daemon"), // homonyme : porte le titre, sans projet
    };
    const { kept, rejected } = scopeAllToNodefonyProjects(
      [proc(1, "supervisor"), proc(2, "server")],
      (pid) => cwds[pid] ?? null,
      (dir) => dir === APP1,
    );
    assert.deepStrictEqual(
      kept.map((p) => p.pid),
      [1],
    );
    assert.deepStrictEqual(
      rejected.map((r) => r.proc.pid),
      [2],
    );
  });

  it("cwd ILLISIBLE → épargné (aucune preuve ⇒ aucun kill)", () => {
    const { kept, rejected } = scopeAllToNodefonyProjects(
      [proc(3, "server")],
      () => null,
      () => true,
    );
    assert.deepStrictEqual(kept, []);
    assert.strictEqual(rejected[0].why, "cwd illisible");
  });

  it("Vite dans un SOUS-dossier du projet → gardé (racine remontée)", () => {
    const { kept } = scopeAllToNodefonyProjects(
      [proc(4, "vite")],
      () => P("home", "dev", "app-1", "src", "bundles", "studio"),
      (dir) => dir === APP1,
    );
    assert.deepStrictEqual(
      kept.map((p) => p.pid),
      [4],
    );
  });
});

describe("killTreeCommand — atteindre un arbre sur chaque plateforme", () => {
  it("Windows : taskkill descend la filiation, de force (aucun gracieux n'existe)", () => {
    assert.deepStrictEqual(killTreeCommand(4212, "win32"), {
      file: "taskkill",
      args: ["/PID", "4212", "/T", "/F"],
    });
  });

  it("POSIX : pas de programme externe — la voie est le signal de groupe", () => {
    assert.strictEqual(killTreeCommand(4212, "linux"), null);
    assert.strictEqual(killTreeCommand(4212, "darwin"), null);
  });
});

describe("signalProcessGroup — le verdict, pas l'intention", () => {
  it("Windows : l'arbre est emporté par taskkill, pas par un kill de pid", () => {
    const killed: number[] = [];
    const ran: { file: string; args: string[] }[] = [];
    const outcome = signalProcessGroup(4212, "SIGTERM", {
      platform: "win32",
      runTreeKill: (cmd) => {
        ran.push(cmd);
        return true;
      },
      killPid: (p) => {
        killed.push(p);
      },
    });
    assert.strictEqual(outcome, "forced-tree");
    assert.deepStrictEqual(ran[0].args, ["/PID", "4212", "/T", "/F"]);
    assert.deepStrictEqual(killed, []); // l'enfant direct n'est PAS visé séparément
  });

  it("Windows sans taskkill : repli sur l'enfant direct, et on l'ANNONCE (single)", () => {
    const killed: number[] = [];
    const outcome = signalProcessGroup(4212, "SIGTERM", {
      platform: "win32",
      runTreeKill: () => false, // binaire absent / refusé
      killPid: (p) => {
        killed.push(p);
      },
    });
    assert.strictEqual(outcome, "single"); // ⇒ des Vite peuvent survivre
    assert.deepStrictEqual(killed, [4212]);
  });

  it("Windows, process déjà mort : `gone`, jamais `single` (pas de faux orphelin)", () => {
    const outcome = signalProcessGroup(4212, "SIGTERM", {
      platform: "win32",
      runTreeKill: () => false,
      killPid: () => {
        throw new Error("ESRCH");
      },
    });
    assert.strictEqual(outcome, "gone");
  });

  it("POSIX : le groupe reçoit le signal négatif", () => {
    const groups: number[] = [];
    const outcome = signalProcessGroup(77, "SIGTERM", {
      platform: "linux",
      killGroup: (p) => {
        groups.push(p);
      },
      killPid: () => {},
    });
    assert.strictEqual(outcome, "group");
    assert.deepStrictEqual(groups, [77]);
  });

  it("POSIX, pas leader de groupe : `single` — le pid seul a été atteint", () => {
    const outcome = signalProcessGroup(77, "SIGKILL", {
      platform: "linux",
      killGroup: () => {
        throw new Error("ESRCH");
      },
      killPid: () => {},
    });
    assert.strictEqual(outcome, "single");
  });

  it("POSIX, plus rien à atteindre : `gone`", () => {
    const outcome = signalProcessGroup(77, "SIGKILL", {
      platform: "linux",
      killGroup: () => {
        throw new Error("ESRCH");
      },
      killPid: () => {
        throw new Error("ESRCH");
      },
    });
    assert.strictEqual(outcome, "gone");
  });
});

describe("parseTasklistImage — « je l'ai vu » vs « je n'ai rien vu »", () => {
  it("ligne CSV → nom d'image", () => {
    assert.strictEqual(
      parseTasklistImage('"node.exe","4212","Console","1","52 480 K"'),
      "node.exe",
    );
  });

  it("phrase INFO (code de sortie NUL) → aucun process décrit", () => {
    assert.strictEqual(
      parseTasklistImage(
        "INFO: No tasks are running which match the specified criteria.",
      ),
      null,
    );
  });

  it("sortie vide → null", () => {
    assert.strictEqual(parseTasklistImage(""), null);
  });
});
