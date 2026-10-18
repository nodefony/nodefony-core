#!/usr/bin/env node
// Éprouve `tool-usage.mjs` sur un transcript FORGÉ : chaque forme de lecture de
// code doit être comptée dans sa case, la relecture d'une sortie doit valoir sa
// taille × les tours qui la suivent, et l'alerte ne doit crier que sur ce que la
// règle 6 du hook refuserait — une tranche courte est permise.
//
// `@usage` node .claude/skills/nodefony-session/scripts/tool-usage.selftest.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyseTranscript, readingLine } from "./tool-usage.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-usage-"));
let echecs = 0;
const check = (ok, pourquoi, detail) => {
  if (!ok) echecs++;
  console.log(`${ok ? "✓" : "✗"} ${pourquoi}${ok ? "" : `\n    ${detail}`}`);
};
const tour = (id, uses) => ({
  type: "assistant",
  message: {
    id,
    content: uses.map(([tid, name, input]) => ({
      type: "tool_use",
      id: tid,
      name,
      input,
    })),
  },
});
const resultat = (tid, text) => ({
  type: "user",
  message: {
    content: [{ type: "tool_result", tool_use_id: tid, content: text }],
  },
});
const ecrire = (lignes) => {
  const f = path.join(dir, `${Math.random()}.jsonl`);
  fs.writeFileSync(f, lignes.map((l) => JSON.stringify(l)).join("\n"));
  return f;
};
try {
  const a = analyseTranscript(
    ecrire([
      tour("m1", [
        ["t1", "Bash", { command: "sed -n '1,200p' src/a.ts" }],
        ["t2", "Bash", { command: "sed -n 10,30p src/b.ts" }],
        ["t3", "Bash", { command: "node x/show-symbol.mjs 'a.ts#A.b'" }],
        ["t4", "Read", { file_path: "/r/src/c.ts" }],
        ["t5", "Read", { file_path: "/r/src/c.ts", limit: 40 }],
        ["t6", "Bash", { command: "cat src/d.ts" }],
        ["t7", "Bash", { command: "cat src/d.ts | grep x" }],
      ]),
      resultat("t1", "x".repeat(400)),
      resultat("t6", "REFUS — lire du code par tranche (fichier entier)"),
      tour("m2", []),
      tour("m2", []), // même réponse répétée : un seul tour
      tour("m3", []),
    ]),
  );
  const r = a.reading;
  check(
    r.slices === 2 && r.sliceLines === 221 && r.bigSlices === 1,
    "chaque tranche sed est comptée, et seule celle de plus de 60 lignes est refusable",
    JSON.stringify(r),
  );
  check(
    r.showSymbol === 1 &&
      r.rawCats === 1 &&
      r.unboundedReads === 1 &&
      r.refused === 1,
    "show-symbol, cat brut (pas le cat filtré), Read sans borne et refus du hook",
    JSON.stringify(r),
  );
  const t1 = a.results.find((x) => x.family === "sed");
  check(
    a.turns === 3 && t1?.tokens === 100 && t1.reread === 200,
    "une sortie se relit à chaque tour suivant (100 tokens × 2 tours), réponses répétées dédoublonnées",
    JSON.stringify({ turns: a.turns, t1 }),
  );
  check(
    readingLine(a).includes("(221 l., dont 1 > 60 l.)") &&
      readingLine(a).includes("1 cat brut") &&
      readingLine(a).includes("⚠️"),
    "la ligne nomme chaque compte ; 1 show-symbol contre 2 lectures refusables : alerte",
    readingLine(a),
  );
  const b = analyseTranscript(
    ecrire([
      tour("m1", [
        ["t1", "Bash", { command: "sed -n '1,200p' src/a.ts" }],
        ["t2", "Bash", { command: "sed -n 5,20p src/a.ts" }],
        ["t3", "Bash", { command: "sed -n 5,20p src/a.ts" }],
      ]),
    ]),
  );
  check(
    readingLine(b).includes("⚠️"),
    "l'alerte crie quand la grosse tranche l'emporte",
    readingLine(b),
  );
  const c = analyseTranscript(
    ecrire([
      tour("m1", [
        ["t1", "Bash", { command: "sed -n 5,20p src/a.ts" }],
        ["t2", "Bash", { command: "sed -n 5,40p src/b.ts" }],
      ]),
    ]),
  );
  check(
    !readingLine(c).includes("⚠️"),
    "des tranches COURTES seules ne font pas crier l'alerte",
    readingLine(c),
  );
  console.log(echecs ? `\n${echecs} cas en échec` : "\n6 cas conformes");
  process.exitCode = echecs ? 1 : 0;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
