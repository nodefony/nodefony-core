/*
 *   Tests UNITAIRES du rapport status « standalone ». La collecte/rendu (runStatusReport)
 *   fait des I/O système (ps, stdout) testés en E2E runtime ; ici on verrouille la liste
 *   des commandes exécutables SANS boot kernel (statut « système », marche hors trunk),
 *   et le SCOPING PAR PROJET du rapport : `status` et `stop` doivent délimiter le même
 *   « mon projet », sinon une application arrêtée s'entend dire « 2/2 ports UP ».
 */

import assert from "node:assert";
import path from "node:path";
import os from "node:os";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import {
  collectDevStatus,
  isStandaloneDevCommand,
  runStatusReport,
} from "../service/dev/devStatusReport";
import { projetsDuPoste, runStopReport } from "../service/dev/devStop";
import {
  readRuntimeState,
  writeReadinessState,
  writeRuntimeState,
  type DevProcessInfo,
  type PortState,
  type ProcessDiscovery,
} from "../service/dev/devProcess";

describe("devStatusReport — commandes système standalone", () => {
  it("status/stop sont standalone (zéro boot) ; les commandes serveur ne le sont PAS", () => {
    assert.strictEqual(isStandaloneDevCommand("status"), true);
    assert.strictEqual(isStandaloneDevCommand("stop"), true);
    assert.strictEqual(isStandaloneDevCommand("development"), false);
    assert.strictEqual(isStandaloneDevCommand("cluster"), false);
    assert.strictEqual(isStandaloneDevCommand("build"), false);
  });
});

// ─── Scoping par projet : `status` voit ce que `stop` touche ──────────────────
//
// Décor : DEUX projets sur le poste. Le nôtre ne fait rien tourner ; le voisin
// tient les ports de la convention (5151/5152) et l'a publié dans son fichier
// d'état. Les sondes système sont INJECTÉES : aucun `ps` réel, aucun port réel
// ouvert, aucun risque de signaler un process de la machine.

/** Fabrique un process observé (les colonnes non pertinentes valent zéro). */
const proc = (
  pid: number,
  role: DevProcessInfo["role"],
  mode: DevProcessInfo["mode"] = "dev",
): DevProcessInfo => ({
  pid,
  ppid: 1,
  mode,
  role,
  label: role,
  rssKb: 1024,
  cpu: 0,
  uptimeSec: 60,
});

