/**
 * Dépouille le transcript d'un agent — d'où qu'il vienne.
 *
 * Le banc sait déjà juger les runs qu'il LANCE. Ce qu'il ne savait pas faire,
 * c'est lire une session RÉELLE : un utilisateur qui essaie le framework avec
 * son propre agent laisse derrière lui le matériau le plus instructif qui
 * soit — et il était dépouillé à la main, au `jq`, une heure durant, une fois.
 *
 * Ce que cette commande rend, et pourquoi chaque bloc existe :
 *
 * - **Le dialecte**, reconnu au contenu. Affiché même quand il est évident :
 *   c'est lui qui conditionne tout le reste, et une reconnaissance peu franche
 *   est un avertissement, pas un détail.
 * - **Le relevé** — tours, durée, coût, appels MCP. Un tiret signifie « cet
 *   agent ne l'émet pas » ; jamais zéro, qui se comparerait à un autre run.
 * - **Les échecs** — tout geste dont le code de retour n'est pas nul. C'est la
 *   liste qu'on lit en premier : elle dit où l'agent a buté, donc où le
 *   produit l'a laissé sans réponse.
 * - **Le déroulé** (`--timeline`) — chaque commande avec sa sortie. C'est la
 *   seule vue qui montre ce qu'aucune sonde ne rend : un agent qui interroge
 *   le mauvais port pendant cinq minutes, ou qui se rabat sur du code à la
 *   main après une recherche bredouille.
 *
 * Usage :
 *   node analyse-transcript.mjs <fichier> [--timeline] [--echecs] [--outils]
 *                                         [--json] [--grep <motif>]
 *                                         [--large <n>] [--dialecte <nom>]
 *
 * Sorties : `0` dépouillé · `64` usage · `65` illisible ou dialecte inconnu.
 *
 * @module
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { garderDrapeaux } from "./lib/argv.mjs";
import {
  PAR_NOM,
  detecterDialecte,
  lireReleve,
  lireTimeline,
} from "./lib/transcript-dialectes.mjs";

const USAGE = `  analyse-transcript — dépouille le transcript d'un agent

  usage : node analyse-transcript.mjs <fichier.jsonl> [options]

  OÙ LES TROUVER ─────────────────────────────────────────────────────────────

  · claude   <runDir>/transcript.jsonl  (ou task-<n>.transcript.jsonl)
  · copilot  ~/.copilot/session-state/<id>/events.jsonl
  · vibe     ~/.vibe/logs/session/<id>/messages.jsonl
  · codex    la sortie de \`codex exec --json\`
  · gemini   la sortie de \`gemini -o stream-json\`

  OPTIONS ────────────────────────────────────────────────────────────────────

  --timeline          le déroulé complet : chaque commande et sa sortie
  --echecs            seulement les gestes dont le code de retour n'est pas nul
  --outils            la répartition des outils employés
  --grep <motif>      ne garder que les gestes dont l'argument correspond
  --large <n>         largeur des extraits de sortie (défaut : 220)
  --dialecte <nom>    forcer la grammaire au lieu de la reconnaître
  --json              tout rendre en JSON, pour rechaîner

  Le relevé affiche un tiret là où l'agent n'ÉMET pas la mesure — ce n'est
  jamais un zéro, qui se comparerait à tort au run d'un autre agent.`;

const args = process.argv.slice(2);
garderDrapeaux({
  args,
  connus: [
    "--timeline",
    "--echecs",
    "--outils",
    "--json",
    "--grep",
    "--large",
    "--dialecte",
  ],
  aValeur: ["--grep", "--large", "--dialecte"],
  usage: USAGE,
  avertissement: "Rien n'a été lu.",
});

const valeur = (nom, defaut = null) => {
  const i = args.indexOf(nom);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`${nom}=`));
  return eq ? eq.slice(nom.length + 1) : defaut;
};

const fichier = args.find(
  (a) =>
    !a.startsWith("-") &&
    a !== valeur("--grep") &&
    a !== valeur("--large") &&
    a !== valeur("--dialecte"),
);

if (!fichier || !existsSync(fichier)) {
  console.error(`Fichier introuvable : ${fichier ?? "(aucun)"}\n\n${USAGE}`);
  process.exit(64);
}

const LARGE = Number(valeur("--large", "220")) || 220;
const MOTIF = valeur("--grep");
const rx = MOTIF ? new RegExp(MOTIF, "iu") : null;
const JSON_OUT = args.includes("--json");

const texte = readFileSync(fichier, "utf8");
const octets = statSync(fichier).size;

const vu = valeur("--dialecte")
  ? { nom: valeur("--dialecte"), votes: {}, franc: true }
  : detecterDialecte(texte);

if (!vu || !PAR_NOM[vu.nom]) {
  console.error(
    `Grammaire non reconnue (${octets} octets lus).\n` +
      `Les six connues : ${Object.keys(PAR_NOM).join(", ")}.\n` +
      `Si c'est un agent de plus, sa grammaire s'ajoute dans ` +
      `lib/transcript-dialectes.mjs — et son échantillon dans le selftest.`,
  );
  process.exit(65);
}

const d = PAR_NOM[vu.nom];
const releve = lireReleve(texte, { dialecte: vu.nom });
const tl = lireTimeline(texte, { dialecte: vu.nom, garderParole: true });

/** Un nombre, ou un tiret quand l'agent ne l'émet pas. */
const ou = (v, unite = "") => (v == null ? "—" : `${v}${unite}`);
const duree = (ms) =>
  ms == null
    ? "—"
    : ms >= 60000
      ? `${(ms / 60000).toFixed(1)} min`
      : `${Math.round(ms / 1000)} s`;
