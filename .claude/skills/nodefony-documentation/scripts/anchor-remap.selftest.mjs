#!/usr/bin/env node
// Éprouve `anchor-remap.mjs` sur un dépôt JETABLE : une ancre juste à la base
// doit glisser d'EXACTEMENT ce que le code a gagné avant elle — ni plus, ni
// deux fois.
//
// Les cas vécus :
//  - fichier DÉPLACÉ (`git mv`) : `git diff BASE -- <nouveau>` le voyait NEUF
//    et décalait chaque ancre de la longueur du fichier (+130 à +570 lignes sur
//    `mcp.md` au déménagement du moteur MCP) ;
//  - ancre RECALÉE et commitée depuis la base : redécalée au passage suivant
//    (`servers.md`, 1876 → 1907) — la garde « page non commitée » ne la voit pas.
//
// `@usage` node .claude/skills/nodefony-documentation/scripts/anchor-remap.selftest.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REMAP = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "anchor-remap.mjs",
);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-remap-selftest-"));
let failures = 0;
const expect = (label, actual, wanted) => {
  if (actual === wanted) return;
  failures++;
  console.error(`✖ ${label} : attendu ${wanted}, obtenu ${actual}`);
};
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const lines = (n, tag) =>
  Array.from({ length: n }, (_, i) => `// ${tag} ${i + 1}`).join("\n") + "\n";

try {
  git("init", "-q");
  git("config", "user.email", "selftest@nodefony.invalid");
  git("config", "user.name", "selftest");
  git("config", "commit.gpgsign", "false");

  // ── Base : deux fichiers, une page qui les cite JUSTE.
  write("src/a.ts", lines(10, "a"));
  write("old/moved.ts", lines(40, "moved"));
  write("doc.md", "`a.ts:5`\n`moved.ts:5`\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");

  // ── Après : du code gagné AVANT les ancres, un déménagement, un fichier neuf,
  // et une ancre écrite (déjà juste) après la base.
  write("src/a.ts", "// +1\n// +2\n" + lines(10, "a"));
  fs.mkdirSync(path.join(root, "new"), { recursive: true });
  git("mv", "old/moved.ts", "new/moved.ts");
  write("new/moved.ts", "// +1\n// +2\n// +3\n" + lines(40, "moved"));
  write("new/born.ts", lines(10, "born"));
  write("doc.md", "`a.ts:5`\n`moved.ts:5`\n`born.ts:4`\n`a.ts:9`\n");
  git("add", "-A");
  git("commit", "-qm", "après");

  // Le rapport d'anchor-check (la RÉSOLUTION des ancres n'est pas l'objet ici).
  const report = [
    "✅ doc.md",
    "   [ANCHOR] l.1 a.ts:5 → src/a.ts",
    "   [ANCHOR] l.2 moved.ts:5 → new/moved.ts",
    "   [ANCHOR] l.3 born.ts:4 → new/born.ts",
    "   [ANCHOR] l.4 a.ts:9 → src/a.ts",
    "",
  ].join("\n");
  const run = spawnSync(
    process.execPath,
    [REMAP, root, "--base", base, "--apply"],
    { input: report, encoding: "utf8" },
  );
  expect("code de sortie", run.status, 0);

  const doc = fs.readFileSync(path.join(root, "doc.md"), "utf8").split("\n");
  expect("fichier modifié : glisse de ce qu'il a gagné", doc[0], "`a.ts:7`");
  expect(
    "🔴 fichier DÉPLACÉ : glisse de son diff, pas de sa longueur",
    doc[1],
    "`moved.ts:8`",
  );
  expect("fichier NÉ après la base : laissé", doc[2], "`born.ts:4`");
  expect(
    "🔴 ancre ÉCRITE après la base : jamais décalée deux fois",
    doc[3],
    "`a.ts:9`",
  );
} catch (error) {
  failures++;
  console.error(
    `✖ décor : ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\nanchor-remap selftest : ${failures} échec(s)`);
  process.exit(1);
}
console.log(
  "✓ anchor-remap selftest : 4 cas (modifié, déplacé, né, écrit après)",
);