describe("status / stop — deux commandes, UN SEUL « mon projet »", () => {
  let mine = "";
  let neighbour = "";
  /** Les 4 process du voisin, tels que `ps` les rend (balayage GLOBAL au poste). */
  let theirs: DevProcessInfo[] = [];
  /** Ports de la convention, tenus par le voisin. */
  const busyPorts: PortState[] = [
    { port: 5151, listening: true },
    { port: 5152, listening: true },
  ];

  beforeEach(() => {
    const base = mkdtempSync(path.join(os.tmpdir(), "nf-scope-"));
    mine = path.join(base, "mine");
    neighbour = path.join(base, "neighbour");
    theirs = [
      proc(45799, "supervisor"),
      proc(67751, "server"),
      proc(67794, "vite"),
      proc(67801, "vite"),
    ];
    // Le voisin publie ses ports effectifs — process vivant requis (le lecteur
    // ignore l'état d'un pid mort), on prend donc le nôtre.
    writeRuntimeState(neighbour, { pid: process.pid, ports: [5151, 5152] });
  });

  afterEach(() => {
    rmSync(path.dirname(mine), { recursive: true, force: true });
  });

  /** Sondes injectées : `ps` rend les process du voisin, tous au cwd du voisin. */
  const deps = () => ({
    discover: (): ProcessDiscovery => ({ supported: true, procs: theirs }),
    getCwd: (pid: number) =>
      theirs.some((p) => p.pid === pid) ? neighbour : null,
    probe: async (): Promise<PortState[]> => busyPorts,
  });

  it("la disponibilité n'est JAMAIS demandée au runtime d'un autre projet", async () => {
    // Le voisin tient les deux ports. Sonder ici afficherait SA disponibilité
    // sous notre titre — la variante exacte du « 4 process · 2/2 ports UP ».
    let interroge = 0;
    const report = await collectDevStatus(mine, {
      ...deps(),
      probeReadiness: async () => {
        interroge += 1;
        return { ready: true, blocked: 0 };
      },
    });
    assert.strictEqual(interroge, 0, "aucune sonde vers le voisin");
    assert.strictEqual(report.readiness, null, "et donc aucun verdict inventé");
  });

  it("le runtime de CE projet est interrogé, et son verdict est rendu tel quel", async () => {
    const report = await collectDevStatus(mine, {
      // Personne d'autre sur le poste : les ports en écoute sont les nôtres.
      discover: (): ProcessDiscovery => ({ supported: true, procs: [] }),
      getCwd: () => null,
      probe: async (): Promise<PortState[]> => busyPorts,
      probeReadiness: async () => ({ ready: false, blocked: 1 }),
    });
    assert.deepStrictEqual(report.readiness, { ready: false, blocked: 1 });
  });

  it("NOMME qui retient la mise en service quand le serveur l'a publié", async () => {
    // Le serveur écrit ce que le noyau sait déjà — et que la sonde publique ne
    // rend qu'à un appelant authentifié.
    writeReadinessState(mine, [
      {
        name: "drizzle:default",
        ready: false,
        reason: "2 migrations en attente",
      },
      { name: "cache", ready: true },
    ]);
    const report = await collectDevStatus(mine, {
      discover: (): ProcessDiscovery => ({ supported: true, procs: [] }),
      getCwd: () => null,
      probe: async (): Promise<PortState[]> => busyPorts,
      probeReadiness: async () => ({ ready: false, blocked: 1 }),
    });
    assert.deepStrictEqual(
      report.readiness?.blockedBy,
      [{ name: "drizzle:default", reason: "2 migrations en attente" }],
      "le contributeur PRÊT n'a pas à figurer : on nomme ce qui RETIENT",
    );
  });

  it("un contributeur SANS raison est nommé quand même — le nom seul vaut mieux qu'un compte", async () => {
    writeReadinessState(mine, [{ name: "cache", ready: false }]);
    const report = await collectDevStatus(mine, {
      discover: (): ProcessDiscovery => ({ supported: true, procs: [] }),
      getCwd: () => null,
      probe: async (): Promise<PortState[]> => busyPorts,
      probeReadiness: async () => ({ ready: false, blocked: 1 }),
    });
    assert.deepStrictEqual(report.readiness?.blockedBy, [{ name: "cache" }]);
  });

  it("ne nomme RIEN quand le détail ne concorde pas avec le compte du runtime", async () => {
    // Le fichier a un cycle de retard : deux contributeurs y retiennent encore,
    // le runtime n'en compte plus qu'un. Nommer ici enverrait chercher une
    // cause déjà levée — pire qu'un compte nu.
    writeReadinessState(mine, [
      {
        name: "drizzle:default",
        ready: false,
        reason: "2 migrations en attente",
      },
      { name: "cache", ready: false, reason: "froid" },
    ]);
    const report = await collectDevStatus(mine, {
      discover: (): ProcessDiscovery => ({ supported: true, procs: [] }),
      getCwd: () => null,
      probe: async (): Promise<PortState[]> => busyPorts,
      probeReadiness: async () => ({ ready: false, blocked: 1 }),
    });
    assert.strictEqual(report.readiness?.blockedBy, undefined);
    assert.strictEqual(report.readiness?.blocked, 1, "le compte, lui, reste");
  });

  it("sans fichier publié, le rapport garde le compte et n'invente aucun nom", async () => {
    const report = await collectDevStatus(mine, {
      discover: (): ProcessDiscovery => ({ supported: true, procs: [] }),
      getCwd: () => null,
      probe: async (): Promise<PortState[]> => busyPorts,
      probeReadiness: async () => ({ ready: false, blocked: 2 }),
    });
    assert.strictEqual(report.readiness?.blockedBy, undefined);
  });

  it("la LIGNE RENDUE porte le nom et la raison — c'est elle que l'utilisateur lit", async () => {
    // Le rendu court-circuite hors d'un projet Nodefony : sans ce `package.json`,
    // le banc mesurerait le message « ce dossier n'est pas un projet ».
    mkdirSync(mine, { recursive: true });
    writeFileSync(
      path.join(mine, "package.json"),
      JSON.stringify({ name: "banc", dependencies: { nodefony: "*" } }),
      "utf8",
    );
    writeReadinessState(mine, [
      {
        name: "drizzle:default",
        ready: false,
        reason: "2 migrations en attente",
      },
    ]);
    // La ligne de disponibilité ne se rend que pour un projet qui TOURNE : un
    // serveur à nous, sur nos ports.
    const mien = proc(4242, "server");
    let out = "";
    await runStatusReport(mine, {
      discover: (): ProcessDiscovery => ({ supported: true, procs: [mien] }),
      getCwd: (pid: number) => (pid === mien.pid ? mine : null),
      probe: async (): Promise<PortState[]> => busyPorts,
      probeReadiness: async () => ({ ready: false, blocked: 1 }),
      write: (t) => (out += t),
    });
    assert.ok(
      out.includes("drizzle:default (2 migrations en attente)"),
      `la ligne de disponibilité doit NOMMER ce qui retient — obtenu :\n${out}`,
    );
    assert.ok(
      !out.includes("1 composant retient"),
      "le compte nu ne doit plus s'afficher quand on sait nommer",
    );
  });

  it("les process d'un AUTRE projet ne sont NI comptés NI annoncés comme des ports à nous", async () => {
    const report = await collectDevStatus(mine, deps());
    // Le défaut exact rapporté : « 4 process · 2/2 ports UP » pour une app à l'arrêt.
    assert.strictEqual(
      report.running,
      false,
      "aucun process de CE projet ne tourne",
    );
    assert.deepStrictEqual(report.processes, []);
    assert.strictEqual(report.summary.supervisors, 0);
    assert.strictEqual(report.summary.servers, 0);
    assert.strictEqual(report.summary.vites, 0);
    // Et les runtimes du voisin ne sont pas TUS pour autant : nommés, avec leur dossier.
    assert.strictEqual(report.foreign.length, 4);
    assert.deepStrictEqual(
      [...new Set(report.foreign.map((p) => p.cwd))],
      [path.resolve(neighbour)],
    );
    // Les ports occupés sont ATTRIBUÉS — « pas à moi » ≠ « pas mort ».
    assert.deepStrictEqual(report.portOwners, {
      5151: path.resolve(neighbour),
      5152: path.resolve(neighbour),
    });
  });

  it("le rendu `status` n'affiche PAS « ports UP » et nomme le projet qui tient le port", async () => {
    let out = "";
    await runStatusReport(mine, { ...deps(), write: (s) => (out += s) });
    const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
    // Le décor de ce test est un dossier temporaire — donc PAS un projet Nodefony.
    // Le rapport doit dire l'absence, dans les termes qui conviennent à la
    // situation : « aucune instance » suppose un projet, et l'écrire ici serait la
    // contradiction que garde le test « HORS projet, … » plus bas.
    assert.ok(
      /n'est pas un projet Nodefony/.test(plain),
      `doit annoncer l'absence, sans supposer un projet :\n${plain}`,
    );
    assert.ok(
      !/ports UP/.test(plain),
      `« ports UP » est un verdict sur NOS ports :\n${plain}`,
    );
    assert.ok(
      plain.includes(path.resolve(neighbour)),
      `le dossier qui tient le port doit être nommé :\n${plain}`,
    );
  });

  it("`stop` ne marque pas en ÉCHEC des ports qui appartiennent à un autre projet", async () => {
    let out = "";
    await runStopReport(mine, { ...deps(), write: (s) => (out += s) });
    const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
    assert.ok(
      /aucune instance de ce projet/.test(plain),
      `rien à arrêter ici :\n${plain}`,
    );
    // La croix « encore occupé » disait un arrêt qui a échoué — alors que `stop`
    // venait lui-même d'annoncer que ces runtimes étaient à un AUTRE projet.
    assert.ok(
      !/encore occupé/.test(plain),
      `aucun échec d'arrêt à signaler :\n${plain}`,
    );
    assert.ok(
      plain.includes(path.resolve(neighbour)),
      `dire QUI tient le port :\n${plain}`,
    );
  });

  it("cwd des process ILLISIBLE → liste GLOBALE annoncée, jamais « aucune instance »", async () => {
    // Le rattachement au projet dépend d'une capacité (`lsof`, `/proc/<pid>/cwd`)
    // qui peut manquer — image Node mince, droits refusés. Écarter alors tous les
    // process reviendrait à dire « rien ne tourne » à quelqu'un dont le serveur
    // répond : le filtre ne doit jamais aveugler le rapport.
    const report = await collectDevStatus(mine, {
      discover: (): ProcessDiscovery => ({ supported: true, procs: theirs }),
      getCwd: () => null, // aucune résolution possible
      probe: async (): Promise<PortState[]> => busyPorts,
    });
    assert.strictEqual(
      report.running,
      true,
      "les process observés sont rendus",
    );
    assert.strictEqual(report.processes.length, 4);
    assert.deepStrictEqual(report.foreign, []);
    assert.ok(
      report.warnings.some((w) => w.includes("indéterminable")),
      `la liste large doit être ANNONCÉE : ${JSON.stringify(report.warnings)}`,
    );
  });

  it("nos propres process, eux, sont bien comptés (le filtre n'aveugle pas)", async () => {
    const ours = [proc(1001, "supervisor"), proc(1002, "server")];
    const report = await collectDevStatus(mine, {
      discover: (): ProcessDiscovery => ({
        supported: true,
        procs: [...ours, ...theirs],
      }),
      getCwd: (pid: number) =>
        ours.some((p) => p.pid === pid) ? mine : neighbour,
      probe: async (): Promise<PortState[]> => busyPorts,
    });
    assert.strictEqual(report.running, true);
    assert.strictEqual(report.summary.supervisors, 1);
    assert.strictEqual(report.summary.servers, 1);
    assert.strictEqual(
      report.summary.vites,
      0,
      "les Vite du voisin sont à lui",
    );
    assert.strictEqual(report.foreign.length, 4);
  });

  it("`status` NOMME les projets vivants, et dit comment les arrêter", async () => {
    let out = "";
    await runStatusReport(mine, { ...deps(), write: (s) => (out += s) });
    const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
    assert.ok(
      plain.includes(path.basename(neighbour)),
      `le projet voisin doit être NOMMÉ, pas seulement situé :\n${plain}`,
    );
    // Son bloc porte ses PROCESS, pas seulement son nom : c'est ce qui remplace
    // la liste à plat que le lecteur devait recouper avec le reste du rapport.
    assert.ok(
      /supervisor\s+45799/.test(plain),
      `le bloc du voisin doit montrer ses process :\n${plain}`,
    );
    assert.ok(
      /Résumé/.test(plain) && /nodefony stop /.test(plain),
      `un résumé doit expliquer et donner le geste :\n${plain}`,
    );
  });

  it("`stop <nom>` DIT qu'il est aveugle plutôt que de nier le projet (Windows, images minces)", async () => {
    // Le rattachement d'un pid à son projet passe par `lsof` — absent sous
    // Windows. Aucune racine n'est alors connue, et la réponse « aucun projet ne
    // s'appelle X » affirmerait une absence là où l'on n'a rien pu regarder : un
    // développeur Windows en conclurait que son application est éteinte.
    //
    // Le verdict est INJECTÉ (getCwd → null), donc ce cas s'éprouve depuis
    // n'importe quelle plateforme — c'est la seule façon de garder un
    // comportement Windows sans machine Windows.
    let out = "";
    const code = await runStopReport(mine, {
      discover: (): ProcessDiscovery => ({ supported: true, procs: theirs }),
      getCwd: () => null,
      probe: async (): Promise<PortState[]> => busyPorts,
      write: (s) => (out += s),
      target: "monapp",
    });
    const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
    assert.strictEqual(code, 1, "rien ne doit être arrêté au hasard");
    assert.ok(
      /impossible de rattacher les process à un projet/.test(plain),
      `la cécité doit être ÉNONCÉE :\n${plain}`,
    );
    assert.ok(
      !/aucun projet Nodefony en cours ne s'appelle/.test(plain),
      `ne jamais nier un projet qu'on n'a pas pu chercher :\n${plain}`,
    );
    // Les deux voies qui ne dépendent PAS de cette capacité sont données.
    assert.ok(
      /nodefony stop --all/.test(plain) && /cd <projet>/.test(plain),
      `donner les sorties qui marchent quand même :\n${plain}`,
    );
  });

  it("`stop --all` SONDE les ports de tous les projets qu'il arrête", () => {
    // Le défaut mesuré : 6 process de DEUX projets tués, et le rapport ne
    // vérifiait que 5151/5152 avant de conclure « ✓ arrêté proprement ». Un port
    // qu'on ne sonde pas ne peut ni confirmer ni infirmer un arrêt.
    //
    // Éprouvé sur la fonction PURE qui décide QUELLES racines interroger : le
    // chemin complet TUE, il n'a pas sa place dans une suite.
    writeRuntimeState(neighbour, { pid: process.pid, ports: [5153, 5154] });
    const racines = projetsDuPoste(theirs, (pid: number) =>
      theirs.some((p) => p.pid === pid) ? neighbour : null,
    );
    assert.deepStrictEqual(racines, [path.resolve(neighbour)]);
    // Un Vite n'apporte pas de racine : son parent la porte déjà, et il travaille
    // parfois dans un sous-dossier.
    assert.strictEqual(
      projetsDuPoste(
        theirs.filter((p) => p.role === "vite"),
        () => path.join(neighbour, "frontend"),
      ).length,
      0,
    );
    // Et la racine rendue mène bien aux ports que ce projet publie.
    assert.deepStrictEqual(readRuntimeState(racines[0])?.ports, [5153, 5154]);
  });

  it("HORS projet, le rapport ne parle jamais de « ce projet »", async () => {
    // Le titre disait « aucune instance de CE PROJET » juste avant d'annoncer que
    // le dossier n'est pas un projet : deux phrases contradictoires dans le même
    // écran, qui laissaient croire qu'on était dans une application.
    let out = "";
    await runStatusReport(mine, { ...deps(), write: (s) => (out += s) });
    const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
    assert.ok(
      !/de ce projet/.test(plain),
      `hors projet, « ce projet » n'a pas de référent :\n${plain}`,
    );
    assert.ok(
      /n'est pas un projet Nodefony/.test(plain),
      `dire OÙ l'on est, d'abord :\n${plain}`,
    );
    // Les ports de la convention ne sont ceux de personne ici : les annoncer
    // « libres » serait un verdict sur une application qui n'existe pas.
    assert.ok(
      !/ports\s+5151 libre/.test(plain),
      `pas de verdict sur des ports qui n'appartiennent à aucun projet :\n${plain}`,
    );
  });

  it("les ports d'un VOISIN sont SONDÉS, pas seulement « déclarés »", async () => {
    // Le défaut corrigé : un projet dont le serveur est VIVANT voyait ses ports
    // annoncés « déclarés, non sondés » — le rapport doutait de ce qu'il pouvait
    // vérifier d'une connexion TCP locale, et le lecteur en concluait qu'il ne
    // tournait pas.
    const ailleurs = [5153, 5154];
    writeRuntimeState(neighbour, { pid: process.pid, ports: ailleurs });
    let out = "";
    await runStatusReport(mine, {
      discover: (): ProcessDiscovery => ({ supported: true, procs: theirs }),
      getCwd: (pid: number) =>
        theirs.some((p) => p.pid === pid) ? neighbour : null,
      // La sonde répond pour NOS ports (libres) comme pour ceux du voisin.
      probe: async (ports: readonly number[]): Promise<PortState[]> =>
        ports.map((port) => ({
          port,
          listening: ailleurs.includes(port),
        })),
      write: (s) => (out += s),
    });
    const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
    assert.ok(
      /5153 ✓ écoute/.test(plain) && /5154 ✓ écoute/.test(plain),
      `les ports du voisin doivent porter un verdict SONDÉ :\n${plain}`,
    );
    assert.ok(
      !/5153 déclaré/.test(plain),
      `« déclaré » ne doit rester que pour un port qu'on n'a PAS sondé :\n${plain}`,
    );
  });

  // ── `stop <projet>` : ces trois cas ne tuent RIEN, et c'est le sujet. Un arrêt
  // est irréversible : ce qui protège n'est pas la correspondance, c'est le refus.
  // (Le chemin nominal, lui, TUE — il n'est donc pas éprouvé ici : `terminateDev
  // Processes` n'est pas injectable et des pids fabriqués existent peut-être sur
  // la machine qui joue la suite.)
  it("`stop <inconnu>` REFUSE, sort en échec et n'arrête rien", async () => {
    let out = "";
    const code = await runStopReport(mine, {
      ...deps(),
      write: (s) => (out += s),
      target: "projet-qui-nexiste-pas",
    });
    const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
    assert.strictEqual(code, 1, "un stop qui n'a pas compris sa cible échoue");
    assert.ok(
      /aucun projet Nodefony en cours ne s'appelle/.test(plain),
      `le refus doit être explicite :\n${plain}`,
    );
    assert.ok(
      !/arrêt de \d+ process/.test(plain),
      `rien ne doit être arrêté :\n${plain}`,
    );
  });

  it("`stop <projet> --all` REFUSE : la contradiction ne se tranche pas toute seule", async () => {
    let out = "";
    const code = await runStopReport(mine, {
      ...deps(),
      write: (s) => (out += s),
      target: path.basename(neighbour),
      all: true,
    });
    const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
    assert.strictEqual(code, 1);
    assert.ok(
      /contradictoires/.test(plain),
      `dire pourquoi c'est refusé :\n${plain}`,
    );
  });

  it("`stop <nom>` REFUSE quand deux projets portent ce nom", async () => {
    // Deux clones du même dépôt : le nom ne suffit plus à désigner. Choisir l'un
    // des deux arrêterait le mauvais serveur sur une faute de frappe.
    const base = path.dirname(mine);
    const jumeaux = [
      path.join(base, "a", "monapp"),
      path.join(base, "b", "monapp"),
    ];
    const procsJumeaux = [proc(50001, "server"), proc(50002, "server")];
    let out = "";
    const code = await runStopReport(mine, {
      discover: (): ProcessDiscovery => ({
        supported: true,
        procs: procsJumeaux,
      }),
      getCwd: (pid: number) =>
        pid === procsJumeaux[0].pid ? jumeaux[0] : jumeaux[1],
      probe: async (): Promise<PortState[]> => busyPorts,
      write: (s) => (out += s),
      target: "monapp",
    });
    const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
    assert.strictEqual(code, 1);
    assert.ok(
      /désigne 2 projets/.test(plain),
      `le refus doit compter les homonymes :\n${plain}`,
    );
    assert.ok(
      plain.includes(jumeaux[0]) && plain.includes(jumeaux[1]),
      `les deux racines doivent être données pour trancher :\n${plain}`,
    );
  });
});
