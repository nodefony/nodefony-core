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
 * LE MESSAGE DU SQUASH EST ÉCRIT ICI, jamais laissé au réglage du dépôt : c'est
 * LE commit que lira le changelog. Le défaut recopiait les messages des commits
 * (dont le marqueur skip-ci du commit d'ouverture, qui coupait alors la CI de la
 * branche longue), ou le corps d'ouverture de la PR. Voir {@link squashMessage}.
 *
 * REFUS AVANT TOUT GESTE : une tête de PR marquée skip-ci (aucun check ne
 * tournera, l'attente serait sans fin), une PR en conflit avec sa base, et une
 * PR qui embarque une `release/*` — la fusion arrière est un commit de FUSION,
 * l'affaire de `release-sync.mjs`.
 *
 * @usage node .claude/skills/nodefony-ticket/scripts/pr-finish.mjs            (PR de la branche courante)
 * @usage node .claude/skills/nodefony-ticket/scripts/pr-finish.mjs <PR> [--dry-run]
 * @usage node .claude/skills/nodefony-ticket/scripts/pr-finish.mjs <PR> --merge-when-green   (la surveillance, en arrière-plan)
 * @option --dry-run  rend la voie choisie et ses raisons, sans rien modifier
 * @option --merge-when-green  attend les checks (arrêt au premier rouge) puis fusionne en squash avec le message composé
 * @requires gh authentifié ; arbre propre
 * @output la voie (auto ou surveillance), et la commande à lancer en arrière-plan le cas échéant
 */
import { execFileSync, spawnSync } from "node:child_process";
import { hasSkipMarker } from "../../../../scripts/repo/commit-guard.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { guardCli } from "../../nodefony-session/scripts/cli-guard.mjs";
import {
  carriedReleases,
  isAncestor,
  remoteMaintenance,
} from "./release-sync.mjs";

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
  return `node .claude/skills/nodefony-ticket/scripts/pr-finish.mjs ${pr} --merge-when-green`;
}

/** Ligne de ticket d'un corps de PR : `Closes #N` (vers `dev`) ou `Refs #N`. */
const TICKET_LINE = /^(?:Closes|Refs) #\d+$/mu;

/**
 * Le message du commit de squash — PUR.
 *
 * Sujet = titre de la PR suivi de `(#PR)` (forme GitHub). Corps = les sujets
 * des commits de TRAVAIL de la branche, puis la ligne de ticket du corps de la
 * PR. Les commits d'ouverture et de mise de côté (porteurs du marqueur skip-ci)
 * sont écartés : ils n'ont rien à dire au changelog, et leur marqueur, recopié,
 * couperait la CI de la branche longue.
 *
 * @param {{ title: string, number: number, body: string, commits: string[] }} pr -
 *   `commits` = messages des commits de la branche, dans l'ordre
 * @returns {{ subject: string, body: string }}
 */
export function squashMessage({ title, number, body, commits }) {
  const work = commits
    .filter((m) => !hasSkipMarker(m))
    .map((m) => `- ${m.split("\n", 1)[0]}`);
  const ticket = TICKET_LINE.exec(body ?? "")?.[0];
  const parts = [];
  if (work.length) parts.push(work.join("\n"));
  if (ticket) parts.push(ticket);
  return { subject: `${title} (#${number})`, body: parts.join("\n\n") };
}

/**
 * Ce qui interdit de clore la PR — PUR.
 *
 * @param {{ headMessage: string, mergeStateStatus: string, carried?: string[] }} pr -
 *   `carried` = branches `release/*` que la PR embarque ({@link carriedReleases})
 * @returns {string[]} les motifs ; vide = rien n'interdit
 */
