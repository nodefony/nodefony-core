#!/usr/bin/env node
/**
 * ticket-effort.mjs — confronte l'estimation d'un ticket à ce que le travail a
 * RÉELLEMENT pris, mesuré sur ses commits.
 *
 * Le problème qu'il ferme : le champ `Jours` est posé à la création et n'est
 * jamais confronté à rien. Mesuré sur les six derniers tickets fermés, il vaut
 * 4 à 10 fois le temps constaté — toujours dans le même sens. Ce n'est pas un
 * détail cosmétique : un ticket affiché « 3 j » se REPORTE, alors qu'il se
 * ferait dans la foulée, et le report fait repayer tout son contexte plus tard.
 *
 * C'est le même geste que pour le statut et l'ordre d'un ticket : **dériver au
 * lieu de déclarer**. Ce que personne n'a à penser à mettre à jour ne se périme
 * pas.
 *
 * ⚠️ **La fenêtre de commits est une BORNE BASSE, jamais une durée.** Elle ne
 * compte ni l'exploration qui précède le premier commit, ni les décisions, ni
 * les essais abandonnés — seulement l'intervalle entre le premier et le dernier
 * commit qui citent le ticket. Un ticket clos par un commit unique rend un
 * intervalle nul, ce qui ne veut pas dire qu'il n'a rien coûté : il est compté à
 * part, jamais moyenné avec les autres. Un instrument qui tairait ça
 * innocenterait l'estimation qu'il est censé juger.
 *
 * Usage :
 *   node scripts/ticket-effort.mjs              # tous les tickets fermés du dépôt
 *   node scripts/ticket-effort.mjs 41 56 55     # ceux-là seulement
 */
import { execFileSync } from "node:child_process";

const OWNER = "nodefony";
const REPO = "nodefony-core";
const HEURES_PAR_JOUR = 7; // une journée de travail, pas 24 h

const wanted = process.argv.slice(2).filter((a) => /^\d+$/.test(a));

const gh = (args) =>
  execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

/** Le champ `Jours` du tableau de bord, par numéro d'issue. */
function estimations() {
  const out = gh([
    "api",
    "graphql",
    "-f",
    `query={repository(owner:"${OWNER}",name:"${REPO}"){projectV2(number:2){items(first:100){nodes{
       content{... on Issue{number state}}
       jours:fieldValueByName(name:"Jours"){... on ProjectV2ItemFieldNumberValue{number}}
     }}}}}`,
  ]);
  const map = new Map();
  for (const n of JSON.parse(out).data.repository.projectV2.items.nodes) {
    // Une estimation à 0 n'en est pas une : c'est un champ jamais rempli, ou un
    // parapluie dont le travail vit chez ses enfants. La compter écraserait la
    // médiane vers zéro et innocenterait les estimations qu'on juge.
    if (n.content?.number != null && n.jours?.number > 0) {
      map.set(n.content.number, {
        jours: n.jours.number,
        ouvert: n.content.state === "OPEN",
      });
    }
  }
  return map;
}

/**
 * Fenêtre des commits qui citent `#N`, depuis la création du ticket.
 *
 * Deux bornes, et les deux sont nécessaires :
 *  - le motif exige que le numéro ne soit pas suivi d'un chiffre — sans ça, `#4`
 *    ramasserait `#41`, `#42` et `#49`, et l'on mesurerait le travail des autres ;
 *  - la recherche s'arrête à la date de CRÉATION du ticket — un commit ne peut
 *    pas citer une issue qui n'existe pas encore, et l'historique d'avant le
 *    pilotage par tickets emploie `#1`…`#9` pour tout autre chose (numéros de
 *    session, de lot). Sans cette borne, les petits numéros mesurent du bruit.
 */
function fenetre(n, depuis) {
  const args = ["log", "-E", `--grep=#${n}([^0-9]|$)`, "--format=%cI"];
  if (depuis) args.push(`--since=${depuis}`);
  const out = execFileSync("git", args, { encoding: "utf8" }).trim();
  if (!out) return null;
  const dates = out.split("\n").map((d) => new Date(d));
  const debut = dates[dates.length - 1];
  const fin = dates[0];
  return { commits: dates.length, minutes: (fin - debut) / 60000, debut, fin };
}

const estim = estimations();
const tickets = wanted.length
  ? wanted.map((n) =>
      JSON.parse(
        gh(["issue", "view", String(n), "--json", "number,title,createdAt"]),
      ),
    )
  : JSON.parse(
      gh([
        "issue",
        "list",
        "--state",
        "closed",
        "--limit",
        "100",
        "--json",
        "number,title,createdAt",
      ]),
    );

const lignes = [];
const ratios = [];
let sansMesure = 0;
let ponctuels = 0;

for (const t of tickets) {
  const j = estim.get(t.number)?.jours;
  const f = fenetre(t.number, t.createdAt);
  if (j == null || !f) {
    sansMesure++;
    continue;
  }
  const estimeMin = j * HEURES_PAR_JOUR * 60;
  if (f.commits < 2 || f.minutes === 0) {
    ponctuels++;
    lignes.push([t.number, j, "commit unique", "—"]);
    continue;
  }
  const ratio = estimeMin / f.minutes;
  ratios.push(ratio);
  lignes.push([
    t.number,
    j,
    f.minutes < 90
      ? `${Math.round(f.minutes)} min (${f.commits} commits)`
      : `${(f.minutes / 60).toFixed(1)} h (${f.commits} commits)`,
    `×${ratio.toFixed(1)}`,
  ]);
}

if (!lignes.length) {
  console.log(
    "Aucun ticket fermé n'a d'estimation ET de commits qui le citent.",
  );
  process.exit(0);
}

console.log(
  "ticket   estimé      mesuré (borne basse)          estimé / mesuré",
);
for (const [n, j, m, r] of lignes.sort((a, b) => b[0] - a[0])) {
  console.log(
    `#${String(n).padEnd(6)} ${String(j + " j").padEnd(11)} ${m.padEnd(29)} ${r}`,
  );
}

if (ratios.length) {
  // Médiane, y compris sur un effectif PAIR — prendre l'élément du dessus
  // arrondirait systématiquement en faveur de l'estimation qu'on juge.
  const tri = [...ratios].sort((a, b) => a - b);
  const mid = tri.length / 2;
  const median =
    tri.length % 2 ? tri[Math.floor(mid)] : (tri[mid - 1] + tri[mid]) / 2;
  console.log(
    `\nBiais MÉDIAN sur ${ratios.length} tickets mesurables : l'estimation vaut ×${median.toFixed(1)} le constaté.`,
  );
  // Le reste-à-faire ne somme QUE les tickets encore ouverts : y ajouter les
  // fermés gonflerait le total de tout ce qui est déjà livré.
  const restant = [...estim.values()].reduce(
    (s, e) => s + (e.ouvert ? e.jours : 0),
    0,
  );
  console.log(
    `Reste-à-faire affiché : ${restant.toFixed(1)} j — au biais constaté, de l'ordre de ${(restant / median).toFixed(1)} j.`,
  );
}
console.log(
  `\nCe que ce chiffre NE dit PAS : la fenêtre de commits ignore l'exploration, les décisions\n` +
    `et les essais abandonnés. C'est une borne basse — le biais réel est plus faible que celui-ci.`,
);
if (ponctuels)
  console.log(
    `${ponctuels} tickets clos par un commit unique — intervalle nul, écartés du calcul.`,
  );
if (sansMesure)
  console.log(
    `${sansMesure} tickets sans estimation au tableau ou sans commit les citant — écartés.`,
  );
