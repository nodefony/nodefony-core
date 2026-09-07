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
 *   node .claude/skills/nodefony-ticket/scripts/ticket-effort.mjs              # tous les tickets fermés du dépôt
 *   node .claude/skills/nodefony-ticket/scripts/ticket-effort.mjs 41 56 55     # ceux-là seulement
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
  // `items(first:N)` s'arrête à N SANS le dire, et le tableau dépasse 250 lignes :
  // une lecture non paginée écarterait silencieusement les tickets les plus
  // récents, c'est-à-dire ceux qui recalent le mieux. On pagine, et `--slurp`
  // agrège les pages en un tableau (sans lui, `--paginate` concatène des objets
  // JSON indentés qu'aucun `JSON.parse` unique ne découpe).
  const out = gh([
    "api",
    "graphql",
    "--paginate",
    "--slurp",
    "-f",
    `query=query($endCursor:String){repository(owner:"${OWNER}",name:"${REPO}"){projectV2(number:2){items(first:100,after:$endCursor){
       pageInfo{hasNextPage endCursor}
       nodes{
         content{... on Issue{number state}}
         jours:fieldValueByName(name:"Jours"){... on ProjectV2ItemFieldNumberValue{number}}
       }
     }}}}`,
  ]);
  const noeuds = JSON.parse(out).flatMap(
    (page) => page.data.repository.projectV2.items.nodes,
  );
  const map = new Map();
  for (const n of noeuds) {
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
  const brutes = out.split("\n");
  const dates = brutes.map((d) => new Date(d));
  const debut = dates[dates.length - 1];
  const fin = dates[0];
  // Le nombre de JOURS DISTINCTS qui ont vu du travail — la mesure la plus
  // robuste dont on dispose. Un intervalle de 39 h ne veut PAS dire 39 h de
  // travail : c'est deux séances à deux jours d'écart. Ici l'auteur travaille
  // par sessions, une séance ≈ une journée qui porte des commits.
  const seances = new Set(brutes.map((d) => d.slice(0, 10))).size;
  return {
    commits: dates.length,
    minutes: (fin - debut) / 60000,
    seances,
    debut,
    fin,
  };
}

/** Médiane d'une série — `null` si la série est vide. */
export function mediane(serie) {
  if (!serie.length) return null;
  const t = [...serie].sort((x, y) => x - y);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
}

/**
 * Regroupe les écarts par TRANCHE d'estimation.
 *
 * C'est la question qui décide vraiment : le biais est-il le même à 0,5 j qu'à
 * 3 j ? Un facteur global ne le dit pas — il moyenne des tickets qui n'ont rien
 * à voir. Corriger une estimation de trois jours avec le biais mesuré sur des
 * demi-journées, c'est se tromper deux fois.
 *
 * @param mesures - `{ jours, ratio }` par ticket mesurable
 * @returns une ligne par tranche : son compte et sa médiane
 */
export function parTranche(mesures) {
  const tranches = new Map();
  for (const m of mesures) {
    if (!tranches.has(m.jours)) tranches.set(m.jours, []);
    tranches.get(m.jours).push(m);
  }
  return [...tranches.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([jours, groupe]) => ({
      jours,
      n: groupe.length,
      seances: mediane(groupe.map((g) => g.seances)),
    }));
}

