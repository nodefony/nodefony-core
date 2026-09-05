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
 *   node .claude/skills/nodefony-identifiers/scripts/check-rename-drift.mjs --plan tmp/plan.json [--base HEAD]
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
    // Un membre privé est un `PrivateIdentifier`, pas un `Identifier` : sans
    // lui, `#nom` n'a « aucune liaison » et toute dérive sur un membre privé
    // — sa PORTÉE comprise — passe inaperçue.
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
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
// Une entrée « nom@ligne » vise UNE déclaration : le même nom peut donc partir
// vers deux cibles (une variable locale et un paramètre homonymes). Seule une
// entrée SANS ligne engage TOUTES les déclarations du nom — c'est elle, et elle
// seule, qui promet que rien ne reste.
const globalPlan = [];
const totalRenames = new Map();
for (const [file, table] of Object.entries(plan)) {
  for (const [entry, newName] of Object.entries(table)) {
    const from = nameOfEntry(entry);
    const pinned = entry !== from;
    if (!pinned) {
      const known = totalRenames.get(from);
      if (known !== undefined && known !== newName) {
        console.log(
          `✗ plan ambigu — « ${from} » visé à la fois par « ${known} » et « ${newName} »`,
        );
        process.exit(2);
      }
      totalRenames.set(from, newName);
    }
    globalPlan.push({ from, to: newName, pinned, file });
  }
}

let drift = 0;
for (const [relFile, table] of Object.entries(plan)) {
  const before = execFileSync("git", ["show", `${base}:${relFile}`], {
    encoding: "utf8",
  });
  const after = fs.readFileSync(relFile, "utf8");

  /** Combien de DÉCLARATIONS portent chaque nom. */
  /**
   * Combien de liaisons portent chaque nom.
   *
   * Un raccourci de propriété (`{ famille }`) porte le nom comme une
   * déclaration : les compter ensemble rend le solde insensible au va-et-vient
   * entre les deux formes — TypeScript expanse le raccourci en renommant,
   * `oxlint --fix` le resimplifie ensuite.
   */
  const tally = (text) => {
    const { named, shorthands } = declarations(text, relFile);
    const counts = new Map();
    for (const name of [...named, ...shorthands]) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return counts;
  };
  const countsBefore = tally(before);
  const countsAfter = tally(after);

  const nameOf = nameOfEntry;
  /** Ce que le plan promet de faire gagner à chaque nom cible. */
  const promised = new Map();
  const asked = new Set(Object.keys(table).map(nameOf));
  const seen = new Set();
  for (const { from, to: newName, pinned, file } of globalPlan) {
    // Une entrée ciblée par sa ligne ne concerne QUE le fichier qui la porte.
    if (pinned && file !== relFile) continue;
    if (pinned) {
      // Une déclaration ciblée par sa ligne : elle retire un porteur au nom de
      // départ et en donne un au nom d'arrivée, sans rien promettre d'autre.
      promised.set(newName, (promised.get(newName) ?? 0) + 1);
      promised.set(from, (promised.get(from) ?? 0) - 1);
      continue;
    }
    if (seen.has(from)) continue;
    seen.add(from);
    const moved = countsBefore.get(from) ?? 0;
    if (moved === 0) {
      // Un nom demandé POUR ce fichier et introuvable est une faute de plan ;
      // un nom venu d'un autre fichier du lot n'a rien à faire ici.
      if (asked.has(from)) {
        console.log(
          `✗ ${relFile} — « ${from} » : aucune liaison de ce nom avant`,
        );
        drift += 1;
      }
      continue;
    }
    const left = countsAfter.get(from) ?? 0;
    if (left > 0) {
      console.log(
        `✗ ${relFile} — « ${from} » : ${left} liaison(s) NON renommée(s)`,
      );
      drift += 1;
    }
    promised.set(newName, (promised.get(newName) ?? 0) + moved - left);
  }

  for (const [target, gain] of promised) {
    const actual =
      (countsAfter.get(target) ?? 0) - (countsBefore.get(target) ?? 0);
    if (actual !== gain) {
      console.log(
        `✗ ${relFile} — « ${target} » : ${actual} liaison(s) de plus, le plan en promettait ${gain}` +
          " — un autre symbole a reçu ce nom, ou l'a perdu",
      );
      drift += 1;
    }
  }

  // Un nom qui disparaît sans être une source du plan est un symbole écrasé.
  const sources = new Set(globalPlan.map((e) => e.from));
  const targets = new Set(globalPlan.map((e) => e.to));
  for (const [name, n] of countsBefore) {
    const now = countsAfter.get(name) ?? 0;
    if (now < n && !sources.has(name) && !targets.has(name)) {
      console.log(
        `✗ ${relFile} — « ${name} » : ${n} → ${now} liaison(s), HORS PLAN`,
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