export function finishBlockers({
  headMessage,
  mergeStateStatus,
  carried = [],
}) {
  const reasons = [];
  if (carried.length)
    reasons.push(
      `la PR embarque ${carried.join(", ")} : un squash la recopierait sous une autre empreinte, elle ne deviendrait pas ancêtre de la base, et la publication suivante serait refusée.\n` +
        "   → fusion arrière par release-sync.mjs (commit de FUSION), jamais par pr-finish",
    );
  if (hasSkipMarker(headMessage))
    reasons.push(
      "la tête de la PR porte un marqueur skip-ci : aucun check ne tournera, l'attente serait sans fin.\n" +
        "   → pousser d'abord un commit de TRAVAIL (le squash effacera le marqueur)",
    );
  if (mergeStateStatus === "DIRTY")
    reasons.push(
      "la PR est en CONFLIT avec sa base.\n" +
        "   → git fetch && git merge origin/<base> sur la branche, résoudre, pousser — jamais de rebase d'une branche poussée",
    );
  return reasons;
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
  // Sans numéro, la PR de la BRANCHE courante : `gh pr view --repo` n'accepte
  // pas l'absence de sélecteur (il ne déduit la branche que sans `--repo`).
  const selector = asked ?? sh("git", ["branch", "--show-current"]);
  if (!selector)
    throw new Error("tête détachée et aucun numéro de PR — passer le numéro");
  const pr = JSON.parse(
    sh("gh", [
      "pr",
      "view",
      selector,
      "--repo",
      REPO,
      "--json",
      "number,url,state,isDraft,baseRefName,headRefName,headRefOid,title,body,commits,mergeStateStatus",
    ]),
  );
  if (pr.state !== "OPEN")
    throw new Error(`PR #${pr.number} n'est pas ouverte (${pr.state})`);
  const commitMessages = pr.commits.map((c) =>
    [c.messageHeadline, c.messageBody].filter(Boolean).join("\n\n"),
  );
  const message = squashMessage({ ...pr, commits: commitMessages });

  // Les ancêtres se constatent sur les références DISTANTES, tête de PR comprise.
  sh("git", ["fetch", "origin", "--prune", "--quiet"]);
  sh("git", ["fetch", "origin", "--quiet", pr.headRefOid]);
  const blockers = finishBlockers({
    headMessage: commitMessages.at(-1) ?? "",
    mergeStateStatus: pr.mergeStateStatus,
    carried: carriedReleases(
      remoteMaintenance()
        .filter((name) => name !== pr.baseRefName)
        .map((name) => ({
          name,
          inHead: isAncestor(`origin/${name}`, pr.headRefOid),
          inBase: isAncestor(`origin/${name}`, `origin/${pr.baseRefName}`),
        })),
    ),
  });
  // La surveillance refuse sur les MÊMES motifs : elle fusionne en squash.
  if (blockers.length && !dryRun)
    throw new Error(`PR #${pr.number} :\n  · ${blockers.join("\n  · ")}`);
  for (const b of blockers) console.log(`⚠️ le geste réel le REFUSERA : ${b}`);

  if (argv.includes("--merge-when-green")) {
    mergeWhenGreen(pr.number, message);
    return;
  }

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
      "--subject",
      message.subject,
      "--body",
      message.body,
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

/**
 * La surveillance : attend les checks (arrêt au premier rouge), puis fusionne en
 * squash avec le message composé — arguments passés un par un, jamais par un
 * shell, où un titre en français (apostrophes) se casserait.
 *
 * @param {number} number - numéro de la PR
 * @param {{ subject: string, body: string }} message
 */
function mergeWhenGreen(number, message) {
  const checks = spawnSync(
    "gh",
    ["pr", "checks", String(number), "--repo", REPO, "--watch", "--fail-fast"],
    { cwd: ROOT, stdio: "inherit" },
  );
  if (checks.status !== 0)
    throw new Error(`PR #${number} : checks NON verts — rien n'est fusionné`);
  sh("gh", [
    "pr",
    "merge",
    String(number),
    "--repo",
    REPO,
    "--squash",
    "--delete-branch",
    "--subject",
    message.subject,
    "--body",
    message.body,
  ]);
  console.log(`PR #${number} fusionnée — ${message.subject}`);
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
