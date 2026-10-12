/**
 * Auto-contrôle du juge « le jeton a-t-il quitté le source ? ».
 *
 * Un dépôt jouet par cas : le jeton retiré (référence), resté dans le
 * controller, déplacé dans `.env.example`, recopié dans la relecture, rangé
 * dans un `.env` que git ignore (conforme), et un dossier qui n'est pas un
 * dépôt. Chaque cas doit sortir sur SON code : un juge qui confondrait « rangé
 * dans le .env ignoré » et « toujours versionné » recalerait la bonne réponse.
 *
 * Usage : `node lib/gate-secret-retire.selftest.mjs`
 * Sorties : `0` toutes les causes distinguées · `1` au moins un écart.
 *
 * @module
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { JETON_EN_DUR } from "./enonces.mjs";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-secret-retire.mjs",
);

const dossiers = [];
const depot = (fichiers, { git = true } = {}) => {
  const d = mkdtempSync(path.join(os.tmpdir(), "nf-secret-retire-"));
  dossiers.push(d);
  for (const [nom, contenu] of Object.entries(fichiers)) {
    const f = path.join(d, ...nom.split("/"));
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, contenu);
  }
  if (git) spawnSync("git", ["init", "-q"], { cwd: d });
  return d;
};

const CTRL = "nodefony/controllers/InsightController.ts";
const SAIN = "export const token = config.exportToken;\n";
const FAUTIF = `const EXPORT_TOKEN = "${JETON_EN_DUR}";\n`;

const CAS = {
  conforme: [0, depot({ [CTRL]: SAIN })],
  rangeDansEnvIgnore: [
    0,
    depot({
      [CTRL]: SAIN,
      ".gitignore": ".env\n",
      ".env": `NF_EXPORT_TOKEN=${JETON_EN_DUR}\n`,
    }),
  ],
  resteDansLeController: [1, depot({ [CTRL]: FAUTIF })],
  copieDansEnvExample: [
    1,
    depot({
      [CTRL]: SAIN,
      ".env.example": `NF_EXPORT_TOKEN=${JETON_EN_DUR}\n`,
    }),
  ],
  citeDansLaRelecture: [
    1,
    depot({ [CTRL]: SAIN, "RELECTURE.md": `- ligne 3 : ${JETON_EN_DUR}\n` }),
  ],
  pasUnDepot: [4, depot({ [CTRL]: SAIN }, { git: false })],
};

let echecs = 0;
for (const [nom, [attendu, dossier]] of Object.entries(CAS)) {
  const r = spawnSync("node", [JUGE], { cwd: dossier, encoding: "utf8" });
  const ok = r.status === attendu;
  if (!ok) echecs++;
  const cause = (r.stderr || r.stdout).trim().split("\n").at(-1) ?? "";
  console.log(
    `${ok ? "✅" : "❌"} ${nom.padEnd(22)} attendu=${attendu} obtenu=${r.status}  ${cause.slice(0, 80)}`,
  );
}
for (const d of dossiers) rmSync(d, { recursive: true, force: true });

console.log(
  echecs
    ? `\n━━ ${echecs} écart(s) — le juge ne distingue PAS ce qu'il annonce`
    : `\n━━ toutes les causes distinguées, décor et agent séparés`,
);
process.exit(echecs ? 1 : 0);
