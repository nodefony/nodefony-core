/*
 *   Tests UNITAIRES de la table des projets (devProjects.ts) — ce que `nodefony
 *   status` affiche et ce que `nodefony stop <projet>` accepte comme cible.
 *
 *   Ce qui est éprouvé ici tient en une phrase : on n'arrête un projet que si on
 *   l'a DÉSIGNÉ sans ambiguïté. Les deux refus (inconnu, homonymes) comptent donc
 *   autant que la résolution réussie — c'est le refus qui protège, pas la
 *   correspondance.
 *
 *   Fonctions PURES (lectures injectées) → aucun process, aucun fichier.
 */

import assert from "node:assert";
import path from "node:path";
import { describe, it } from "vitest";
import {
  buildProjectTable,
  resolveProjectTarget,
  type IProjectRuntime,
} from "../service/dev/devProjects";
import type {
  DevProcessInfo,
  DevProcessWithCwd,
} from "../service/dev/devProcess";

/** Racines composées, jamais littéralisées — un séparateur en dur ne voyage pas. */
const ROOT_MOI = path.join(path.sep, "home", "cci", "mon-projet");
const ROOT_VOISIN = path.join(path.sep, "tmp", "apps", "monapp");
const ROOT_TIERS = path.join(path.sep, "srv", "autre", "monapp");

function proc(pid: number, role: DevProcessInfo["role"]): DevProcessInfo {
  return {
    pid,
    ppid: 1,
    mode: "dev",
    role,
    label: role,
    rssKb: 1024,
    cpu: 0,
    uptimeSec: 60,
  };
}

function foreignProc(
  pid: number,
  role: DevProcessInfo["role"],
  cwd: string,
): DevProcessWithCwd {
  return { ...proc(pid, role), cwd };
}

const deps = {
  readName: (root: string) =>
    root === ROOT_MOI ? "mon-projet" : root === ROOT_VOISIN ? "monapp" : null,
  readPorts: (root: string) => (root === ROOT_VOISIN ? [5153, 5154] : []),
};

describe("devProjects — table des projets", () => {
  it("place le projet courant en tête et le marque comme tel", () => {
    const table = buildProjectTable(
      ROOT_MOI,
      [proc(10, "supervisor"), proc(11, "server")],
      [foreignProc(20, "server", ROOT_VOISIN)],
      [5151, 5152],
      deps,
    );
    assert.strictEqual(table.length, 2);
    assert.strictEqual(table[0].root, ROOT_MOI);
    assert.strictEqual(table[0].current, true);
    assert.strictEqual(table[0].procs.length, 2);
    assert.deepStrictEqual([...table[0].ports], [5151, 5152]);
    assert.strictEqual(table[1].current, false);
    assert.deepStrictEqual([...table[1].ports], [5153, 5154]);
  });

  it("n'invente pas de nom : un package.json muet rend le nom du DOSSIER, et le DIT", () => {
    const table = buildProjectTable(
      ROOT_MOI,
      [],
      [foreignProc(30, "server", ROOT_TIERS)],
      [],
      deps,
    );
    assert.strictEqual(table.length, 1);
    assert.strictEqual(table[0].name, "monapp");
    assert.strictEqual(table[0].nameSource, "dossier");
  });

  it("rattache un Vite d'un sous-dossier à la racine de son projet", () => {
    const table = buildProjectTable(
      ROOT_MOI,
      [],
      [
        foreignProc(20, "server", ROOT_VOISIN),
        foreignProc(21, "vite", path.join(ROOT_VOISIN, "frontend")),
      ],
      [],
      deps,
    );
    assert.strictEqual(table.length, 1);
    assert.strictEqual(table[0].procs.length, 2);
  });

  it("omet le projet courant quand il ne tourne pas", () => {
    const table = buildProjectTable(
      ROOT_MOI,
      [],
      [foreignProc(20, "server", ROOT_VOISIN)],
      [],
      deps,
    );
    assert.strictEqual(
      table.every((p) => !p.current),
      true,
    );
  });
});

describe("devProjects — résolution d'une cible", () => {
  const table: IProjectRuntime[] = buildProjectTable(
    ROOT_MOI,
    [proc(10, "server")],
    [foreignProc(20, "server", ROOT_VOISIN)],
    [5151],
    deps,
  );

  it("résout par NOM déclaré", () => {
    const r = resolveProjectTarget("monapp", table);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.ok && r.project.root, ROOT_VOISIN);
  });

  it("résout par CHEMIN", () => {
    const r = resolveProjectTarget(ROOT_VOISIN, table);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.ok && r.project.root, ROOT_VOISIN);
  });

  it("REFUSE un nom inconnu, et rend les projets connus pour corriger", () => {
    const r = resolveProjectTarget("moapp", table);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(!r.ok && r.reason, "inconnu");
    assert.strictEqual(!r.ok && r.candidates.length, 2);
  });

  it("REFUSE des homonymes plutôt que d'en choisir un", () => {
    // Deux clones portent le même nom de dossier : c'est le cas qui doit refuser,
    // sinon une faute de frappe arrête le mauvais serveur.
    const homonymes = buildProjectTable(
      ROOT_MOI,
      [],
      [
        foreignProc(20, "server", ROOT_VOISIN),
        foreignProc(30, "server", ROOT_TIERS),
      ],
      [],
      { ...deps, readName: () => null },
    );
    const r = resolveProjectTarget("monapp", homonymes);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(!r.ok && r.reason, "ambigu");
    assert.strictEqual(!r.ok && r.candidates.length, 2);
  });

  it("ne confond pas un nom avec un chemin qui finit pareil", () => {
    // `stop monapp` ne doit pas viser `/srv/autre/monapp` par son suffixe : un
    // chemin se donne en entier ou pas du tout.
    const r = resolveProjectTarget(path.join("autre", "monapp"), table);
    assert.strictEqual(r.ok, false);
  });
});
