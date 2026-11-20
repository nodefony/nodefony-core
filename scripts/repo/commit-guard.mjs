#!/usr/bin/env node
/**
 * Garde `commit-msg` du travail en demandes de fusion (#796) : refuse un commit
 * de travail sur une branche longue, et un marqueur skip-ci glissé dans un
 * commit de vrai travail.
 *
 * ## Pourquoi
 *
 * - **Branche longue** (`main`, `dev`, `release/x.y.x`) : depuis la 10.0.0, le
 *   travail passe par une branche de ticket et sa PR. Un commit posé
 *   directement sur `release/10.0.x` part dans le prochain correctif sans CI de
 *   PR ; sur `dev`, il contourne la PR. Seule l'estampille de publication
 *   (`chore(release): …`, écrite par `npm run release`) y a sa place.
 * - **Marqueur skip-ci** : GitHub le lit dans TOUT le message, corps compris, et
 *   coupe alors toute la CI du push ou de la PR. Vécu sur la PR #805 : un commit
 *   dont le corps CITAIT la convention pour l'expliquer — zéro check. Il n'a sa
 *   place que dans un commit de mise de côté (`<type>(<scope>): wip — …`) ou
 *   d'ouverture (`… ouvrir le travail sur #N`, écrit par `ticket-start.mjs`).
 *
 * L'échappatoire existe pour l'amorçage (créer une branche de maintenance, un
 * correctif d'urgence décidé par l'auteur) et se NOMME : `NF_ALLOW_LONG_BRANCH_COMMIT=1`.
 * Une tête détachée (rebase en cours) n'est pas une branche : laissée passer.
 *
 * @usage node scripts/repo/commit-guard.mjs <fichier-du-message>   (appelé par .githooks/commit-msg)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { isLongBranch } from "../../.claude/skills/nodefony-session/scripts/branch-status.mjs";

/** Les marqueurs que GitHub reconnaît pour ne lancer aucun workflow. */
const SKIP_MARKERS =
  /\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]/iu;

/** Sujets qui ont le droit de porter un marqueur skip-ci : mise de côté et ouverture. */
const SKIP_ALLOWED =
  /^[a-z]+(?:\([^)]+\))?!?: (?:wip — |ouvrir le travail sur #\d+)/u;

/**
 * Le verdict de la garde — PUR.
 *
 * @param {{ branch: string, message: string, allowLongBranch: boolean }} input -
 *   `branch` vide = tête détachée
 * @returns {string[]} les motifs de refus ; vide = accepté
 */
export function commitGuard({ branch, message, allowLongBranch }) {
  const reasons = [];
  // git retire les lignes de commentaire du message : on juge ce qu'il gardera.
  const text = message
    .split("\n")
    .filter((l) => !l.startsWith("#"))
    .join("\n")
    .trim();
  const subject = text.split("\n", 1)[0] ?? "";

  if (
    branch &&
    isLongBranch(branch) &&
    !allowLongBranch &&
    !subject.startsWith("chore(release):")
  ) {
    reasons.push(
      `commit sur la branche LONGUE ${branch} : le travail passe par une branche de ticket et sa PR.\n` +
        "   Faire : node .claude/skills/nodefony-ticket/scripts/ticket-start.mjs <N> --slug <sujet>\n" +
        "   (le commit reste à faire là-bas ; ton message est gardé dans .git/COMMIT_EDITMSG)\n" +
        "   Amorçage décidé par l'auteur seulement : NF_ALLOW_LONG_BRANCH_COMMIT=1 git commit …",
    );
  }
  if (SKIP_MARKERS.test(text) && !SKIP_ALLOWED.test(subject)) {
    reasons.push(
      "marqueur skip-ci dans un commit de travail : GitHub le lit dans TOUT le message, corps compris,\n" +
        "   et ne lancerait AUCUNE CI pour ce push ni pour la PR (vécu : PR #805, zéro check).\n" +
        "   Pour en parler dans un message, écrire « skip-ci » sans crochets. Il n'a sa place que dans\n" +
        "   « <type>(<scope>): wip — … » (mise de côté) ou « … ouvrir le travail sur #N » (ticket-start).",
    );
  }
  return reasons;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  const message = readFileSync(file, "utf8");
  let branch;
  try {
    branch = execFileSync("git", ["symbolic-ref", "--short", "-q", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    branch = ""; // tête détachée
  }
  const reasons = commitGuard({
    branch,
    message,
    allowLongBranch: process.env.NF_ALLOW_LONG_BRANCH_COMMIT === "1",
  });
  if (reasons.length) {
    for (const r of reasons) console.error(`❌ commit-msg REFUSÉ : ${r}`);
    process.exit(1);
  }
}
