#!/usr/bin/env node
/**
 * compare-exports.mjs — gate #2 de la migration rolldown (sentinelle).
 *
 * Compare la SURFACE EXPORTÉE de deux builds par import réel, chacun dans un
 * process Node ISOLÉ (piège gravé : certains packages ont des registres globaux —
 * `EntityRegistry` — qui explosent si l'on charge deux builds du même paquet dans
 * un seul process).
 *
 * Usage :
 *   node .claude/skills/nodefony-release/scripts/compare-exports.mjs <entryA.js> <entryB.js>   # diff A vs B
 *   node .claude/skills/nodefony-release/scripts/compare-exports.mjs <entry.js>                # liste triée (baseline)
 *
 * Sortie : exit 0 si identiques (ou mode liste), exit 1 + diff sinon.
 */
import process from "node:process";
import { listRuntimeExports } from "../../../../scripts/release/api-diff-core.mjs";

// Lecture des exports : UNE implémentation, celle du produit (scripts/release/api-diff-core.mjs).
function exportsOf(entry) {
  const keys = listRuntimeExports(entry);
  if (!Array.isArray(keys)) {
    console.error(keys.error);
    process.exit(2);
  }
  return keys;
}

const [a, b] = process.argv.slice(2);
if (!a) {
  console.error("Usage: compare-exports.mjs <entryA.js> [entryB.js]");
  process.exit(2);
}

const keysA = exportsOf(a);
if (!b) {
  console.log(keysA.join("\n"));
  process.exit(0);
}

const keysB = exportsOf(b);
const setA = new Set(keysA);
const setB = new Set(keysB);
const missing = keysA.filter((k) => !setB.has(k));
const extra = keysB.filter((k) => !setA.has(k));

if (missing.length === 0 && extra.length === 0) {
  console.log(`IDENTIQUE — ${keysA.length} exports`);
  process.exit(0);
}
if (missing.length)
  console.error(`MANQUANTS dans B (${missing.length}) : ${missing.join(", ")}`);
if (extra.length)
  console.error(`EN TROP dans B (${extra.length}) : ${extra.join(", ")}`);
process.exit(1);
