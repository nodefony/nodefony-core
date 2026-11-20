#!/usr/bin/env node
/**
 * Entame (ou reprend) un ticket : sa branche de travail, sa PR en brouillon, son statut « En cours ».
 *
 * POURQUOI UN SCRIPT
 *
 * Depuis la 10.0.0, rien ne s'écrit directement sur une branche longue : `dev`
 * reçoit la prochaine mineure, `release/x.y.x` les correctifs de la version
 * publiée. Choisir la base, nommer la branche, ouvrir la PR AVANT tout code :
 * cinq décisions qu'un agent oublie au premier ticket — et un correctif de la
 * 10.0.x qui part de `dev` embarque la 10.1 dans un patch. Les décisions sont
 * celles de #796 ; ce script les rend impossibles à oublier.
 *
 * IDEMPOTENT : relancé sur un ticket qui a déjà sa branche, il s'y place et
 * ouvre la PR qui manque — c'est aussi le geste « reprendre un ticket mis de
 * côté ». Il ne crée jamais une seconde branche pour le même ticket.
 *
 * Il ne touche JAMAIS à un arbre sale : changer de branche par-dessus du travail
 * non commité le transporte ailleurs, ou le perd. Mettre de côté = commit
 * `<type>(<scope>): wip — <ce qui reste> [skip ci]`, poussé — jamais `stash`.
 *
 * @usage node .claude/skills/nodefony-ticket/scripts/ticket-start.mjs <N> --slug <sujet-en-anglais>
 * @usage node .claude/skills/nodefony-ticket/scripts/ticket-start.mjs <N>            (reprise d'une branche existante)
 * @usage node .claude/skills/nodefony-ticket/scripts/ticket-start.mjs <N> --slug <sujet> --dry-run
 * @option --slug     sujet de la branche : anglais, kebab-case ASCII, 40 caractères au plus
 * @option --dry-run  rend le plan (branche, base, corps de PR) sans rien créer
 * @requires gh authentifié, droits d'écriture sur le dépôt et le tableau ; arbre propre
 * @output la branche, sa base, la PR, et ce qui reste à faire à la main
 */
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { guardCli } from "../../nodefony-session/scripts/cli-guard.mjs";
import { readInstallDrift } from "../../nodefony-session/scripts/install-drift.mjs";
import { BRANCH_TYPES, ticketOfBranch } from "./commit-kind.mjs";
import { markInProgress } from "./ticket-progress.mjs";
import {
  clotMaintenance,
  estJalonDeCorrectif,
} from "../../../../scripts/release/release-core.mjs";

const REPO = "nodefony/nodefony-core";

/**
 * Le préfixe Conventional Commits d'un titre de ticket.
 *
 * @param {string} title - `type(scope)!: description`
 * @returns {{ type: string, scope: string | null }}
 * @throws quand le titre ne commence pas par un type admis
 */
export function commitPrefix(title) {
  const m = /^([a-z]+)(?:\(([^)]+)\))?!?:\s/u.exec(title);
  if (!m || !BRANCH_TYPES.includes(m[1])) {
    throw new Error(
      `titre hors Conventional Commits (${BRANCH_TYPES.join(", ")}) : « ${title} » — le corriger d'abord (skill nodefony-ticket §1)`,
    );
  }
  return { type: m[1], scope: m[2] ?? null };
}

/**
 * Le nom de la branche de travail : `<type>/<N>-<sujet>`.
 *
 * Le sujet voyage dans les URL, la CI et le terminal, comme un identifiant de
 * code : anglais, kebab-case ASCII, 40 caractères au plus.
 *
 * @param {string} title - titre du ticket (donne le type)
 * @param {number} n - numéro du ticket
 * @param {string} slug - sujet en anglais
 * @returns {string}
 * @throws sur un sujet vide, non ASCII, hors kebab-case ou trop long
 */
export function branchName(title, n, slug) {
  const { type } = commitPrefix(title);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug ?? "")) {
    throw new Error(
      `sujet de branche invalide « ${slug ?? ""} » : anglais, minuscules ASCII et tirets (ex. http2-head-scope)`,
    );
  }
  if (slug.length > 40) {
    throw new Error(
      `sujet de branche trop long (${slug.length} > 40) : « ${slug} »`,
    );
  }
  return `${type}/${n}-${slug}`;
}

