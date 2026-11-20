#!/usr/bin/env node
/**
 * Passe en « In Progress » le ticket de la branche de travail où l'on vient de commiter.
 *
 * POURQUOI DÉRIVER LE STATUT PLUTÔT QUE LE POSER
 *
 * « Commencer un ticket » n'est pas un instant observable : on lit, on explore, on
 * abandonne. Un statut posé sur un jugement se périme exactement comme un document
 * écrit à la main — c'est la maladie déjà payée deux fois sur ce dépôt (le `_state`
 * de reprise, puis le tableau de bord). Le seul fait observable et irréversible est
 * le PREMIER COMMIT sur la branche du ticket : avant, on lit, et lire n'engage
 * rien ; après, du code existe.
 *
 * POURQUOI LA BRANCHE ET JAMAIS LES MENTIONS
 *
 * En travail par demandes de fusion, chaque ticket a SA branche
 * (`<type>/<N>-<sujet>`, `ticket-start.mjs`) : elle dit sans ambiguïté sur quoi
 * l'on travaille. Les numéros cités dans un message, eux, disent de quoi l'on
 * PARLE — un exemple d'essai à blanc, un ticket voisin, une alerte CodeQL, une
 * liste « reste ». Lire les mentions a monté à tort #188, #245, #246, #248, puis
 * #794 et #445 cités dans des messages de #796. Hors branche de travail (branche
 * longue, HEAD détaché, branche d'un autre nom) : rien n'est mis en cours.
 *
 * La fermeture n'est pas l'affaire de ce script : `ticket-close.mjs` pose
 * « Done » lui-même, et `board-lint` signale un fermé resté ailleurs
 * (`FERME-PAS-DONE`) — l'automatisme « Pull request linked to issue » remet
 * « In Progress » un ticket relié APRÈS sa clôture (vécu sur #797 et #801).
 *
 * CONTRAT : ce script ne doit JAMAIS faire échouer un commit ni le ralentir. Il est
 * lancé détaché par `.githooks/post-commit`, sort 0 quoi qu'il arrive, et se tait
 * quand GitHub ne répond pas — un pilotage indisponible n'est pas une erreur de
 * développement.
 *
 * Usage : node .claude/skills/nodefony-ticket/scripts/ticket-progress.mjs
 *
 * @usage  node .claude/skills/nodefony-ticket/scripts/ticket-progress.mjs
 */
import { execFileSync } from "node:child_process";

import { ticketOfBranch } from "./commit-kind.mjs";
import { guardCli } from "../../nodefony-session/scripts/cli-guard.mjs";

const OWNER = "nodefony";
const PROJECT = 2;

const sh = (cmd, args) =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/**
 * Les tickets qu'un commit sur cette branche met EN COURS : celui de la branche, ou aucun.
 *
 * Séparé de tout accès réseau, donc éprouvable sans GitHub — un contrôle qu'on ne
 * peut pas voir échouer ne garde rien. Le message du commit n'entre pas en
 * compte : voir l'en-tête, « pourquoi la branche et jamais les mentions ».
 *
 * @param {string} branch - nom court de la branche courante (vide si HEAD détaché)
 * @returns {number[]} le ticket de la branche de travail, ou rien
 */
export function ticketsInProgress(branch) {
  const n = ticketOfBranch(branch);
  return n === null ? [] : [n];
}

async function main() {
  const branch = sh("git", ["branch", "--show-current"]).trim();
  markInProgress(ticketsInProgress(branch));
}

/**
 * Passe des tickets OUVERTS du tableau de bord en « In Progress » — sans rien lever.
 *
 * Le crochet `post-commit` l'appelle par `main`, `ticket-start.mjs`
 * directement, juste après avoir ouvert la branche. Le geste lui-même est
 * {@link setBoardStatus}.
 *
 * @param {(string|number)[]} targets - numéros de tickets
 * @returns {void}
 */
export function markInProgress(targets) {
  setBoardStatus(targets, "In Progress", "OPEN");
}

/**
 * Pose un statut du tableau de bord sur des tickets dans l'état attendu — sans rien lever.
 *
 * SEULE implémentation de l'écriture du champ « Status » : la mise en cours
 * (`markInProgress`) et la clôture (`ticket-close.mjs`) l'appellent, aucune
 * ne recopie la requête. L'état exigé (`OPEN` pour une
 * mise en cours, `CLOSED` pour « Done ») est relu sur GitHub juste avant
 * l'écriture : un ticket qui n'y est pas, hors tableau ou déjà au bon statut est
 * laissé tel quel. Une erreur sur UN ticket se tait ; une erreur de lecture du
 * tableau remonte à l'appelant (qui décide de se taire).
 *
 * @param {(string|number)[]} targets - numéros de tickets
 * @param {string} statusName - option du champ « Status » (`In Progress`, `Done`)
 * @param {"OPEN" | "CLOSED"} requiredState - état GitHub exigé du ticket
 * @returns {(string|number)[]} les tickets effectivement modifiés
 */
export function setBoardStatus(targets, statusName, requiredState) {
  const changed = [];
  if (!targets.length) return changed;

  // Un seul aller-retour pour les identifiants, puis un par ticket. Si `gh` n'est
  // pas authentifié ou que le réseau est absent, on sort en silence.
  const project = JSON.parse(
    sh("gh", [
      "project",
      "view",
      String(PROJECT),
      "--owner",
      OWNER,
      "--format",
      "json",
    ]),
  );
  const fields = JSON.parse(
    sh("gh", [
      "project",
      "field-list",
      String(PROJECT),
      "--owner",
      OWNER,
      "--format",
      "json",
    ]),
  ).fields;
  const status = fields.find((f) => f.name === "Status");
  const option = status?.options?.find((o) => o.name === statusName);
  if (!status || !option) return changed;

  for (const n of targets) {
    try {
      // L'item se retrouve par GraphQL, jamais par `gh project item-list` : ce
      // client OMET des items sans le dire (39 rendus contre 40 comptés).
      const q = `{repository(owner:"${OWNER}",name:"nodefony-core"){issue(number:${n}){
        state projectItems(first:5){nodes{id project{number}
        fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}}}`;
      const issue = JSON.parse(sh("gh", ["api", "graphql", "-f", `query=${q}`]))
        .data.repository.issue;
      if (issue?.state !== requiredState) continue;
      const item = issue.projectItems.nodes.find(
        (i) => i.project.number === PROJECT,
      );
      // Un ticket hors tableau de bord est invisible du pilotage : l'y mettre est
      // le vrai correctif, mais il n'appartient pas à ce geste de le décider.
      if (!item) {
        console.error(`ticket-progress : #${n} n'est pas au tableau de bord`);
        continue;
      }
      if (item.fieldValueByName?.name === statusName) continue;
      sh("gh", [
        "project",
        "item-edit",
        "--id",
        item.id,
        "--project-id",
        project.id,
        "--field-id",
        status.id,
        "--single-select-option-id",
        option.id,
      ]);
      changed.push(n);
      console.error(`ticket-progress : #${n} → ${statusName}`);
    } catch {
      /* un ticket qui résiste ne doit pas empêcher les suivants */
    }
  }
  return changed;
}

if (process.argv[1]?.endsWith("ticket-progress.mjs")) {
  guardCli(import.meta.url);
  try {
    await main();
  } catch {
    /* pas de réseau, pas d'authentification, pas de tableau : on se tait */
  }
  process.exit(0);
}
