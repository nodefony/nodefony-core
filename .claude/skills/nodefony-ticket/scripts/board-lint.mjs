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

import { isPilotageCommit } from "./commit-kind.mjs";

const OWNER = "nodefony";
const REPO = "nodefony-core";
const PROJECT = 2;
/** Le dépôt VITRINE : généré à chaque publication, jamais édité à la main. */
const VITRINE_REPO = "nodefony/nodefony";

/** Au-delà, un statut « en cours » ne s'adosse plus à rien d'observable. */
const JOURS_EN_COURS = 14;
// Tolérance du départ de frise, en jours. Assez large pour qu'un week-end ou deux
// jours d'avance ne crient pas ; assez serrée pour voir un décalage de dix jours.
const TOLERANCE_FRISE = 5;

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
export function lintBoard({
  items,
  issues,
  commits = {},
  vitrine = [],
  alertes = [],
  now = new Date(),
}) {
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

  // E2bis — un label qui PORTE LE NOM d'un jalon confond deux instruments : le
  // jalon promet une date, le label ne promet rien. Le double ne suit pas quand
  // on déplace le jalon, et il finit par le contredire — mesuré : quinze tickets
  // ouverts affichaient une version que leur jalon démentait.
  // Borne ASSUMÉE : les noms de jalons se dérivent des issues ouvertes, donc un
  // jalon que plus aucun ticket ouvert ne porte n'est pas vu. Ne pas l'injecter
  // en paramètre — la liste des jalons serait une seconde source à tenir.
  const jalons = new Set(issues.map((i) => i.milestone).filter(Boolean));
  for (const issue of issues) {
    for (const label of issue.labels ?? []) {
      if (!jalons.has(label)) continue;
      add(
        "erreur",
        "LABEL-DOUBLE-JALON",
        issue.n,
        `le label « ${label} » porte le nom d'un jalon — un jalon promet une DATE, un label groupe un LOT ; le double se périme dès qu'on déplace le jalon`,
        `gh issue edit ${issue.n} --remove-label "${label}"`,
      );
    }
  }

  // A — un ticket ouvert dans le dépôt VITRINE n'entre dans aucun compteur d'ici.
  // Ce dépôt est GÉNÉRÉ à chaque publication : on n'y travaille pas, donc tout
  // ticket qui y reste ouvert décrit un défaut du GABARIT, qui se corrige ici.
  // Vécu : #152 y a survécu onze jours à sa propre correction — poussée le jour
  // même, deux heures après son ouverture — sur le dépôt le plus visible de
  // l'organisation. Rien ne le regardait : ni jalon, ni ordre, ni empreinte.
  for (const t of vitrine) {
    add(
      "avertissement",
      "VITRINE-OUVERTE",
      t.n,
      `ticket ouvert dans ${VITRINE_REPO} — « ${t.title} » : ce dépôt est généré, le défaut se corrige ICI, et rien ne suit ses tickets`,
      `gh issue view ${t.n} --repo ${VITRINE_REPO}`,
    );
  }

  // B — une alerte d'analyse de code OUVERTE, là où l'on regarde déjà.
  //
  // #385 a instruit dix alertes et s'est fermé sur un critère chiffré — « le
  // compte d'alertes ouvertes rend 0 ». Il était vrai ce jour-là, et a cessé de
  // l'être sept jours plus tard : la même règle est remontée sur un site NOUVEAU,
  // né après la clôture. Le verdict avait été posé site par site, à la main —
  // donc tout code neuf rouvre une alerte, et rien ne le disait : le compte
  // n'était lu par AUCUN contrôle. Celle-là a été repérée à l'œil.
  //
  // Avertissement et non erreur : une alerte est un FAIT à instruire, pas une
  // faute de pilotage. Ce qui serait fautif, c'est de ne pas la voir.
  for (const a of alertes) {
    add(
      "avertissement",
      "ALERTE-CODE",
      null,
      `alerte ${a.n} — ${a.rule} à ${a.path}:${a.line} : à corriger, ou à écarter AVEC son motif`,
      `gh api repos/${OWNER}/${REPO}/code-scanning/alerts/${a.n} --method PATCH -f state=dismissed -f dismissed_reason=... -f dismissed_comment=...`,
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
      // 🔴 DEUX ORDRES DE JALONS DIFFÉRENTS NE SE COMPARENT PAS.
      // Le tri réel choisit d'abord le JALON (cf `board-next.mjs`), l'ordre ne
      // départage qu'à l'intérieur de l'un d'eux — et E4, juste au-dessus, scope
      // déjà ses doublons par `milestone@ordre`. Comparer les nombres bruts a fait
      // crier ce contrôle à tort dès qu'un ticket a MONTÉ de jalon : #255, passé de
      // la beta à l'alpha, y gagnait un ordre plus grand que sa cible restée en
      // beta — donc « inversé » selon le nombre, alors qu'il passe des semaines
      // avant selon la livraison. Un contrôle qui crie faux s'apprend à être ignoré.
      if ((moi.milestone ?? null) !== (aval.milestone ?? null)) {
        const a = moi.echeance ? Date.parse(moi.echeance) : null;
        const b = aval.echeance ? Date.parse(aval.echeance) : null;
        // Sans les deux échéances, on ne peut pas trancher : se TAIRE plutôt que
        // deviner — ce contrôle ne juge jamais d'une priorisation.
        if (a === null || b === null || a <= b) continue;
        add(
          "erreur",
          "CONTRAINTE-INVERSEE",
          issue.n,
          `doit passer AVANT #${cible}, mais son jalon « ${moi.milestone} » est livré APRÈS « ${aval.milestone} »`,
          `déplacer #${issue.n} dans « ${aval.milestone} » ou plus tôt`,
        );
        continue;
      }
      if (moi.ordre < aval.ordre) continue;
      add(
        "erreur",
        "CONTRAINTE-INVERSEE",
        issue.n,
        `doit passer AVANT #${cible}, mais est rangé après dans le même jalon (ordre ${moi.ordre} > ${aval.ordre})`,
        `remonter #${issue.n} avant l'ordre ${aval.ordre}`,
      );
    }
  }

  // E6 — un statut monte tout seul et ne redescend jamais : il ment par défaut.
  const limite = now.getTime() - JOURS_EN_COURS * 86400000;
  for (const item of items) {
    if (item.status !== "In Progress") continue;
    const vivants = (commits[item.n] ?? []).filter(
      (c) => !isPilotageCommit(c.subject) && Date.parse(c.date) >= limite,
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

  // E7 — une frise posée À LA MAIN ne repart jamais toute seule. Elle se périme
  // dans les DEUX sens : un départ resté dans le passé (le travail a glissé) comme
  // un départ jamais atteint dans le futur (posé « pour demain » lors d'une passe
  // antérieure). Vécu : la frise démarrait au 21 septembre, un 11 septembre — « on
  // comprend plus rien ». Un SEUL constat, porté par le ticket le plus ancien : 57
  // avertissements pour une seule cause apprendraient à passer outre.
  const jourDe = (iso) => Date.parse(`${iso}T00:00:00Z`);
  const aujourdhui = jourDe(new Date(now).toISOString().slice(0, 10));
  const dates = items
    .filter((i) => i.debut)
    .map((i) => ({ n: i.n, d: i.debut }));
  if (dates.length) {
    const depart = dates.reduce((a, b) => (jourDe(b.d) < jourDe(a.d) ? b : a));
    const ecart = Math.round((jourDe(depart.d) - aujourdhui) / 86400000);
    if (Math.abs(ecart) > TOLERANCE_FRISE)
      add(
        "erreur",
        "FRISE-DECALEE",
        depart.n,
        `la frise démarre le ${depart.d}, ${
          ecart > 0 ? `dans ${ecart} jours` : `il y a ${-ecart} jours`
        } — une frise décalée ne se lit plus, et rien ne la fait repartir`,
        "reposer Début/Cible depuis aujourd'hui, dans l'Ordre (un jour ouvré par ticket)",
      );
  }

  // E8 — une cible antérieure à son départ : la ligne du ticket part à l'envers.
  for (const item of items) {
    if (!item.debut || !item.cible) continue;
    if (jourDe(item.cible) >= jourDe(item.debut)) continue;
    add(
      "erreur",
      "CIBLE-AVANT-DEBUT",
      item.n,
      `Cible ${item.cible} antérieure à Début ${item.debut} — la barre part à l'envers`,
      "corriger l'une des deux dates",
    );
  }

  // A6 — la frise et l'estimation sont posées SÉPARÉMENT, et rien ne les
  // rapproche : un ticket estimé 6,5 jours portait une fenêtre d'UN jour, et le
  // tableau affichait les deux côte à côte sans rien dire (mesuré : 13 items sur
  // 86 datés et estimés). Un plan qui s'accorde moins de temps qu'il n'en a
  // estimé ne tient pas — c'est l'un des deux chiffres qui est faux.
  // UN seul constat, porté par le plus gros écart : même raison qu'en E7.
  const trop = items
    .filter((i) => i.debut && i.cible && typeof i.jours === "number")
    .map((i) => ({
      item: i,
      // Fenêtre CALENDAIRE, bornes incluses : un ticket qui commence et finit le
      // même jour dispose d'un jour, pas de zéro.
      fenetre: (jourDe(i.cible) - jourDe(i.debut)) / 86400000 + 1,
    }))
    .filter(({ item, fenetre }) => fenetre < item.jours)
    .sort((a, b) => b.item.jours - b.fenetre - (a.item.jours - a.fenetre));
  if (trop.length) {
    const { item, fenetre } = trop[0];
    add(
      "avertissement",
      "FRISE-TROP-COURTE",
      item.n,
      `${item.jours} j estimés pour une fenêtre de ${fenetre} j (${item.debut} → ${item.cible})` +
        `${trop.length > 1 ? ` — et ${trop.length - 1} autre(s) ticket(s) dans le même cas` : ""}` +
        " : l'un des deux chiffres est faux",
      "élargir la Cible, ou corriger l'estimation",
    );
  }

  // A5 — une frise À TROUS ne se lit pas davantage. Ne mord QUE dans un jalon déjà
  // daté : un jalon sans aucune date n'est pas en retard, il n'est pas encore planifié.
  const parJalon = new Map();
  for (const item of items) {
    const cle = item.milestone ?? "(sans jalon)";
    parJalon.set(cle, [...(parJalon.get(cle) ?? []), item]);
  }
  for (const [jalon, lot] of parJalon) {
    const datés = lot.filter((i) => i.debut);
    if (!datés.length) continue;
    const nus = lot.filter((i) => !i.debut);
    if (!nus.length) continue;
    add(
      "avertissement",
      "FRISE-A-TROUS",
      nus[0].n,
      `« ${jalon} » : ${nus.length} ticket(s) sans date alors que ${datés.length} en portent — ${nus
        .slice(0, 6)
        .map((i) => `#${i.n}`)
        .join(", ")}${nus.length > 6 ? "…" : ""}`,
      "dater tout le jalon, ou aucun",
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
      // 🔴 …et seulement DANS UN MÊME JALON. Le jalon encode la livraison,
      // l'ordre encode les dépendances À L'INTÉRIEUR : un P0 de la beta placé
      // après un P3 de l'alpha n'est pas une contradiction, c'est le
      // fonctionnement normal — l'alpha sort d'abord, quoi qu'il arrive.
      // Sans cette borne, le contrôle criait faux à chaque fois (mesuré : trois
      // avertissements permanents sur #340, #341, #348), et un contrôle qui crie
      // faux apprend à passer outre — ce qui le rend pire qu'absent.
      if ((tries[i].milestone ?? null) !== (tries[j].milestone ?? null))
        continue;
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
          content{ ... on Issue { number title state milestone{title dueOn} parent{number} } }
          fieldValues(first:20){ nodes{
            ... on ProjectV2ItemFieldNumberValue{ number field{... on ProjectV2FieldCommon{name}} }
            ... on ProjectV2ItemFieldSingleSelectValue{ name field{... on ProjectV2FieldCommon{name}} }
            ... on ProjectV2ItemFieldDateValue{ date field{... on ProjectV2FieldCommon{name}} } } }
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
          .map((v) => [v.field.name, v.number ?? v.name ?? v.date]),
      );
      return {
        n: node.content.number,
        title: node.content.title,
        milestone: node.content.milestone?.title ?? null,
        echeance: node.content.milestone?.dueOn ?? null,
        parent: node.content.parent?.number ?? null,
        ordre: typeof f.Ordre === "number" ? f.Ordre : undefined,
        jours: typeof f.Jours === "number" ? f.Jours : undefined,
        prio: f["Priorité"] ?? null,
        status: f.Status ?? null,
        debut: f["Début"] ?? null,
        cible: f.Cible ?? null,
      };
    });
}

/**
 * Les tickets ouverts du dépôt VITRINE.
 *
 * Lecture TOLÉRANTE : ce dépôt n'est pas le sujet du contrôle, et le rendre
 * bloquant ferait échouer tout le pilotage sur une panne qui ne le concerne
 * pas. Muet ⇒ liste vide, donc aucun avertissement — jamais un faux verdict.
 */
function readVitrine() {
  try {
    const brut = sh("gh", [
      "issue",
      "list",
      "--repo",
      VITRINE_REPO,
      "--state",
      "open",
      "--limit",
      "50",
      "--json",
      "number,title",
    ]);
    return JSON.parse(brut).map((i) => ({ n: i.number, title: i.title }));
  } catch {
    return [];
  }
}

/**
 * Les alertes d'analyse de code OUVERTES du dépôt.
 *
 * Lecture TOLÉRANTE, même raison que `readVitrine` : sans analyse de code
 * configurée, sans droit de lecture sur cet onglet, ou hors ligne, la commande
 * échoue — et un pilotage qui tomberait pour ça ferait d'un contrôle utile une
 * gêne. Muet ⇒ liste vide, donc aucun avertissement, jamais un faux verdict.
 *
 * `--paginate` : le compte dépasse une page dès qu'une règle touche plusieurs
 * sites, et une page unique rendrait un inventaire tronqué qui a l'air complet.
 */
function readAlertes() {
  try {
    const brut = sh("gh", [
      "api",
      "--paginate",
      `repos/${OWNER}/${REPO}/code-scanning/alerts?state=open&per_page=100`,
      "--slurp",
    ]);
    return JSON.parse(brut)
      .flat()
      .map((a) => ({
        n: a.number,
        rule: a.rule?.id ?? "règle inconnue",
        path: a.most_recent_instance?.location?.path ?? "?",
        line: a.most_recent_instance?.location?.start_line ?? 0,
      }));
  } catch {
    return [];
  }
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

/**
 * `true` si ce texte cite VRAIMENT le ticket `n`.
 *
 * Pure et exportée parce qu'elle porte un piège coûteux : `#9` ne doit pas
 * ramener le travail de `#95`, et la borne de mot `\b` — qui exprimerait
 * exactement cela — n'appartient PAS à la grammaire ERE de `git --grep`. Selon
 * la plateforme, elle n'y filtre rien, ou bien elle rejette tout. La règle vit
 * donc ici, en JavaScript, où elle s'éprouve.
 *
 * @param texte - sujet et corps du commit, concaténés
 * @param n - le numéro de ticket cherché
 * @returns `true` si le ticket est cité, borne de mot comprise
 */
export function citeLeTicket(texte, n) {
  return new RegExp(`#${n}(?![0-9])`).test(texte);
}

/** Les commits qui citent chaque ticket — la seule preuve qu'un travail avance. */
function readCommits(numeros) {
  const out = {};
  for (const n of numeros) {
    // ⚠️ Le filtrage FIN se fait en JavaScript, jamais dans `--grep`. La borne
    // de mot `\\b` n'appartient pas à la grammaire ERE : selon la plateforme et
    // la version de git, `--grep='#53\\b' -E` ne rend RIEN — et un lot de
    // commits existants passe pour inexistant. Vécu ici même : six tickets
    // déclarés « en cours sans le moindre commit » alors qu'un commit du jour
    // les citait. `git` dégrossit, la regex tranche.
    const brut = sh("git", [
      "log",
      "-30",
      `--grep=#${n}`,
      "--format=%H%x09%cI%x09%s%x09%b%x1e",
    ]);
    out[n] = brut
      ? brut
          .split("\u001e")
          .map((bloc) => bloc.trim())
          .filter(Boolean)
          .map((bloc) => {
            const [sha, date, subject, ...corps] = bloc.split("\t");
            return { sha, date, subject, body: corps.join("\t") };
          })
          .filter((c) => citeLeTicket(`${c.subject} ${c.body}`, n))
      : [];
  }
  return out;
}

// ─────────────────────────────────────────── rendu

/** Page de statut de GitHub — incidents en cours, API publique sans jeton. */
export const GITHUB_STATUS_URL =
  "https://www.githubstatus.com/api/v2/incidents/unresolved.json";

/**
 * Les incidents GitHub EN COURS, ou `null` si la page n'a pas répondu.
 *
 * Consultés seulement quand le tableau présente des erreurs : pendant une panne
 * de GitHub Projects, une issue inscrite reste invisible de `projectV2.items`
 * (vécu : quatre tickets « HORS-TABLEAU » inscrits par la commande qui venait de
 * le confirmer). La réinscrire à la main est inopérant, et le geste se refait à
 * chaque reprise tant que personne ne regarde la page de statut. Un échec de
 * lecture rend `null` — il ne masque jamais le verdict du tableau.
 */
export async function readGithubIncidents(fetcher = globalThis.fetch) {
  try {
    const res = await fetcher(GITHUB_STATUS_URL, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return (body.incidents ?? []).map((i) => ({
      name: String(i.name),
      status: String(i.status),
      link: String(i.shortlink ?? ""),
    }));
  } catch {
    return null;
  }
}

/**
 * L'avertissement à afficher sous les erreurs — pur, éprouvable sans réseau.
 *
 * @param incidents - rendus par {@link readGithubIncidents} (`null` = inconnu).
 * @returns les lignes à afficher, vides s'il n'y a rien à dire.
 */
export function incidentLines(incidents) {
  if (!incidents?.length) return [];
  return [
    "🌩️  GitHub signale un incident EN COURS — une erreur ci-dessus peut en venir, pas du tableau :",
    ...incidents.map(
      (i) => `   ${i.name} — ${i.status}${i.link ? ` — ${i.link}` : ""}`,
    ),
    "   → NE RIEN réinscrire à la main (inopérant pendant la panne) : relancer ce contrôle une fois l'incident résolu.",
    "   Page de statut : https://www.githubstatus.com",
    "",
  ];
}

function render(findings, total, incidents = null) {
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
      // Tout finding ne porte pas sur un TICKET : une alerte d'analyse de code
      // n'en a pas, et écrire « #null » enverrait chercher une issue qui n'existe
      // pas. Son identité est dans le message.
      const ancre = typeof f.n === "number" ? `#${f.n}` : "—".padEnd(4);
      lignes.push(`   ${ancre}  [${f.code}]  ${f.message}`);
      if (f.unlock) lignes.push(`         → ${f.unlock}`);
    }
    lignes.push("");
  }
  if (erreurs.length) lignes.push(...incidentLines(incidents));
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
  // Une issue-INSTRUMENT n'est pas un ticket : elle ne porte aucun travail, ne
  // promet aucune date et n'entre dans aucun reste-à-faire — c'est une SURFACE
  // d'affichage, régénérée par un script. Lui réclamer un jalon ou un rang
  // reviendrait à la compter comme du travail, ce qu'elle n'est pas ; et lui
  // poser `backlog` pour faire taire le contrôle serait un mensonge commode,
  // exactement ce que ce gate existe pour empêcher.
  let issues = readIssues().filter(
    (i) => !i.labels?.includes("tableau-de-bord"),
  );
  if (filtre) {
    items = items.filter((i) => i.milestone === filtre);
    issues = issues.filter((i) => i.milestone === filtre);
  }
  const enCours = items
    .filter((i) => i.status === "In Progress")
    .map((i) => i.n);
  const findings = lintBoard({
    items,
    issues,
    commits: readCommits(enCours),
    vitrine: readVitrine(),
    alertes: readAlertes(),
  });

  const incidents = findings.some((f) => f.severity === "erreur")
    ? await readGithubIncidents()
    : null;
  if (json)
    console.log(
      JSON.stringify({ total: items.length, findings, incidents }, null, 2),
    );
  else console.log(render(findings, items.length, incidents));

  process.exit(findings.some((f) => f.severity === "erreur") ? 1 : 0);
}
