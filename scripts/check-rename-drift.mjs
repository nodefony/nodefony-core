#!/usr/bin/env node
/**
 * Confronte un renommage à son plan — la seule preuve qu'aucun symbole n'a
 * dérivé.
 *
 * Un typecheck vert ne dit rien : `export function state(state: X)` compile.
 * Ce contrôle relève les DÉCLARATIONS avant et après, apparie celles qui n'ont
 * pas bougé de place, et signale tout nom dont la transformation n'est pas
 * celle que le plan demandait.
 *
 * Usage :
 *   node scripts/check-rename-drift.mjs --plan tmp/plan.json [--base HEAD]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const argv = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const planPath = path.resolve(process.cwd(), readFlag("--plan", ""));
const base = readFlag("--base", "HEAD");
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));

/**
 * Les déclarations d'un source, et séparément ses raccourcis de propriété.
 *
 * Renommer une variable écrite `{ famille }` fait écrire à TypeScript
 * `{ famille: family }` : le raccourci devient une propriété, donc une
 * déclaration de plus. Compter les deux évite d'accuser un renommage correct.
 */
const declarations = (text, fileName) => {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const named = [];
  const shorthands = [];
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      if (
        parent &&
        ts.isShorthandPropertyAssignment(parent) &&
        parent.name === node
      ) {
        shorthands.push(node.text);
      } else if (parent && "name" in parent && parent.name === node) {
        named.push(node.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { named, shorthands };
};

const nameOfEntry = (entry) =>
  entry.lastIndexOf("@") === -1
    ? entry
    : entry.slice(0, entry.lastIndexOf("@"));

// Un renommage est GLOBAL : le symbole déclaré dans un fichier voit ses usages
// — et les propriétés d'objet qui le portent — changer partout ailleurs. Un
// contrôle qui ne regarderait que la table du fichier accuserait ces
// changements-là d'être hors plan.
const globalPlan = new Map();
for (const table of Object.values(plan)) {
  for (const [entry, newName] of Object.entries(table)) {
    const from = nameOfEntry(entry);
    const known = globalPlan.get(from);
    if (known !== undefined && known !== newName) {
      console.log(
        `✗ plan ambigu — « ${from} » visé à la fois par « ${known} » et « ${newName} »`,
      );
      process.exit(2);
    }
    globalPlan.set(from, newName);
  }
}

let drift = 0;
for (const [relFile, table] of Object.entries(plan)) {
  const before = execFileSync("git", ["show", `${base}:${relFile}`], {
    encoding: "utf8",
  });
  const after = fs.readFileSync(relFile, "utf8");

  /** Combien de DÉCLARATIONS portent chaque nom. */
  const tally = (text) => {
    const { named, shorthands } = declarations(text, relFile);
    const counts = new Map();
    const short = new Map();
    for (const name of named) counts.set(name, (counts.get(name) ?? 0) + 1);
    for (const name of shorthands) short.set(name, (short.get(name) ?? 0) + 1);
    return { counts, short };
  };
  const { counts: countsBefore, short: shortBefore } = tally(before);
  const { counts: countsAfter, short: shortAfter } = tally(after);

  const nameOf = nameOfEntry;
  /** Ce que le plan promet de faire gagner à chaque nom cible. */
  const promised = new Map();
  const asked = new Set(Object.keys(table).map(nameOf));
  for (const [from, newName] of globalPlan) {
    const moved = countsBefore.get(from) ?? 0;
    if (moved === 0) {
      // Un nom demandé POUR ce fichier et introuvable est une faute de plan ;
      // un nom venu d'un autre fichier du lot n'a rien à faire ici.
      if (asked.has(from)) {
        console.log(
          `✗ ${relFile} — « ${from} » : aucune déclaration de ce nom avant`,
        );
        drift += 1;
      }
      continue;
    }
    const left = countsAfter.get(from) ?? 0;
    if (left > 0) {
      console.log(
        `✗ ${relFile} — « ${from} » : ${left} déclaration(s) NON renommée(s)`,
      );
      drift += 1;
    }
    // Chaque raccourci devenu propriété ajoute une déclaration au nom d'ARRIVÉE.
    const expanded = (shortBefore.get(from) ?? 0) - (shortAfter.get(from) ?? 0);
    promised.set(
      newName,
      (promised.get(newName) ?? 0) + moved - left + expanded,
    );
  }

  for (const [target, gain] of promised) {
    const actual =
      (countsAfter.get(target) ?? 0) - (countsBefore.get(target) ?? 0);
    if (actual !== gain) {
      console.log(
        `✗ ${relFile} — « ${target} » : ${actual} déclaration(s) de plus, le plan en promettait ${gain}` +
          " — un autre symbole a reçu ce nom, ou l'a perdu",
      );
      drift += 1;
    }
  }

  // Un nom qui disparaît sans être une source du plan est un symbole écrasé.
  const sources = new Set(globalPlan.keys());
  const targets = new Set(globalPlan.values());
  for (const [name, n] of countsBefore) {
    const now = countsAfter.get(name) ?? 0;
    if (now < n && !sources.has(name) && !targets.has(name)) {
      console.log(
        `✗ ${relFile} — « ${name} » : ${n} → ${now} déclaration(s), HORS PLAN`,
      );
      drift += 1;
    }
  }
}
console.log(
  drift === 0
    ? "✅ aucune dérive : chaque déclaration a suivi le plan"
    : `✗ ${drift} dérive(s)`,
);
process.exit(drift === 0 ? 0 : 1);
