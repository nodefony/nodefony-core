/**
 * Auto-contrôle de la garde des drapeaux — et de son ACCORD avec les bancs.
 *
 * Deux étages, et c'est le second qui porte la valeur.
 *
 * Le premier éprouve `garderDrapeaux` : sert-elle `--help`, refuse-t-elle
 * l'inconnu en 64, laisse-t-elle passer une valeur négative ou un chemin qui
 * suit un drapeau à valeur ?
 *
 * Le second confronte, pour chacun des trois bancs, les drapeaux qu'il LIT dans
 * son code à ceux que sa liste blanche DÉCLARE. C'est le contrôle qui manquait :
 * la garde écrite à la main a recalé `--setup-only` le jour de sa naissance —
 * un drapeau que le banc documentait en tête de fichier et traitait dans son
 * corps, mais que la liste ignorait. Le taper sortait en 64 ; personne ne l'a vu
 * pendant que le banc paraissait sain.
 *
 * Il n'exécute AUCUN banc : chacun est appelé avec un drapeau bidon EN PREMIER,
 * ce qui fait sortir la garde en 64 avant que rien ne soit monté, et le message
 * de refus nomme tout ce qu'elle n'a pas compris. Un drapeau lu mais non déclaré
 * apparaît alors dans cette liste. Zéro agent, zéro décor, une seconde.
 *
 * Usage : `node lib/argv.selftest.mjs`
 * Sorties : `0` accord complet · `1` un écart.
 *
 * @module
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.dirname(ICI);
const BIDON = "--zzz-drapeau-qui-n-existe-pas";

let echecs = 0;
const dire = (ok, quoi, detail = "") => {
  if (!ok) echecs++;
  console.log(`${ok ? "✅" : "❌"} ${quoi.padEnd(52)} ${detail}`);
};

const lancer = (fichier, args) =>
  spawnSync("node", [path.join(SCRIPTS, fichier), ...args], {
    encoding: "utf8",
  });

// ── étage 1 — le comportement de la garde ──────────────────────────────────
{
  const banc = "bench-discoverability.mjs";
  const aide = lancer(banc, ["--help"]);
  dire(
    aide.status === 0 && aide.stdout.includes("node bench-discoverability"),
    "--help imprime l'usage et sort en 0",
    `exit=${aide.status}`,
  );

  const refus = lancer(banc, [BIDON]);
  dire(
    refus.status === 64 && refus.stderr.includes(BIDON),
    "un drapeau inconnu sort en 64, et il est NOMMÉ",
    `exit=${refus.status}`,
  );

  // Ce que la garde ne doit PAS prendre pour un drapeau : ce qui SUIT un
  // drapeau à valeur. Un chemin `-quelque-chose` ou un nombre négatif y passe.
  const valeur = lancer(banc, ["--task", "-3", BIDON]);
  dire(
    valeur.status === 64 && !valeur.stderr.includes("-3,"),
    "une valeur négative n'est pas jugée comme un drapeau",
    (valeur.stderr.split("\n")[0] ?? "").slice(0, 46),
  );

  // Un drapeau peut être PARFAITEMENT déclaré et rester dangereux : `--depistage`
  // était connu de la liste blanche, documenté, traité — et sans `--analyze-only`
  // il déroulait le catalogue ENTIER avec de vrais agents avant de comparer le
  // rapport du run qu'il venait de payer. L'étage 2 ne pouvait pas le voir : il
  // confronte les drapeaux LUS aux drapeaux DÉCLARÉS, pas leurs COMBINAISONS.
  //
  // Le contrôle porte donc sur ce qui coûte : le refus tombe-t-il AVANT que quoi
  // que ce soit soit monté ? On compte les décors de part et d'autre — c'est le
  // critère observable, et le seul qui distingue « il a refusé » de « il a
  // refusé après avoir dépensé ».
  //
  // Ce lancement-ci est BORNÉ dans le temps, et c'est structurel : si la garde
  // saute, l'invocation ne refuse plus — elle monte un décor et déroule des
  // agents. Un auto-contrôle qui annonce « zéro agent, zéro décor, une seconde »
  // et qui dépenserait des heures le jour où il trouve le défaut qu'il cherche
  // serait sa propre panne. La borne mesurée : le refus tombe en moins d'une
  // seconde, le montage crée son répertoire dans la milliseconde qui suit.
  const RUN_ROOT = path.join(os.tmpdir(), "nodefony-devkit-bench");
  const lister = () =>
    fs.existsSync(RUN_ROOT) ? new Set(fs.readdirSync(RUN_ROOT)) : new Set();
  const avant = lister();
  const depistage = spawnSync(
    "node",
    [path.join(SCRIPTS, banc), "--depistage"],
    { encoding: "utf8", timeout: 8000, killSignal: "SIGKILL" },
  );
  dire(
    depistage.status === 78 &&
      (depistage.stderr ?? "").includes("--analyze-only"),
    "--depistage sans run sort en 78, et nomme --analyze-only",
    depistage.error
      ? `TUÉ après 8 s — il n'a pas refusé`
      : `exit=${depistage.status}`,
  );
  // Le critère qui distingue « il a refusé » de « il a refusé après avoir
  // dépensé » : un décor NEUF sous la racine des runs. Il n'est pas supprimé ici
  // — un processus orphelin peut encore y écrire, et l'effacer sous ses pieds
  // vaut un défaut de plus. Il est NOMMÉ, et `--purge` le reprend.
  const neufs = [...lister()].filter((d) => !avant.has(d));
  dire(
    neufs.length === 0,
    "--depistage sans run ne monte AUCUN décor",
    neufs.length
      ? `décor(s) NEUF(S) : ${neufs.join(", ")}`
      : `${avant.size} inchangé(s)`,
  );
}

// ── étage 2 — l'ACCORD entre ce que le banc lit et ce qu'il déclare ────────
/**
 * Les façons dont un banc lit SA propre ligne de commande.
 *
 * Volontairement limité à ces formes : un `--no-audit` passé à npm ou un
 * `--porcelain` passé à git ne concerne pas la ligne de commande du banc, et le
 * faire entrer ici rendrait le contrôle criard — un contrôle qui crie faux
 * apprend à passer outre.
 */
