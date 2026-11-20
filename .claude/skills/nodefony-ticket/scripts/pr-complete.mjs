#!/usr/bin/env node
/**
 * Remplit la colonne de droite d'une pull request : responsable, jalon, lots,
 * tableau de bord et lien vers les tickets — ce que `gh pr create` laisse vide.
 *
 * Les valeurs ne s'inventent pas : elles se LISENT sur les tickets que la PR
 * traite (`Refs #N` / `Closes #N` au corps, numéro en tête de branche
 * `fix/797-…`). Une PR « à moitié remplie » ne se trie pas sur le tableau, ne
 * dit pas quelle version elle prépare, et ne mène pas à son ticket.
 *
 * Ce que GitHub ne permet pas, le script le DIT au lieu de le taire : le lien
 * « Development » se pose par un mot-clé de fermeture vers la branche PAR
 * DÉFAUT seulement, à la main (colonne de droite du ticket) ailleurs, et par
 * aucune API — une PR vers `release/*` ne fermera jamais son ticket ; on le
 * ferme à la main après fusion (`ticket-close.mjs`).
 *
 * @usage node .claude/skills/nodefony-ticket/scripts/pr-complete.mjs 799
 * @usage node .claude/skills/nodefony-ticket/scripts/pr-complete.mjs 799 --dry-run
 * @option --dry-run  rend le plan sans rien modifier
 * @requires gh authentifié, droits d'écriture sur le dépôt et le tableau
 * @output le plan (gestes, puis ce qui ne se pose pas et pourquoi)
 */
import { execFileSync } from "node:child_process";
import { guardCli } from "../../nodefony-session/scripts/cli-guard.mjs";

const OWNER = "nodefony";
const REPO = "nodefony-core";
/** Le tableau de bord des tickets — le même que `ticket-open.mjs`. */
const PROJECT = 2;

/**
 * Les tickets qu'une PR traite : mots-clés du corps, puis numéro de branche.
 *
 * @param {{ body?: string, headRefName?: string }} pr
 * @returns {number[]} numéros, sans doublon, dans l'ordre de découverte
 */
