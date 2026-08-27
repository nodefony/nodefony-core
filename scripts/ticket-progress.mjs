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
 * workflow natif du tableau de bord la passe à « Done » tout seul — vérifié.
 *
 * CONTRAT : ce script ne doit JAMAIS faire échouer un commit ni le ralentir. Il est
 * lancé détaché par `.githooks/post-commit`, sort 0 quoi qu'il arrive, et se tait
 * quand GitHub ne répond pas — un pilotage indisponible n'est pas une erreur de
 * développement.
 *
 * Usage : node scripts/ticket-progress.mjs [<sha>]   (défaut : HEAD)
 */
import { execFileSync } from "node:child_process";

const OWNER = "nodefony";
const PROJECT = 2;
/** Mots-clés de fermeture reconnus par GitHub (EN et FR, tels qu'employés ici). */
const CLOSING =
  /\b(clos(?:e|es|ed)|fix(?:e|es|ed)?|resolv(?:e|es|ed))\s+#(\d+)/gi;
const MENTION = /#(\d+)/g;

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
 * @param message - le message de commit complet (sujet + corps).
 * @returns les numéros, en chaînes, sans doublon et dans l'ordre d'apparition.
 */
export function parseTargets(message) {
  const closed = new Set([...message.matchAll(CLOSING)].map((m) => m[2]));
  const mentioned = new Set([...message.matchAll(MENTION)].map((m) => m[1]));
  return [...mentioned].filter((n) => !closed.has(n));
}

async function main() {
  const sha = process.argv[2] || "HEAD";
  const message = sh("git", ["log", "-1", "--format=%B", sha]);
  const targets = parseTargets(message);
  if (!targets.length) return;

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
  const inProgress = status?.options?.find((o) => o.name === "In Progress");
  if (!status || !inProgress) process.exit(0);

  for (const n of targets) {
    try {
      // L'item se retrouve par GraphQL, jamais par `gh project item-list` : ce
      // client OMET des items sans le dire (39 rendus contre 40 comptés).
      const q = `{repository(owner:"${OWNER}",name:"nodefony-core"){issue(number:${n}){
        state projectItems(first:5){nodes{id project{number}
        fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}}}`;
      const issue = JSON.parse(sh("gh", ["api", "graphql", "-f", `query=${q}`]))
        .data.repository.issue;
      if (!issue || issue.state !== "OPEN") continue;
      const item = issue.projectItems.nodes.find(
        (i) => i.project.number === PROJECT,
      );
      // Un ticket hors tableau de bord est invisible du pilotage : l'y mettre est
      // le vrai correctif, mais il n'appartient pas à un hook de le décider.
      if (!item) {
        console.error(`ticket-progress : #${n} n'est pas au tableau de bord`);
        continue;
      }
      if (item.fieldValueByName?.name === "In Progress") continue;
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
        inProgress.id,
      ]);
      console.error(`ticket-progress : #${n} → In Progress`);
    } catch {
      /* un ticket qui résiste ne doit pas empêcher les suivants */
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith("ticket-progress.mjs")) {
  try {
    await main();
  } catch {
    /* pas de réseau, pas d'authentification, pas de tableau : on se tait */
  }
  process.exit(0);
}
