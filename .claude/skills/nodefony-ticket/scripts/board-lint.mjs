#!/usr/bin/env node
/**
 * Confronte le TABLEAU DE BORD à ses propres règles de pilotage.
 *
 * POURQUOI CE SCRIPT EXISTE
 *
 * Les règles de priorisation — tout ticket a un jalon ou le label `backlog`, tout
 * item a un ordre, l'ordre encode les dépendances, un statut « en cours » est
 * adossé à un commit — vivent en PROSE dans le SKILL.md. Une règle écrite en prose
 * n'est appliquée que si quelqu'un y pense au bon moment, et personne n'y pense en
 * relisant un tableau de soixante lignes.
 *
 * La preuve tient en deux numéros : #82 puis #187, à deux mois d'écart, ont reçu un
 * jalon sans jamais être inscrits au tableau. Aucun compteur ne les voyait, et rien
 * ne l'a dit. Le dépôt contrôlait déjà les ancres contre le code (`ticket-verify`)
 * et les estimations contre le constaté (`ticket-effort`) — mais rien ne contrôlait
 * le pilotage lui-même.
 *
 * Ce que ce script N'EST PAS : un juge de la priorisation. Il ne dit jamais qu'un
 * ticket devrait passer avant un autre — c'est un arbitrage, il n'a pas de bonne
 * réponse mécanique. Il ne rend que les incohérences à verdict BINAIRE : ce qui est
 * absent, ce qui est en double, ce qui se contredit.
 *
 * Usage :
 *   node .claude/skills/nodefony-ticket/scripts/board-lint.mjs
 *   node .claude/skills/nodefony-ticket/scripts/board-lint.mjs --json
 *   node .claude/skills/nodefony-ticket/scripts/board-lint.mjs --milestone 10.0.0
 *
 * Code de sortie : 1 s'il reste une ERREUR, 0 sinon (un avertissement ne bloque pas).
 */
import { execFileSync } from "node:child_process";

const OWNER = "nodefony";
const REPO = "nodefony-core";
const PROJECT = 2;

/** Un commit de pilotage cite des tickets sans les faire avancer — cf #172. */
const PILOTAGE = /^(docs\(session\)|chore\(pilotage\)|docs\(claude\))/;

/** Au-delà, un statut « en cours » ne s'adosse plus à rien d'observable. */
const JOURS_EN_COURS = 14;

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

// ─────────────────────────────────────────── analyse (pure, donc éprouvable)

/**
 * Extrait les numéros de tickets d'un bloc « Dépend de » d'un corps d'issue.
 *
 * Le bloc est libre de forme (`**Dépend de** : #12, #13`, `Dépend de : rien`), et
 * c'est la seule expression des dépendances que le dépôt possède — le tableau de
 * bord n'a pas de champ pour elles.
 *
 * @param body - le corps brut de l'issue
 * @returns les numéros cités, sans doublon ; vide si le bloc dit « rien » ou manque
 */
