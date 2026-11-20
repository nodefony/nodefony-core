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
import {
  hasSkipMarker,
  isParkingSubject,
} from "../../../../scripts/repo/commit-guard.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { releasableWorkspaces } from "../../../../scripts/lib/workspaces.mjs";
import { perimetrePublie } from "../../../../scripts/release/release-core.mjs";

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
 * des commits de TRAVAIL de la branche (`- type(portée)!: …`, que
 * `release-core.mjs#analyserCommits` lit comme autant d'entrées du changelog),
 * puis les pieds : la ligne de ticket du corps de la PR, les `Closes #N` des
 * commits, et leurs `BREAKING CHANGE:` — une rupture ne se perd pas au squash.
 *
 * 🔴 Le PÉRIMÈTRE se juge par commit de travail, ici et pas au changelog : le
 * squash touche des fichiers publiés dès qu'UN commit en touche, et tous ses
 * en-têtes passeraient alors le filtre de `analyserCommits` — les `fix(pilotage)`
 * de l'outillage compris. Un commit dont `published` vaut `false` part donc
 * dans un paragraphe « Outillage » INDENTÉ, que le changelog ne lit pas. Un
 * message nu (chaîne) est tenu pour publié : écarter dans le doute publierait
 * un oubli pour toujours.
 *
 * Les commits d'ouverture et de mise de côté sont écartés sur leur SUJET
 * (`isParkingSubject`) : ils n'ont rien à dire au changelog. Écarter « tout
 * message qui contient le marqueur » retirait aussi un commit de travail dont le
 * corps CITAIT la convention (revue #796, N4). Aucune ligne retenue ne porte de
 * marqueur : recopié, il couperait la CI de la branche longue.
 *
 * @param {{ title: string, number: number, body: string, commits: Array<string | { message: string, published: boolean }> }} pr -
 *   `commits` = messages des commits de la branche, dans l'ordre, avec leur
 *   verdict de périmètre (`release-core.mjs#perimetrePublie`) quand il est connu
 * @returns {{ subject: string, body: string }}
 */
export function squashMessage({ title, number, body, commits }) {
  const work = commits
    .map((c) => (typeof c === "string" ? { message: c, published: true } : c))
    .filter((c) => !isParkingSubject(c.message.split("\n", 1)[0]));
  // 🔴 Une rupture s'écrit SOUS la ligne de son commit, indentée
  // (`  BREAKING CHANGE: …`) : `release-core.mjs#analyserCommits` l'attache à
  // ce voisin, jamais par position — l'appariement « k-ième pied, k-ième `!` »
  // se faisait déjouer par chaque cas neuf (revue #796, N4). Le `!` se pose sur
  // la ligne d'un commit publié qui porte un pied. L'outillage n'en donne aucun :
  // sa rupture n'atteint aucun installeur.
  const breakingOf = (c) =>
    c.message
      .split("\n")
      .slice(1)
      .filter((l) => BREAKING_FOOTER.test(l) && !hasSkipMarker(l))
      .map((l) => l.replace(/^BREAKING[ -]CHANGE:\s*/u, ""));
  const headline = (c) => {
    const h = c.message.split("\n", 1)[0];
    return c.published && breakingOf(c).length
      ? h.replace(/^(\w+(?:\([^)]*\))?)(?!!):/u, "$1!:")
      : h;
  };
  /** @type {string[]} */
  const lines = [];
  for (const c of work) {
    if (!c.published || hasSkipMarker(`- ${headline(c)}`)) continue;
    lines.push(`- ${headline(c)}`);
    for (const b of breakingOf(c)) lines.push(`  BREAKING CHANGE: ${b}`);
  }
  const tooling = work
    .filter((c) => !c.published)
    .map((c) => `  ${headline(c)}`)
    .filter((l) => !hasSkipMarker(l));
  /** @type {string[]} */
  const footers = [];
  const ticket = TICKET_LINE.exec(body ?? "")?.[0];
  if (ticket) footers.push(ticket);
  for (const { message: m } of work) {
    for (const l of m.split("\n").slice(1)) {
      if (CLOSING_FOOTER.test(l) && !footers.includes(l)) footers.push(l);
    }
  }
  const parts = [];
  if (lines.length) parts.push(lines.join("\n"));
  if (tooling.length)
    parts.push(
      `Outillage du dépôt (hors paquets publiés) :\n${tooling.join("\n")}`,
    );
  if (footers.length) parts.push(footers.join("\n"));
  return { subject: `${title} (#${number})`, body: parts.join("\n\n") };
}

/**
 * Le rappel de fermeture après fusion — PUR. Vers `dev` (branche par défaut),
 * `Closes #N` ferme le ticket ; vers `release/*`, AUCUN mot-clé ne mord : la
 * fusion laissait le ticket ouvert sans un mot (revue #796, G1).
 *
 * @param {{ body: string }} pr - corps de la PR (`Refs #N` posé par ticket-start)
 * @returns {string | null} la consigne, ou `null` si la fusion ferme d'elle-même
 */
export function closeReminder({ body }) {
  // Un corps édité sur le web arrive en CRLF : `$` (drapeau `m`) s’arrête
  // aussi avant `\r`, rien à ajouter — le test le garde.
  const refs = [...(body ?? "").matchAll(/^Refs #(\d+)$/gmu)].map((m) => m[1]);
  if (refs.length === 0) return null;
  return (
    `la fusion ne ferme PAS ${refs.map((n) => `#${n}`).join(", ")} (base hors branche par défaut) — après fusion :\n` +
    refs
      .map(
        (n) =>
          `     node .claude/skills/nodefony-ticket/scripts/ticket-close.mjs ${n}   (compte rendu, puis --close)`,
      )
      .join("\n")
  );
}

/** Pied de rupture (Conventional Commits 1.0.0, règles 12 et 16). */
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: \S/u;
/** Pied de fermeture d'un ticket, mot-clé GitHub. */
const CLOSING_FOOTER = /^(?:Closes|Fixes|Resolves) #\d+$/u;

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

/**
 * Ce que l'état de fusion dit SANS interdire — PUR. `DIRTY` (conflit) est un
 * refus de {@link finishBlockers} ; les autres états se disent, sinon le geste
 * suivant surprend (revue #796, B2).
 *
 * @param {{ mergeStateStatus: string, base: string }} pr
 * @returns {string[]}
 */
export function finishNotices({ mergeStateStatus, base }) {
  switch (mergeStateStatus) {
    case "BEHIND":
      return [
        `la base ${base} a avancé depuis la branche : la CI a jugé l'ANCIENNE base.\n` +
          `   → recommandé : git fetch && git merge origin/${base}, pousser (jamais de rebase d'une branche poussée)`,
      ];
    case "BLOCKED":
      return [
        "fusion BLOQUÉE par la protection de la base (checks ou approbation exigés) : la fusion automatique attendra qu'ils soient satisfaits",
      ];
    case "UNSTABLE":
      return [
        "des checks NON exigés sont rouges ou encore en cours : la surveillance attendra la fin et s'arrêtera au premier rouge — les lire (gh pr checks)",
      ];
    case "UNKNOWN":
      return [
        "GitHub calcule encore l'état de fusion (UNKNOWN) : si un refus suit, relancer dans une minute",
      ];
    default:
      return [];
  }
}

/**
 * Compte les checks EXIGÉS d'une base — PUR. Deux sources, cumulées : la
 * protection classique et les RULESETS (`rules/branches/<base>`), qui l'ont
 * remplacée chez GitHub. Ne lire que la première laissait `--auto` fusionner
 * tout de suite sous un ruleset (revue #796, B3).
 *
 * @param {{ protection: number | null, rules: Array<{ type?: string, parameters?: { required_status_checks?: unknown[] } }> }} facts -
 *   `protection` = checks exigés par la protection classique, `null` si absente
 * @returns {number | null} `null` = ni protection ni règle de checks
 */
export function countRequiredChecks({ protection, rules }) {
  const fromRules = rules
    .filter((r) => r.type === "required_status_checks")
    .reduce(
      (n, r) => n + (r.parameters?.required_status_checks?.length ?? 0),
      0,
    );
  const hasRule = rules.some((r) => r.type === "required_status_checks");
  if (protection === null && !hasRule) return null;
  return (protection ?? 0) + fromRules;
}

/** Les checks exigés par la protection classique d'une branche, ou `null` si elle n'est pas protégée. */
function protectionChecksOf(base) {
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

/** Les checks exigés d'une base, protection classique ET rulesets ({@link countRequiredChecks}). */
function requiredChecksOf(base) {
  const rules = JSON.parse(
    sh("gh", [
      "api",
      `repos/${REPO}/rules/branches/${encodeURIComponent(base)}`,
    ]) || "[]",
  );
  return countRequiredChecks({
    protection: protectionChecksOf(base),
    rules: Array.isArray(rules) ? rules : [],
  });
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
  const viewPr = () =>
    JSON.parse(
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
  let pr = viewPr();
  if (pr.state !== "OPEN")
    throw new Error(`PR #${pr.number} n'est pas ouverte (${pr.state})`);
  // 🔴 Pousser AVANT de juger : la PR lue avant le push portait l'ancienne
  // tête — message de squash sans les derniers commits, surveillance sur des
  // checks périmés (revue #796, B1). Puis relire.
  if (
    !dryRun &&
    sh("git", ["branch", "--show-current"]) === pr.headRefName &&
    sh("git", ["rev-parse", "HEAD"]) !== pr.headRefOid
  ) {
    // Sortie en direct : le crochet `pre-push` rebâtit et parle beaucoup — en
    // tube, il saturerait le tampon d'execFileSync (1 Mo) (revue #796, R5).
    if (
      spawnSync("git", ["push"], { cwd: ROOT, stdio: "inherit" }).status !== 0
    )
      throw new Error(
        "git push refusé — lire la sortie ci-dessus, puis relancer",
      );
    pr = viewPr();
  }

  // Les ancêtres se constatent sur les références DISTANTES, tête de PR comprise.
  sh("git", ["fetch", "origin", "--prune", "--quiet"]);
  sh("git", ["fetch", "origin", "--quiet", pr.headRefOid]);
  // Le message ENTIER, lu dans git : `messageHeadline` de l'API est TRONQUÉ
  // (« … » au-delà de ~70 caractères) — le changelog recevrait des entrées coupées.
  const commitMessages = pr.commits.map((c) =>
    sh("git", ["log", "-1", "--format=%B", c.oid]),
  );
  // Une fusion de la base dans la branche n'est pas du travail de la PR.
  const isMerge = (oid) =>
    sh("git", ["rev-list", "--no-walk", "--parents", oid]).split(" ").length >
    2;
  // Le périmètre publié, par commit : MÊME règle que le changelog.
  const published = perimetrePublie(
    releasableWorkspaces(ROOT).map((w) => ({
      location: w.location,
      pkg: JSON.parse(
        readFileSync(path.join(ROOT, w.location, "package.json"), "utf8"),
      ),
    })),
  );
  const message = squashMessage({
    ...pr,
    commits: pr.commits
      .map((c, i) => ({ c, message: commitMessages[i] ?? "" }))
      .filter(({ c }) => !isMerge(c.oid))
      .map(({ c, message }) => ({
        message,
        published: sh("git", ["show", "--name-only", "--format=", c.oid])
          .split("\n")
          .filter(Boolean)
          .some(published),
      })),
  });
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
  for (const n of finishNotices({
    mergeStateStatus: pr.mergeStateStatus,
    base: pr.baseRefName,
  }))
    console.log(`ℹ️ ${n}`);

  if (argv.includes("--merge-when-green")) {
    mergeWhenGreen(pr.number, message, closeReminder(pr));
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
    // Le message de squash EST le commit que lira le changelog : le montrer.
    console.log(
      `  message de squash :\n    ${message.subject}\n\n${message.body.replace(/^/gmu, "    ")}`,
    );
    if (plan.mode === "watch")
      console.log(`  commande : ${watchCommand(pr.number)}`);
    const reminder = closeReminder(pr);
    if (reminder) console.log(`  ⚠️ ${reminder}`);
    return;
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
    const reminder = closeReminder(pr);
    if (reminder) console.log(`  ⚠️ ${reminder}`);
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
 * @param {string | null} reminder - rappel de fermeture ({@link closeReminder})
 */
function mergeWhenGreen(number, message, reminder) {
  const checks = spawnSync(
    "gh",
    ["pr", "checks", String(number), "--repo", REPO, "--watch", "--fail-fast"],
    { cwd: ROOT, stdio: "inherit" },
  );
  if (checks.status !== 0)
    throw new Error(
      `PR #${number} : checks NON verts — rien n'est fusionné.\n` +
        `   Lire les rouges : gh pr checks ${number} --repo ${REPO}\n` +
        "   · job INSTABLE (réseau, délai, course) → gh run rerun <id du run> --failed, puis relancer pr-finish --merge-when-green\n" +
        "   · VRAI défaut → corriger sur la branche, pousser, relancer pr-finish",
    );
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
  if (reminder) console.log(`⚠️ ${reminder}`);
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