export function referencedIssues(pr) {
  const found = [];
  const add = (n) => {
    if (Number.isInteger(n) && n > 0 && !found.includes(n)) found.push(n);
  };
  const body = pr.body ?? "";
  for (const m of body.matchAll(
    /\b(?:refs?|close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+#(\d+)/giu,
  )) {
    add(Number(m[1]));
  }
  // `fix/797-generated-home-styles` : le ticket en tête du nom de branche.
  const branch = /^[a-z]+\/(\d+)-/u.exec(pr.headRefName ?? "");
  if (branch) add(Number(branch[1]));
  return found;
}

/**
 * Le plan qui complète la PR — PUR : il reçoit l'état, il ne le lit pas.
 *
 * @param {object} ctx
 * @param {object} ctx.pr - `gh pr view --json number,body,baseRefName,headRefName,assignees,labels,milestone,projectItems,closingIssuesReferences`
 * @param {{ number: number, milestone: { title: string } | null, labels: { name: string }[] }[]} ctx.issues - les tickets traités
 * @param {string} ctx.defaultBranch - la branche par défaut du dépôt
 * @param {string} ctx.projectTitle - le titre du tableau de bord
 * @returns {{ actions: { kind: string, value: string }[], notes: string[] }}
 */
export function planPrCompletion({ pr, issues, defaultBranch, projectTitle }) {
  const actions = [];
  const notes = [];

  if ((pr.assignees ?? []).length === 0) {
    actions.push({ kind: "assignee", value: "@me" });
  }

  if (issues.length === 0) {
    notes.push(
      "aucun ticket trouvé (ni `Refs #N` au corps, ni numéro en tête de branche) — jalon, lots et lien restent à poser à la main",
    );
  }

  const milestones = [
    ...new Set(issues.map((i) => i.milestone?.title).filter(Boolean)),
  ];
  if (!pr.milestone && milestones.length === 1) {
    actions.push({ kind: "milestone", value: milestones[0] });
  } else if (!pr.milestone && milestones.length > 1) {
    notes.push(
      `jalon NON posé : les tickets en portent plusieurs (${milestones.join(", ")}) — à trancher`,
    );
  } else if (
    pr.milestone &&
    milestones.length === 1 &&
    pr.milestone.title !== milestones[0]
  ) {
    notes.push(
      `jalon de la PR (${pr.milestone.title}) ≠ jalon du ticket (${milestones[0]}) — à vérifier`,
    );
  }

  const present = new Set((pr.labels ?? []).map((l) => l.name));
  for (const name of new Set(
    issues.flatMap((i) => i.labels.map((l) => l.name)),
  )) {
    if (!present.has(name)) actions.push({ kind: "label", value: name });
  }

  const onBoard = (pr.projectItems ?? []).some((p) => p.title === projectTitle);
  if (!onBoard) actions.push({ kind: "project", value: projectTitle });

  const linked = new Set(
    (pr.closingIssuesReferences ?? []).map((i) => i.number),
  );
  const unlinked = issues.map((i) => i.number).filter((n) => !linked.has(n));
  if (unlinked.length > 0) {
    if (pr.baseRefName === defaultBranch) {
      for (const n of unlinked)
        actions.push({ kind: "closes", value: `#${n}` });
    } else {
      notes.push(
        `lien « Development » À LA MAIN vers ${pr.baseRefName} : le mot-clé ne relie (et ne ferme) que vers ${defaultBranch}, et aucune API ne pose ce lien — clic depuis la colonne de droite du ticket (Development → la PR). ` +
          `Garder \`Refs ${unlinked.map((n) => `#${n}`).join(" ")}\` au corps, et fermer à la main après fusion (ticket-close.mjs).`,
      );
    }
  }

  notes.push(
    "relecteurs : aucun — projet solo, et GitHub refuse que l'auteur se relise ; la CI tient lieu de relecture",
  );
  return { actions, notes };
}

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

function ghJson(args) {
  return JSON.parse(sh("gh", args));
}

if (process.argv[1]?.endsWith("pr-complete.mjs")) {
  guardCli(import.meta.url);
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const number = argv.find((a) => /^\d+$/u.test(a));
  if (!number) {
    console.error("usage : pr-complete.mjs <numéro de PR> [--dry-run]");
    process.exit(64);
  }
  const repo = `${OWNER}/${REPO}`;
  const pr = ghJson([
    "pr",
    "view",
    number,
    "--repo",
    repo,
    "--json",
    "number,body,baseRefName,headRefName,assignees,labels,milestone,projectItems,closingIssuesReferences",
  ]);
  const issues = referencedIssues(pr).map((n) =>
    ghJson([
      "issue",
      "view",
      String(n),
      "--repo",
      repo,
      "--json",
      "number,milestone,labels",
    ]),
  );
  const defaultBranch = ghJson([
    "repo",
    "view",
    repo,
    "--json",
    "defaultBranchRef",
  ]).defaultBranchRef.name;
  const projectTitle = ghJson([
    "project",
    "view",
    String(PROJECT),
    "--owner",
    OWNER,
    "--format",
    "json",
  ]).title;

  const plan = planPrCompletion({ pr, issues, defaultBranch, projectTitle });
  const tickets = issues.map((i) => `#${i.number}`).join(" ") || "aucun";
  console.log(`PR #${number} — tickets traités : ${tickets}`);
  if (plan.actions.length === 0)
    console.log("rien à poser : la PR est complète");

  let body = pr.body ?? "";
  for (const action of plan.actions) {
    console.log(
      `${dryRun ? "à poser" : "posé"} · ${action.kind} : ${action.value}`,
    );
    if (dryRun) continue;
    if (action.kind === "assignee") {
      sh("gh", [
        "pr",
        "edit",
        number,
        "--repo",
        repo,
        "--add-assignee",
        action.value,
      ]);
    } else if (action.kind === "milestone") {
      sh("gh", [
        "pr",
        "edit",
        number,
        "--repo",
        repo,
        "--milestone",
        action.value,
      ]);
    } else if (action.kind === "label") {
      sh("gh", [
        "pr",
        "edit",
        number,
        "--repo",
        repo,
        "--add-label",
        action.value,
      ]);
    } else if (action.kind === "project") {
      sh("gh", [
        "pr",
        "edit",
        number,
        "--repo",
        repo,
        "--add-project",
        action.value,
      ]);
    } else if (action.kind === "closes") {
      body = `${body.trimEnd()}\n\nCloses ${action.value}\n`;
      sh("gh", ["pr", "edit", number, "--repo", repo, "--body", body]);
    }
  }
  for (const note of plan.notes) console.log(`ℹ️ ${note}`);
}
