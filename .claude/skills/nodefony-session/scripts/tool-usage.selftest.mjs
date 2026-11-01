#!/usr/bin/env node
// Éprouve `tool-usage.mjs` sur un transcript FORGÉ : une tranche de code refusée
// par la garde est comptée comme refus, une tranche PASSÉE (résultat sans refus) est
// nommée comme trou de la garde, et la relecture d'une sortie vaut sa taille × les
// tours qui la suivent. La règle de tranche est celle de `code-slice.mjs`, lue telle quelle.
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
        ["t2", "Bash", { command: "sed -n 10,12p src/b.ts" }],
        ["t3", "Bash", { command: "node x/show-symbol.mjs 'a.ts#A.b'" }],
        ["t4", "Read", { file_path: "/r/src/c.ts" }],
        ["t5", "Read", { file_path: "/r/src/c.ts", offset: 10, limit: 40 }],
        ["t6", "Bash", { command: "cat src/d.ts" }],
        ["t7", "Bash", { command: "cat src/d.ts | grep x" }],
        ["t8", "Bash", { command: "sed -n 1,90p notes.md" }],
      ]),
      resultat("t1", "x".repeat(400)),
      resultat(
        "t2",
        "PreToolUse:Bash hook error: REFUS — lire du code par tranche",
      ),
      resultat(
        "t5",
        "PreToolUse:Read hook error: REFUS — lire du code par tranche",
      ),
      resultat(
        "t6",
        "PreToolUse:Bash hook error: REFUS — lire du code par tranche",
      ),
      resultat("t7", "l1"),
      resultat("t8", "y"),
      tour("m2", []),
      tour("m2", []), // même réponse répétée : un seul tour
      tour("m3", []),
    ]),
  );
  const r = a.reading;
  check(
    r.showSymbol === 1 && r.refused === 3,
    "show-symbol compté ; trois refus (tranche courte, Read borné, cat entier)",
    JSON.stringify(r),
  );
  check(
    r.passed.length === 1 && r.passed[0].startsWith("sed -n '1,200p' src/a.ts"),
    "seule la tranche de code SANS refus est un trou ; cat filtré, Read entier et Markdown n'en sont pas",
    JSON.stringify(r.passed),
  );
  const t1 = a.results.find((x) => x.family === "sed");
  check(
    a.turns === 3 && t1?.tokens === 100 && t1.reread === 200,
    "une sortie se relit à chaque tour suivant (100 tokens × 2 tours), réponses répétées dédoublonnées",
    JSON.stringify({ turns: a.turns, t1 }),
  );
  check(
    readingLine(a).includes("1 show-symbol · 3 tranche(s) refusée(s)") &&
      readingLine(a).includes("🚨 1 tranche(s) de code PASSÉE(S)") &&
      readingLine(a).includes("sed -n '1,200p' src/a.ts"),
    "la ligne nomme les comptes et CITE la tranche passée",
    readingLine(a),
  );
  const b = analyseTranscript(
    ecrire([
      tour("m1", [["t1", "Bash", { command: "sed -n 5,20p src/a.ts" }]]),
      resultat("t1", "REFUS — lire du code par tranche"),
    ]),
  );
  check(
    !readingLine(b).includes("🚨"),
    "des refus seuls : aucune alerte, la garde a fait son travail",
    readingLine(b),
  );
  console.log(echecs ? `\n${echecs} cas en échec` : "\n5 cas conformes");
  process.exitCode = echecs ? 1 : 0;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