export function parseDependsOn(body) {
  const ligne = ligneDependance(body);
  if (!ligne) return [];
  // « rien — mais à faire AVANT #175 » ne dépend de RIEN : le numéro qui suit
  // exprime la contrainte INVERSE, et le lire à l'endroit inverserait l'ordre.
  if (/^\**\s*rien\b/i.test(ligne)) return [];
  const nums = [...ligne.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
  return [...new Set(nums)];
}

/** La ligne « Dépend de », telle qu'elle est écrite — source des deux contraintes. */
function ligneDependance(body) {
  return body?.match(/\*{0,2}D[ée]pend de\*{0,2}\s*:?\s*(.+)/i)?.[1] ?? null;
}

/**
 * Lit la contrainte INVERSE — « à faire AVANT #175 » — que le tableau n'a aucun
 * champ pour exprimer, et qui est pourtant celle qui coûte le plus cher : un
 * renommage passé après une publication devient une rupture majeure.
 *
 * @param body - le corps brut de l'issue
 * @returns les numéros devant lesquels ce ticket doit passer
 */
export function parseBefore(body) {
  const ligne = ligneDependance(body);
  if (!ligne) return [];
  const apres = ligne.match(/\bavant\b(.*)$/i);
  if (!apres) return [];
  return [
    ...new Set([...apres[1].matchAll(/#(\d+)/g)].map((m) => Number(m[1]))),
  ];
}

/**
 * Confronte l'état du tableau de bord aux règles de pilotage du dépôt.
 *
 * Chaque contrôle a un verdict binaire et une preuve : aucun n'exige de jugement,
 * c'est ce qui autorise un automate à les rendre tous.
 *
 * @param entree.items - items du tableau, `{ n, title, milestone, ordre, jours, prio, status, parent }`
 * @param entree.issues - issues OUVERTES du dépôt, `{ n, title, milestone, labels, dependsOn }`
 * @param entree.commits - par numéro de ticket, les commits qui le citent `{ sha, date, subject }`
 * @param entree.now - instant de référence, injecté pour que le test ne dépende pas du calendrier
 * @returns les constats, erreurs d'abord, chacun avec son code, son ticket et son geste
 */
export function lintBoard({ items, issues, commits = {}, now = new Date() }) {
  const findings = [];
  const parItem = new Map(items.map((i) => [i.n, i]));
  const add = (severity, code, n, message, unlock) =>
    findings.push({ severity, code, n, message, unlock });

  // E1 — un jalon promet une date ; hors tableau, personne ne voit la promesse.
  for (const issue of issues) {
    if (!issue.milestone) continue;
    if (parItem.has(issue.n)) continue;
    add(
      "erreur",
      "HORS-TABLEAU",
      issue.n,
      `jalon « ${issue.milestone} » mais absent du tableau de bord — invisible de tout compteur d'avancement`,
      `gh project item-add ${PROJECT} --owner ${OWNER} --url https://github.com/${OWNER}/${REPO}/issues/${issue.n}`,
    );
  }

  // E2 — ni jalon ni backlog : le ticket n'est ni promis ni assumé comme sans date.
  for (const issue of issues) {
    if (issue.milestone) continue;
    if (issue.labels?.includes("backlog")) continue;
    add(
      "erreur",
      "NI-JALON-NI-BACKLOG",
      issue.n,
      "sans jalon et sans label « backlog » — ne promet rien et n'assume pas de ne rien promettre",
      `gh issue edit ${issue.n} --add-label backlog`,
    );
  }

  // E3 — un item sans ordre tombe en fin de tri, et n'est jamais proposé.
  for (const item of items) {
    if (typeof item.ordre === "number") continue;
    add(
      "erreur",
      "SANS-ORDRE",
      item.n,
      "aucun ordre au tableau — tombe en fin de tri, donc n'est jamais proposé",
      "poser le champ Ordre (il encode les dépendances, pas une préférence)",
    );
  }

  // E4 — deux items au même rang : l'ordre a cessé de trancher.
  const parOrdre = new Map();
  for (const item of items) {
    if (typeof item.ordre !== "number") continue;
    const cle = `${item.milestone ?? "-"}@${item.ordre}`;
    parOrdre.set(cle, [...(parOrdre.get(cle) ?? []), item.n]);
  }
  for (const [cle, ns] of parOrdre) {
    if (ns.length < 2) continue;
    const [ms, ordre] = cle.split("@");
    add(
      "erreur",
      "ORDRE-DOUBLON",
      ns[0],
      `ordre ${ordre} partagé avec ${ns
        .slice(1)
        .map((n) => `#${n}`)
        .join(", ")} dans « ${ms} » — l'ordre ne tranche plus`,
      "donner un rang distinct à chacun",
    );
  }

  // E5 — une dépendance placée APRÈS son dépendant est un ordre qui ment.
  for (const issue of issues) {
    const moi = parItem.get(issue.n);
    if (!moi || typeof moi.ordre !== "number") continue;
    for (const dep of issue.dependsOn ?? []) {
      const amont = parItem.get(dep);
      if (!amont || typeof amont.ordre !== "number") continue;
      if (amont.ordre <= moi.ordre) continue;
      add(
        "erreur",
        "DEPENDANCE-INVERSEE",
        issue.n,
        `dépend de #${dep}, placé APRÈS lui (ordre ${moi.ordre} < ${amont.ordre}) — le tri proposera le travail avant son socle`,
        `remonter #${dep} avant l'ordre ${moi.ordre}`,
      );
    }
  }

  // E5bis — une contrainte « à faire AVANT #N » se vérifie comme une dépendance.
  for (const issue of issues) {
    const moi = parItem.get(issue.n);
    if (!moi || typeof moi.ordre !== "number") continue;
    for (const cible of issue.before ?? []) {
      const aval = parItem.get(cible);
      if (!aval || typeof aval.ordre !== "number") continue;
      if (moi.ordre < aval.ordre) continue;
      add(
        "erreur",
        "CONTRAINTE-INVERSEE",
        issue.n,
        `doit passer AVANT #${cible}, mais est rangé après (ordre ${moi.ordre} > ${aval.ordre})`,
        `remonter #${issue.n} avant l'ordre ${aval.ordre}`,
      );
    }
  }

  // E6 — un statut monte tout seul et ne redescend jamais : il ment par défaut.
  const limite = now.getTime() - JOURS_EN_COURS * 86400000;
  for (const item of items) {
    if (item.status !== "In Progress") continue;
    const vivants = (commits[item.n] ?? []).filter(
      (c) => !PILOTAGE.test(c.subject) && Date.parse(c.date) >= limite,
    );
    if (vivants.length) continue;
    add(
      "erreur",
      "STATUT-MENTEUR",
      item.n,
      `« En cours » sans aucun commit de travail depuis ${JOURS_EN_COURS} jours — un statut qui ment est pire qu'un statut absent`,
      "le remettre à Todo",
    );
  }

  // A1/A2 — un item sans estimation ni priorité ne se trie pas, donc ne se prend pas.
  for (const item of items) {
    if (typeof item.jours !== "number")
      add(
        "avertissement",
        "SANS-JOURS",
        item.n,
        "aucune estimation — ne peut être ni trié ni arbitré",
        "poser le champ Jours",
      );
    if (!item.prio)
      add(
        "avertissement",
        "SANS-PRIORITE",
        item.n,
        "aucune priorité",
        "poser le champ Priorité",
      );
  }

  // A3 — le parent porte la SOMME de ses enfants ; sinon on compte deux fois.
  const enfants = new Map();
  for (const item of items) {
    if (!item.parent) continue;
    enfants.set(item.parent, [...(enfants.get(item.parent) ?? []), item]);
  }
  for (const [parent, fratrie] of enfants) {
    const p = parItem.get(parent);
    if (!p || typeof p.jours !== "number") continue;
    const somme = fratrie.reduce((t, e) => t + (e.jours ?? 0), 0);
    if (Math.abs(somme - p.jours) < 0.01) continue;
    add(
      "avertissement",
      "PARENT-SOMME",
      parent,
      `Jours = ${p.jours} alors que ses ${fratrie.length} enfants OUVERTS totalisent ${somme} — le parent ne porte aucun travail propre`,
      `poser Jours = ${somme} (ou vérifier les enfants fermés)`,
    );
  }

  // A4 — un P0 rangé derrière un P2 : la priorité et l'ordre se contredisent.
  const rang = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const niveau = (p) => rang[String(p ?? "").slice(0, 2)] ?? 9;
  const tries = items
    .filter((i) => typeof i.ordre === "number" && i.prio)
    .sort((a, b) => a.ordre - b.ordre);
  for (let i = 0; i < tries.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (niveau(tries[i].prio) !== 0) continue;
      // Un P0 précédé de ses PRÉREQUIS est normal — l'ordre encode les dépendances.
      // Seule « fin de cycle » avant « bloque le reste » est une contradiction franche.
      if (niveau(tries[j].prio) !== 3) continue;
      add(
        "avertissement",
        "PRIORITE-ORDRE",
        tries[i].n,
        `P0 placé après #${tries[j].n} (${tries[j].prio}) — « fin de cycle » avant « bloque le reste »`,
        "trancher : soit l'un remonte, soit l'autre change de priorité",
      );
      break;
    }
  }

  const poids = { erreur: 0, avertissement: 1 };
  return findings.sort(
    (a, b) => poids[a.severity] - poids[b.severity] || a.n - b.n,
  );
}

// ─────────────────────────────────────────── lecture du terrain

const QUERY_ITEMS = `
query($endCursor:String){
  organization(login:"${OWNER}"){
    projectV2(number:${PROJECT}){
      items(first:100, after:$endCursor){
        totalCount
        pageInfo{ hasNextPage endCursor }
        nodes{
          content{ ... on Issue { number title state milestone{title} parent{number} } }
          fieldValues(first:20){ nodes{
            ... on ProjectV2ItemFieldNumberValue{ number field{... on ProjectV2FieldCommon{name}} }
            ... on ProjectV2ItemFieldSingleSelectValue{ name field{... on ProjectV2FieldCommon{name}} } } }
        }
      }
    }
  }
}`;

function readItems() {
  // `--slurp` agrège les pages en UN tableau : sans lui, `--paginate` concatène des
  // objets JSON indentés que ni `split("\n")` ni `JSON.parse` ne savent découper.
  const brut = sh("gh", [
    "api",
    "graphql",
    "--paginate",
    "--slurp",
    "-f",
    `query=${QUERY_ITEMS}`,
  ]);
  const pages = JSON.parse(brut);
  const attendu = pages[0].data.organization.projectV2.items.totalCount;
  const nodes = pages.flatMap((p) => p.data.organization.projectV2.items.nodes);
  if (nodes.length !== attendu)
    throw new Error(
      `lecture TRONQUÉE : ${nodes.length} items reçus pour ${attendu} annoncés — ` +
        "ne pas décider sur cet inventaire",
    );
  return nodes
    .filter((node) => node.content?.number && node.content.state === "OPEN")
    .map((node) => {
      const f = Object.fromEntries(
        node.fieldValues.nodes
          .filter((v) => v.field?.name)
          .map((v) => [v.field.name, v.number ?? v.name]),
      );
      return {
        n: node.content.number,
        title: node.content.title,
        milestone: node.content.milestone?.title ?? null,
        parent: node.content.parent?.number ?? null,
        ordre: typeof f.Ordre === "number" ? f.Ordre : undefined,
        jours: typeof f.Jours === "number" ? f.Jours : undefined,
        prio: f["Priorité"] ?? null,
        status: f.Status ?? null,
      };
    });
}

function readIssues() {
  const brut = sh("gh", [
    "issue",
    "list",
    "--state",
    "open",
    "--limit",
    "400",
    "--json",
    "number,title,milestone,labels,body",
  ]);
  return JSON.parse(brut).map((i) => ({
    n: i.number,
    title: i.title,
    milestone: i.milestone?.title ?? null,
    labels: i.labels.map((l) => l.name),
    dependsOn: parseDependsOn(i.body),
    before: parseBefore(i.body),
  }));
}

/** Les commits qui citent chaque ticket — la seule preuve qu'un travail avance. */
function readCommits(numeros) {
  const out = {};
  for (const n of numeros) {
    const brut = sh("git", [
      "log",
      "-8",
      `--grep=#${n}\\b`,
      "-E",
      "--format=%H%x09%cI%x09%s",
    ]);
    out[n] = brut
      ? brut.split("\n").map((l) => {
          const [sha, date, ...s] = l.split("\t");
          return { sha, date, subject: s.join("\t") };
        })
      : [];
  }
  return out;
}

// ─────────────────────────────────────────── rendu

function render(findings, total) {
  const erreurs = findings.filter((f) => f.severity === "erreur");
  const avis = findings.filter((f) => f.severity === "avertissement");
  const lignes = [];
  lignes.push(`Tableau de bord — ${total} items ouverts contrôlés`);
  lignes.push("");
  for (const [titre, lot] of [
    ["❌ ERREURS — le pilotage est faux tant qu'elles restent", erreurs],
    ["⚠️  AVERTISSEMENTS — le pilotage est incomplet", avis],
  ]) {
    if (!lot.length) continue;
    lignes.push(titre);
    for (const f of lot) {
      lignes.push(`   #${f.n}  [${f.code}]  ${f.message}`);
      if (f.unlock) lignes.push(`         → ${f.unlock}`);
    }
    lignes.push("");
  }
  if (!findings.length)
    lignes.push(
      "✅ aucune incohérence — jalons, ordres, statuts et dépendances se tiennent",
    );
  return lignes.join("\n");
}

// ─────────────────────────────────────────── point d'entrée

const estAppelDirect = process.argv[1]?.endsWith("board-lint.mjs");
if (estAppelDirect) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const msIdx = args.indexOf("--milestone");
  const filtre = msIdx >= 0 ? args[msIdx + 1] : null;

  let items = readItems();
  let issues = readIssues();
  if (filtre) {
    items = items.filter((i) => i.milestone === filtre);
    issues = issues.filter((i) => i.milestone === filtre);
  }
  const enCours = items
    .filter((i) => i.status === "In Progress")
    .map((i) => i.n);
  const findings = lintBoard({ items, issues, commits: readCommits(enCours) });

  if (json)
    console.log(JSON.stringify({ total: items.length, findings }, null, 2));
  else console.log(render(findings, items.length));

  process.exit(findings.some((f) => f.severity === "erreur") ? 1 : 0);
}