/**
 * La branche longue d'où part le ticket — décision 3 de #796.
 *
 * Jalon de CORRECTIF (`x.y.x`, ou `x.y.z` avec z ≥ 1) → `release/x.y.x` ; tout
 * autre jalon, backlog compris → `dev`. Une branche de maintenance absente est
 * une ERREUR, jamais un repli sur `dev` : le repli enverrait un correctif dans
 * la mineure suivante, sans un mot.
 *
 * Exception décidée sur #796 : l'OUTILLAGE DE PILOTAGE (scope `pilotage`) part
 * de la PLUS ANCIENNE branche de maintenance existante, quel que soit son jalon.
 * Les skills et scripts vivent dans le dépôt : livrés sur `dev` seul, chaque
 * ticket de correctif serait travaillé sans eux — là où une erreur de base coûte
 * le plus cher. La PR `release → dev` les y ramène.
 *
 * @param {string | null} milestone - titre du jalon du ticket
 * @param {string[]} remoteBranches - branches distantes, sans le préfixe `origin/`
 * @param {string | null} [scope] - scope du titre du ticket
 * @param {string | null} [mainVersion] - version que porte `origin/main` (dernière publiée)
 * @returns {string}
 * @throws quand le jalon exige une branche de maintenance absente, ou CLOSE
 */
export function baseFor(
  milestone,
  remoteBranches,
  scope = null,
  mainVersion = null,
) {
  // Une maintenance que `main` a dépassée (`release-core#clotMaintenance`) ne
  // peut plus rien publier : partir d'elle, c'est écrire un correctif qui ne
  // sortira jamais (#796, bloquant 3).
  const close = (b) => mainVersion !== null && clotMaintenance(mainVersion, b);
  if (scope === "pilotage") {
    const releases = remoteBranches
      .filter((b) => /^release\/\d+\.\d+\.x$/u.test(b) && !close(b))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    return releases[0] ?? "dev";
  }
  if (!estJalonDeCorrectif(milestone)) return "dev";
  const m = /^(\d+)\.(\d+)\./u.exec(milestone);
  const release = `release/${m[1]}.${m[2]}.x`;
  if (close(release)) {
    throw new Error(
      `jalon de correctif ${milestone}, mais la maintenance ${m[1]}.${m[2]}.x est CLOSE : main porte ${mainVersion}.\n` +
        `  Un correctif parti de ${release} ne pourrait plus être publié.\n` +
        `  → déplacer le ticket vers le jalon de la mineure suivante (il partira de dev), et supprimer ${release} (D8).`,
    );
  }
  if (!remoteBranches.includes(release)) {
    throw new Error(
      `jalon de correctif ${milestone}, mais aucune branche ${release} sur origin — la créer depuis le tag publié ; jamais de repli sur dev`,
    );
  }
  return release;
}

/**
 * Le corps de la PR en brouillon — décision 4 de #796.
 *
 * `Closes #N` ne mord que vers la branche PAR DÉFAUT ; vers `release/*`, il ne
 * relie ni ne ferme rien, d'où `Refs #N` et la consigne écrite.
 *
 * @param {number} n - numéro du ticket
 * @param {string} base - branche visée
 * @param {string} defaultBranch - branche par défaut du dépôt
 * @returns {string}
 */