// Le corps ne s'exécute QUE si le script est LANCÉ. Sans cette garde, importer une
// de ses fonctions pures pour l'éprouver relance tout : les appels réseau, la
// lecture de git, l'affichage. Réutiliser du code d'un script, c'est le relancer.
if (process.argv[1] && process.argv[1].endsWith("ticket-effort.mjs")) {
  const estim = estimations();
  const tickets = wanted.length
    ? wanted.map((n) =>
        JSON.parse(
          gh([
            "issue",
            "view",
            String(n),
            "--json",
            "number,title,createdAt,closedAt",
          ]),
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
          "number,title,createdAt,closedAt",
        ]),
      );

  const lignes = [];
  const ratios = [];
  const mesures = [];
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
    // Un commit unique n'est PAS une absence de mesure : c'est une séance, et le
    // ticket a bel et bien coûté cette séance. L'écarter (ce que faisait la mesure
    // par intervalle, nulle par construction) retirait du calcul les tickets les
    // plus nets — et innocentait l'estimation qu'on juge.
    if (f.commits < 2) ponctuels++;
    // Le ratio se calcule sur les SÉANCES, pas sur l'intervalle : une fenêtre de
    // 39 h n'est pas 39 h de travail, c'est deux journées à deux jours d'écart.
    // Compter en séances rend comparables un ticket fait d'une traite et un
    // ticket repris le lendemain — ce que l'intervalle rendait incomparables, et
    // dans le mauvais sens (il faisait passer les tickets étalés pour SOUS-estimés).
    const ratio = j / f.seances;
    ratios.push(ratio);
    mesures.push({ jours: j, ratio, seances: f.seances });
    const delai = Math.round(
      (new Date(t.closedAt) - new Date(t.createdAt)) / 86400000,
    );
    lignes.push([
      t.number,
      j,
      `${f.seances} séance${f.seances > 1 ? "s" : ""} (${f.commits} commits)`,
      `×${ratio.toFixed(1)}`,
      Number.isFinite(delai) ? `${delai} j` : "—",
    ]);
  }

  if (!lignes.length) {
    console.log(
      "Aucun ticket fermé n'a d'estimation ET de commits qui le citent.",
    );
    process.exit(0);
  }

  console.log(
    "ticket   estimé      travail constaté              estimé / constaté   délai",
  );
  for (const [n, j, m, r, d] of lignes.sort((a, b) => b[0] - a[0])) {
    console.log(
      `#${String(n).padEnd(6)} ${String(j + " j").padEnd(11)} ${m.padEnd(29)} ${String(r).padEnd(19)} ${d}`,
    );
  }

  if (ratios.length) {
    // Médiane, y compris sur un effectif PAIR — prendre l'élément du dessus
    // arrondirait systématiquement en faveur de l'estimation qu'on juge.
    const seancesMed = mediane(mesures.map((m) => m.seances));
    console.log(
      `\nTravail MÉDIAN sur ${ratios.length} tickets fermés : ${seancesMed} séance${seancesMed > 1 ? "s" : ""} par ticket.`,
    );
    // Le biais n'est PAS le même selon la taille : un facteur global moyenne des
    // tickets qui n'ont rien à voir, et corriger une estimation de trois jours
    // avec le biais des demi-journées se trompe deux fois. Une tranche d'un seul
    // ticket est affichée mais signalée — elle ne conclut rien.
    const tranches = parTranche(mesures);
    if (tranches.length > 1) {
      console.log(
        "\nPar TAILLE ESTIMÉE — l'estimation prédit-elle seulement le travail ?",
      );
      for (const t of tranches) {
        const garde = t.n < 3 ? "   (effectif trop faible pour conclure)" : "";
        console.log(
          `  estimé ${String(t.jours + " j").padEnd(7)} ${String(t.n + " ticket" + (t.n > 1 ? "s" : "")).padEnd(12)} → ${t.seances} séance${t.seances > 1 ? "s" : ""} médiane${garde}`,
        );
      }
    }
    // Le reste-à-faire ne somme QUE les tickets encore ouverts : y ajouter les
    // fermés gonflerait le total de tout ce qui est déjà livré.
    const ouverts = [...estim.values()].filter((e) => e.ouvert);
    const restant = ouverts.reduce((s, e) => s + e.jours, 0);
    console.log(
      `\nReste-à-faire : ${ouverts.length} tickets ouverts, ${restant.toFixed(1)} j affichés.\n` +
        `À ${seancesMed} séance${seancesMed > 1 ? "s" : ""} par ticket, l'ordre de grandeur est ${(ouverts.length * seancesMed).toFixed(0)} séances —\n` +
        `c'est le NOMBRE de tickets qui le prédit, pas la somme de leurs jours.`,
    );
  }
  console.log(
    `\nCE QUE CES CHIFFRES DISENT, ET CE QU'ILS NE DISENT PAS :\n` +
      `  « travail constaté » = le nombre de JOURNÉES DISTINCTES qui portent des commits citant le\n` +
      `  ticket. C'est une borne basse : elle ignore l'exploration, les décisions et les essais\n` +
      `  abandonnés, et une journée qui a vu dix minutes de travail compte comme une journée.\n` +
      `  « délai » = ouverture → fermeture. Il ne mesure PAS l'effort : un délai long dit que le\n` +
      `  ticket a ATTENDU, pas qu'il a été difficile. Les deux colonnes se lisent ensemble —\n` +
      `  délai long + une séance = un ticket qui dormait ; délai court + cinq séances = un vrai gros.`,
  );
  if (ponctuels)
    console.log(
      `\n${ponctuels} tickets clos par un commit unique — comptés comme UNE séance, pas écartés.`,
    );
  if (sansMesure)
    console.log(
      `${sansMesure} tickets sans estimation au tableau ou sans commit les citant — écartés.`,
    );
}