const coupe = (s, n) => {
  const plat = String(s ?? "")
    .replace(/\s*\n\s*/gu, " ⏎ ")
    .trim();
  return plat.length > n ? `${plat.slice(0, n)}…` : plat;
};

const pas = rx ? tl.pas.filter((p) => rx.test(p.arg)) : tl.pas;
const echecs = tl.pas.filter(
  (p) => (p.exit != null && p.exit !== 0) || p.ok === false,
);

/** Répartition des outils — qui dit d'un coup d'œil comment l'agent travaille. */
const parOutil = new Map();
for (const p of tl.pas)
  parOutil.set(p.outil ?? "?", (parOutil.get(p.outil ?? "?") ?? 0) + 1);

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        fichier,
        octets,
        dialecte: vu.nom,
        reconnaissanceFranche: vu.franc,
        derouleDisponible: d.timeline,
        releve,
        outils: Object.fromEntries(parOutil),
        echecs: echecs.length,
        pas: pas.map((p) => ({ ...p, sortie: coupe(p.sortie, LARGE) })),
        paroles: tl.paroles.map((g) => ({
          nature: g.nature,
          texte: coupe(g.texte, LARGE),
        })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log(`\n╭─ ${fichier}`);
console.log(
  `│  ${(octets / 1024).toFixed(0)} Ko · grammaire « ${vu.nom} » (${d.cli})`,
);
if (!vu.franc)
  console.log(
    `│  ⚠️  reconnaissance PEU FRANCHE — votes : ${JSON.stringify(vu.votes)}\n` +
      `│      forcer avec --dialecte <nom> si le relevé paraît faux.`,
  );
if (d.timeline !== "complete")
  console.log(
    `│  ⚠️  déroulé « ${d.timeline} » pour cet agent : ce qui n'a pas été\n` +
      `│      observé n'est PAS deviné — les gestes manquants ne sont pas des absences.`,
  );
console.log("╰─");

console.log("\n  RELEVÉ ───────────────────────────────────────────────");
console.log(`  tours        ${ou(releve?.tours)}`);
console.log(`  durée        ${duree(releve?.dureeMs)}`);
console.log(
  `  coût         ${releve?.coutUsd == null ? "— (non émis)" : `${releve.coutUsd.toFixed(2)} $`}`,
);
console.log(`  appels MCP   ${ou(releve?.mcpCalls)}`);
console.log(
  `  gestes       ${tl.pas.length}${rx ? ` (${pas.length} retenus)` : ""}`,
);
console.log(`  échecs       ${echecs.length}`);

if (
  args.includes("--outils") ||
  (!args.includes("--timeline") && !args.includes("--echecs"))
) {
  console.log("\n  OUTILS ───────────────────────────────────────────────");
  for (const [nom, n] of [...parOutil].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(5)} × ${nom}`);
}

if (echecs.length > 0 && !args.includes("--timeline")) {
  console.log("\n  ÉCHECS ───────────────────────────────────────────────");
  for (const p of echecs) {
    console.log(
      `\n  ${p.t?.slice(11, 19) ?? `#${p.seq}`} [${p.outil}] ${coupe(p.arg, 140)}`,
    );
    console.log(`     exit ${ou(p.exit)} → ${coupe(p.sortie, LARGE)}`);
  }
}

if (args.includes("--timeline")) {
  console.log("\n  DÉROULÉ ──────────────────────────────────────────────");
  for (const p of pas) {
    const marque =
      p.exit != null && p.exit !== 0 ? "✗" : p.ok === false ? "✗" : " ";
    console.log(
      `\n${marque} ${p.t?.slice(11, 19) ?? `#${p.seq}`} [${p.outil}] ${coupe(p.arg, 160)}`,
    );
    console.log(`   → ${coupe(p.sortie, LARGE)}`);
  }
}

if (tl.paroles.length > 0) {
  const duUser = tl.paroles.filter((g) => g.nature === "user");
  if (duUser.length > 0) {
    console.log("\n  CE QUE LE USER A DIT ─────────────────────────────────");
    for (const g of duUser) console.log(`  » ${coupe(g.texte, 300)}`);
  }
}
console.log();