const LECTURES = [
  /\bargs\.includes\("(--[a-z-]+)"\)/g,
  /\bargv\.includes\("(--[a-z-]+)"\)/g,
  /\bprocess\.argv\.includes\("(--[a-z-]+)"\)/g,
  /\bargs\.indexOf\("(--[a-z-]+)"\)/g,
  /\bargv\.indexOf\("(--[a-z-]+)"\)/g,
  /\bprocess\.argv\.indexOf\("(--[a-z-]+)"\)/g,
  /\barg\("(--[a-z-]+)"\)/g,
  /\boption\("(--[a-z-]+)"/g,
  /\bvaleurDe\("(--[a-z-]+)"\)/g,
];

for (const banc of [
  "bench-discoverability.mjs",
  "bench-schema.mjs",
  "verify-generated.mjs",
  "verify-runtime.mjs",
  // Le lanceur du lot est lui aussi un script qu'on tape : il porte la même
  // garde, et le même accord se vérifie.
  "selftests.mjs",
]) {
  const src = fs.readFileSync(path.join(SCRIPTS, banc), "utf8");
  const lus = new Set();
  for (const re of LECTURES) {
    for (const m of src.matchAll(re)) lus.add(m[1]);
  }
  dire(
    lus.size > 0,
    `${banc} — des drapeaux ont été trouvés`,
    `${lus.size} lus`,
  );

  // Le bidon EN PREMIER : il ne peut alors suivre aucun drapeau à valeur, la
  // garde le refuse à coup sûr, et son message nomme tout ce qu'elle rejette.
  const res = lancer(banc, [BIDON, ...lus]);
  const refuses = (res.stderr.split("\n")[0] ?? "")
    .replace("Drapeau inconnu : ", "")
    .split(", ")
    .map((s) => s.trim())
    .filter((s) => s && s !== BIDON);
  dire(
    res.status === 64 && refuses.length === 0,
    `${banc} — tout drapeau LU est DÉCLARÉ`,
    refuses.length
      ? `non déclarés : ${refuses.join(", ")}`
      : `${lus.size} accordés`,
  );
}

console.log(
  echecs
    ? `\n━━ ${echecs} écart(s) — un script refuse un drapeau qu'il traite`
    : `\n━━ garde éprouvée, et chaque script s'accorde avec elle`,
);
process.exit(echecs ? 1 : 0);
