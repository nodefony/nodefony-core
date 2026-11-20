#!/usr/bin/env node
/**
 * Clôt un ticket SANS attendre la CI : branche poussée, PR « prête », fusion confiée à GitHub.
 *
 * POURQUOI
 *
 * La CI d'une PR dure ~35 min. L'attendre au premier plan, c'est une session
 * qui ne fait rien pendant ce temps — constaté sur #804, et refusé par
 * l'auteur : « notre nouvelle manière de travailler doit être efficiente ».
 * Ce script rend la main tout de suite ; le ticket suivant s'entame aussitôt
 * (`ticket-start.mjs`, qui part de `origin/<base>`, jamais de cette branche).
 *
 * DEUX VOIES, CHOISIES SUR CE QUI EST CONSTATÉ — jamais supposé
 *
 * - **Fusion automatique** (`gh pr merge --squash --delete-branch --auto`) :
 *   GitHub fusionne seul quand les checks EXIGÉS sont verts. ⚠️ Sans check
 *   exigé (pas de protection de branche), `--auto` fusionnerait IMMÉDIATEMENT,
 *   CI rouge comprise : la voie n'est prise que si le dépôt l'autorise ET que
 *   la base exige des checks.
 * - **Sinon, surveillance** : la commande à lancer EN ARRIÈRE-PLAN est rendue
 *   (`gh pr checks --watch --fail-fast`, puis la fusion en squash), et la
 *   reprise suivante dit ce que la CI a rendu.
 *
 * Vers `release/*`, la fusion ne ferme pas le ticket (`Closes` ne mord que vers
 * la branche par défaut) : la reprise rattrape « PR fusionnée, ticket ouvert ».
 *
 * @usage node .claude/skills/nodefony-ticket/scripts/pr-finish.mjs            (PR de la branche courante)
 * @usage node .claude/skills/nodefony-ticket/scripts/pr-finish.mjs <PR> [--dry-run]
 * @option --dry-run  rend la voie choisie et ses raisons, sans rien modifier
 * @requires gh authentifié ; arbre propre
 * @output la voie (auto ou surveillance), et la commande à lancer en arrière-plan le cas échéant
 */
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { guardCli } from "../../nodefony-session/scripts/cli-guard.mjs";

const REPO = "nodefony/nodefony-core";

/**
 * La voie de fusion — PURE : elle reçoit ce qui a été constaté.
 *
 * @param {{ allowAutoMerge: boolean, requiredChecks: number | null }} facts -
 *   `requiredChecks` = nombre de checks exigés par la protection de la base,
 *   `null` si la base n'est pas protégée
 * @returns {{ mode: "auto" | "watch", reason: string }}
 */
export function mergePlan({ allowAutoMerge, requiredChecks }) {
  if (!allowAutoMerge) {
    return {
      mode: "watch",
      reason:
        "fusion automatique désactivée sur le dépôt (réglage « Allow auto-merge »)",
    };
  }
  if (!requiredChecks) {
    return {
      mode: "watch",
      reason:
        requiredChecks === null
          ? "base non protégée : --auto fusionnerait tout de suite, CI rouge comprise"
          : "la protection de la base n'exige aucun check : --auto fusionnerait tout de suite",
    };
  }
  return {
    mode: "auto",
    reason: `${requiredChecks} check(s) exigé(s) par la base : GitHub fusionne quand ils sont verts`,
  };
}

/**
 * La commande de surveillance à lancer en arrière-plan quand la fusion n'est pas automatique.
 *
 * @param {number} pr - numéro de la PR
 * @returns {string}
 */
export function watchCommand(pr) {
  return `gh pr checks ${pr} --watch --fail-fast && gh pr merge ${pr} --squash --delete-branch`;
}

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

function sh(cmd, args) {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Les checks exigés par la protection d'une branche, ou `null` si elle n'est pas protégée. */
function requiredChecksOf(base) {
  const r = spawnSync(
    "gh",
    [
      "api",
      `repos/${REPO}/branches/${base}/protection`,
      "--jq",
      "(.required_status_checks.contexts // []) | length",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (r.status !== 0) {
    // 404 « Branch not protected » : un fait, pas une panne.
    if (/not protected/iu.test(r.stdout + r.stderr)) return null;
    throw new Error(
      `protection de ${base} illisible : ${(r.stderr || r.stdout).trim()}`,
    );
  }
  return Number(r.stdout.trim());
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const asked = argv.find((a) => /^\d+$/u.test(a));

  const dirty = sh("git", ["status", "--porcelain"]) !== "";
  if (dirty && dryRun) {
    console.log("⚠️ arbre non propre — le geste réel le REFUSERA");
  } else if (dirty) {
    throw new Error(
      "arbre non propre — commiter d'abord : la PR prête doit porter tout le travail",
    );
  }
  const pr = JSON.parse(
    sh("gh", [
      "pr",
      "view",
      ...(asked ? [asked] : []),
      "--repo",
      REPO,
      "--json",
      "number,url,state,isDraft,baseRefName,headRefName",
    ]),
  );
  if (pr.state !== "OPEN")
    throw new Error(`PR #${pr.number} n'est pas ouverte (${pr.state})`);

  const allowAutoMerge =
    sh("gh", ["api", `repos/${REPO}`, "--jq", ".allow_auto_merge"]) === "true";
  const plan = mergePlan({
    allowAutoMerge,
    requiredChecks: requiredChecksOf(pr.baseRefName),
  });
  console.log(
    `PR #${pr.number} ${pr.headRefName} → ${pr.baseRefName}\n  voie : ${plan.mode === "auto" ? "fusion automatique" : "surveillance en arrière-plan"} — ${plan.reason}`,
  );
  if (dryRun) {
    if (plan.mode === "watch")
      console.log(`  commande : ${watchCommand(pr.number)}`);
    return;
  }

  if (sh("git", ["branch", "--show-current"]) === pr.headRefName) {
    sh("git", ["push"]);
  }
  if (pr.isDraft) sh("gh", ["pr", "ready", String(pr.number), "--repo", REPO]);
  console.log(`  prête : ${pr.url}`);

  if (plan.mode === "auto") {
    sh("gh", [
      "pr",
      "merge",
      String(pr.number),
      "--repo",
      REPO,
      "--squash",
      "--delete-branch",
      "--auto",
    ]);
    console.log(
      "  fusion automatique programmée — enchaîner sur le ticket suivant",
    );
  } else {
    console.log(
      `  à lancer EN ARRIÈRE-PLAN (jamais au premier plan), puis enchaîner sur le ticket suivant :\n    ${watchCommand(pr.number)}`,
    );
  }
}

if (process.argv[1]?.endsWith("pr-finish.mjs")) {
  guardCli(import.meta.url);
  try {
    main();
  } catch (e) {
    const err = /** @type {{ message?: string, stderr?: string }} */ (e);
    console.error(`✗ ${String(err.stderr || err.message || e).trim()}`);
    process.exit(1);
  }
}
