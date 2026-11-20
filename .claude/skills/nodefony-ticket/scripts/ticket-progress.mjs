#!/usr/bin/env node
/**
 * Passe en « In Progress » les tickets qu'un commit vient de citer sans les fermer.
 *
 * POURQUOI DÉRIVER LE STATUT PLUTÔT QUE LE POSER
 *
 * « Commencer un ticket » n'est pas un instant observable : on lit, on explore, on
 * abandonne. Un statut posé sur un jugement se périme exactement comme un document
 * écrit à la main — c'est la maladie déjà payée deux fois sur ce dépôt (le `_state`
 * de reprise, puis le tableau de bord). Le seul fait observable et irréversible est
 * le PREMIER COMMIT qui cite le ticket : avant, on lit, et lire n'engage rien ;
 * après, du code existe.
 *
 * Un commit qui FERME (`Closes #12`) est ignoré : GitHub ferme l'issue, et le
 * workflow natif du tableau de bord la passe à « Done ». Un autre automatisme
 * (« Pull request linked to issue ») peut ensuite la remettre « In Progress » —
 * vécu sur #797 et #801, PR reliée après la clôture : `ticket-close.mjs` pose
 * donc « Done » lui-même, et `board-lint` signale le reste (`FERME-PAS-DONE`).
 *
 * CONTRAT : ce script ne doit JAMAIS faire échouer un commit ni le ralentir. Il est
 * lancé détaché par `.githooks/post-commit`, sort 0 quoi qu'il arrive, et se tait
 * quand GitHub ne répond pas — un pilotage indisponible n'est pas une erreur de
 * développement.
 *
 * Usage : node .claude/skills/nodefony-ticket/scripts/ticket-progress.mjs [<sha>]   (défaut : HEAD)
 *
 * @usage  node .claude/skills/nodefony-ticket/scripts/ticket-progress.mjs [<sha>]   (défaut : HEAD)
 */
import { execFileSync } from "node:child_process";

import { isPilotageCommit, mentionedTickets } from "./commit-kind.mjs";
import { guardCli } from "../../nodefony-session/scripts/cli-guard.mjs";

const OWNER = "nodefony";
const PROJECT = 2;
/** Mots-clés de fermeture reconnus par GitHub (EN et FR, tels qu'employés ici). */
const CLOSING =
  /\b(clos(?:e|es|ed)|fix(?:e|es|ed)?|resolv(?:e|es|ed))\s+#(\d+)/gi;

const sh = (cmd, args) =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/**
 * Les tickets qu'un message de commit met EN COURS : ceux qu'il cite sans les fermer.
 *
 * Séparé de tout accès réseau, donc éprouvable sans GitHub — un contrôle qu'on ne
 * peut pas voir échouer ne garde rien.
 *
 * Un commit de PILOTAGE ne met rien en cours : il cite pour rendre compte, pas
 * pour avancer. Le verdict vient de `commit-kind.mjs`, que `board-lint.mjs` lit
 * aussi — les deux bouts du même champ doivent juger sur la MÊME règle.
 *
 * @param message - le message de commit complet (sujet + corps).
 * @returns les numéros, en chaînes, sans doublon et dans l'ordre d'apparition.
 */
export function parseTargets(message) {
  if (isPilotageCommit(message)) return [];
  const closed = new Set([...message.matchAll(CLOSING)].map((m) => m[2]));
  const mentioned = new Set(mentionedTickets(message).map(String));
  return [...mentioned].filter((n) => !closed.has(n));
}

async function main() {
  const sha = process.argv[2] || "HEAD";
  const message = sh("git", ["log", "-1", "--format=%B", sha]);
  markInProgress(parseTargets(message));
}

/**
 * Passe des tickets OUVERTS du tableau de bord en « In Progress » — sans rien lever.
 *
 * Le crochet `post-commit` l'appelle par `main`, `ticket-start.mjs`
 * directement (son commit d'ouverture est un commit de pilotage, que
 * `parseTargets` écarte à raison). Le geste lui-même est {@link setBoardStatus}.
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