export function prBody(n, base, defaultBranch) {
  const lines = [
    base === defaultBranch ? `Closes #${n}` : `Refs #${n}`,
    "",
    "Ouverte en brouillon par `ticket-start.mjs`, avant tout code. Passer en « prête » quand le ticket est fini ; fusion en squash.",
  ];
  if (base !== defaultBranch) {
    lines.push(
      "",
      `Vers \`${base}\`, GitHub ne relie ni ne ferme le ticket : fermer #${n} à la main après la fusion (\`ticket-close.mjs\`), et poser le lien « Development » depuis la colonne de droite du ticket.`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Le message du commit vide qui ouvre la branche.
 *
 * `gh pr create` refuse une branche sans commit d'écart ; ce commit vide le
 * fournit, et `[skip ci]` évite qu'ouvrir une PR coûte une CI complète. Le
 * squash l'efface à la fusion.
 *
 * @param {string} title - titre du ticket (donne type et scope)
 * @param {number} n - numéro du ticket
 * @returns {string}
 */
export function openingCommitMessage(title, n) {
  const { type, scope } = commitPrefix(title);
  return `${type}${scope ? `(${scope})` : ""}: ouvrir le travail sur #${n} [skip ci]`;
}

/**
 * Les branches existantes d'un ticket (`<type>/<N>-…`), locales ou distantes, sans doublon.
 *
 * @param {number} n - numéro du ticket
 * @param {string[]} branches - noms courts, `origin/` retiré
 * @returns {string[]}
 */
export function ticketBranches(n, branches) {
  return [...new Set(branches.filter((b) => ticketOfBranch(b) === n))].sort();
}

/**
 * Ce qui interdit de QUITTER la branche courante — PUR (revue #796, P2-13).
 *
 * Des commits qui ne sont sur aucune référence d'`origin` n'ont ni CI ni
 * sauvegarde : changer de branche les laisse derrière sans un mot, et le
 * marque-page d'un ticket mis de côté est un commit POUSSÉ.
 *
 * Une branche dont la PR est FUSIONNÉE se quitte toujours : le squash a une
 * autre empreinte et `--delete-branch` retire sa référence distante, donc
 * TOUS ses commits paraissent « non poussés » — et `git push` recréerait la
 * branche supprimée (revue #796, R2).
 *
 * @param {{ current: string, target: string, unpushed: number, merged?: boolean }} facts -
 *   `unpushed` = commits de HEAD absents de toute branche d'origin ;
 *   `merged` = la PR de la branche courante est fusionnée
 * @returns {string | null} le motif de refus, ou `null`
 */
export function leaveBlocker({ current, target, unpushed, merged = false }) {
  if (!current || current === target || unpushed === 0 || merged) return null;
  return (
    `${current} porte ${unpushed} commit(s) NON poussé(s) — les quitter les laisserait sans CI ni sauvegarde.\n` +
    "  → git push   (puis relancer la même commande)"
  );
}

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

/** La version que porte `origin/main` (la dernière publiée), ou `null` si illisible. */
function mainVersion() {
  try {
    return JSON.parse(
      sh("git", ["show", "origin/main:src/nodefony/package.json"]),
    ).version;
  } catch {
    return null;
  }
}

function sh(cmd, args) {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const n = Number(argv.find((a) => /^\d+$/u.test(a)));
  const slugAt = argv.indexOf("--slug");
  const slug = slugAt >= 0 ? argv[slugAt + 1] : undefined;
  if (!Number.isInteger(n) || n <= 0) {
    console.error(
      "usage : ticket-start.mjs <N> --slug <sujet-en-anglais> [--dry-run]",
    );
    process.exit(64);
  }

  const issue = JSON.parse(
    sh("gh", [
      "issue",
      "view",
      String(n),
      "--repo",
      REPO,
      "--json",
      "number,title,state,milestone,url",
    ]),
  );
  if (issue.state !== "OPEN") fail(`#${n} est fermé — rien à entamer`);

  const dirty = sh("git", ["status", "--porcelain"]);
  if (dirty && dryRun) {
    console.log(
      "⚠️ arbre non propre — le geste réel le REFUSERA (mettre de côté par un commit wip d'abord)",
    );
  } else if (dirty) {
    const { type, scope } = commitPrefix(issue.title);
    fail(
      "arbre non propre — rien n'est déplacé par-dessus du travail non commité.\n" +
        "  Mettre de côté le ticket en cours (jamais `stash`) :\n" +
        `    git add -A && git commit -m "<type>(<scope>): wip — <ce qui reste> [skip ci]" && git push\n` +
        `  (type et scope de SON ticket ; pour #${n} ce serait ${type}${scope ? `(${scope})` : ""})`,
    );
  }

  sh("git", ["fetch", "origin", "--prune", "--quiet"]);
  const remote = sh("git", ["branch", "-r", "--format=%(refname:short)"])
    .split("\n")
    .filter((b) => b.startsWith("origin/"))
    .map((b) => b.slice("origin/".length));
  const local = sh("git", ["branch", "--format=%(refname:short)"]).split("\n");
  const defaultBranch = JSON.parse(
    sh("gh", ["repo", "view", REPO, "--json", "defaultBranchRef"]),
  ).defaultBranchRef.name;
  const existing = ticketBranches(n, [...local, ...remote]);
  if (existing.length > 1) {
    fail(
      `#${n} a déjà plusieurs branches (${existing.join(", ")}) — en garder une à la main`,
    );
  }

  const milestone = issue.milestone?.title ?? null;
  const resuming = existing.length === 1;
  if (!resuming && !slug) {
    fail(
      `#${n} n'a pas encore de branche : --slug <sujet-en-anglais> est requis (ex. --slug http2-head-scope)`,
    );
  }
  const name = resuming ? existing[0] : branchName(issue.title, n, slug);
  const openPr = resuming
    ? JSON.parse(
        sh("gh", [
          "pr",
          "list",
          "--repo",
          REPO,
          "--head",
          name,
          "--state",
          "open",
          "--json",
          "number,url,baseRefName,isDraft",
        ]),
      )[0]
    : undefined;
  const base =
    openPr?.baseRefName ??
    baseFor(milestone, remote, commitPrefix(issue.title).scope, mainVersion());

  console.log(
    `#${n} ${issue.title}\n  jalon ${milestone ?? "aucun (backlog)"} → base ${base}\n  branche ${name}${resuming ? " (existante : reprise)" : " (neuve)"}`,
  );
  const current = sh("git", ["branch", "--show-current"]);
  const leave = leaveBlocker({
    current,
    target: name,
    merged:
      current !== "" &&
      sh("gh", [
        "pr",
        "list",
        "--repo",
        REPO,
        "--head",
        current,
        "--state",
        "merged",
        "--json",
        "number",
        "--jq",
        "length",
      ]) !== "0",
    unpushed: current
      ? Number(
          sh("git", [
            "rev-list",
            "--count",
            "HEAD",
            "--not",
            "--remotes=origin",
          ]),
        )
      : 0,
  });
  if (dryRun) {
    if (leave) console.log(`⚠️ le geste réel le REFUSERA : ${leave}`);
    console.log(
      `\n— corps de la PR —\n${prBody(n, base, defaultBranch)}\n— commit d'ouverture —\n${openingCommitMessage(issue.title, n)}`,
    );
    return;
  }

  if (leave) fail(leave);
  if (resuming) {
    if (current !== name) sh("git", ["switch", name]);
  } else {
    sh("git", ["switch", "-c", name, "--no-track", `origin/${base}`]);
  }
  // 🔴 L'installation se contrôle AVANT le commit et le push : le crochet
  // `pre-push` rebâtit, et sur une installation qui ne décrit pas le verrou de
  // la nouvelle base il échouait illisiblement (revue #796, G5). Le geste est
  // idempotent : relancé après `npm ci`, il reprend où il s'est arrêté.
  const drift = readInstallDrift(ROOT) ?? [];
  if (drift.length) {
    fail(
      `installation ≠ verrou de ${name} (${drift.length} écart(s)) — rien n'est encore poussé.\n` +
        `  → npm ci && npm run build, puis relancer : node .claude/skills/nodefony-ticket/scripts/ticket-start.mjs ${n}`,
    );
  }
  if (sh("git", ["rev-list", "--count", `origin/${base}..HEAD`]) === "0") {
    sh("git", [
      "commit",
      "--allow-empty",
      "-m",
      openingCommitMessage(issue.title, n),
    ]);
  }
  // Sortie en direct : le crochet `pre-push` rebâtit et parle beaucoup — en
  // tube, il saturerait le tampon d'execFileSync (1 Mo) (revue #796, R5).
  if (
    spawnSync("git", ["push", "-u", "origin", name], {
      cwd: ROOT,
      stdio: "inherit",
    }).status !== 0
  )
    fail(
      `git push de ${name} refusé — lire la sortie ci-dessus, puis relancer`,
    );

  let pr = openPr;
  if (!pr) {
    const url = sh("gh", [
      "pr",
      "create",
      "--repo",
      REPO,
      "--draft",
      "--base",
      base,
      "--head",
      name,
      "--title",
      issue.title,
      "--body",
      prBody(n, base, defaultBranch),
    ]);
    pr = { number: Number(url.split("/").pop()), url, isDraft: true };
  }
  console.log(
    `  PR #${pr.number}${pr.isDraft ? " (brouillon)" : ""} ${pr.url}`,
  );

  // Colonne de droite (responsable, jalon, lots, tableau) : la règle vit dans
  // pr-complete.mjs, on l'appelle — jamais recopiée.
  spawnSync(
    process.execPath,
    [
      path.join(ROOT, ".claude/skills/nodefony-ticket/scripts/pr-complete.mjs"),
      String(pr.number),
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  try {
    markInProgress([n]);
  } catch {
    console.log("  ⚠️ statut « In Progress » non posé (tableau injoignable)");
  }

  if (base !== defaultBranch) {
    console.log(
      `  ↪ à la main : lien « Development » depuis ${issue.url} (colonne de droite → Development → PR #${pr.number})`,
    );
  }
}

if (process.argv[1]?.endsWith("ticket-start.mjs")) {
  guardCli(import.meta.url);
  try {
    main();
  } catch (e) {
    const err = /** @type {{ message?: string, stderr?: string }} */ (e);
    fail(String(err.stderr || err.message || e).trim());
  }
}
