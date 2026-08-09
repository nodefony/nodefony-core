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
import { mkdtempSync, rmSync } from "node:fs";
import {
  collectDevStatus,
  isStandaloneDevCommand,
  runStatusReport,
} from "../service/dev/devStatusReport";
import { runStopReport } from "../service/dev/devStop";
import {
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
    assert.ok(
      /aucune instance/.test(plain),
      `doit annoncer l'absence d'instance :\n${plain}`,
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
      /Projets Nodefony sur ce poste/.test(plain),
      `la table des projets doit apparaître :\n${plain}`,
    );
    assert.ok(
      plain.includes(path.basename(neighbour)),
      `le projet voisin doit être NOMMÉ, pas seulement situé :\n${plain}`,
    );
    assert.ok(
      /nodefony stop <nom\|chemin>/.test(plain),
      `un nom affiché doit être utilisable :\n${plain}`,
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
