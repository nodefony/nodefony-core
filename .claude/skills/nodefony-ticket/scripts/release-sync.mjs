#!/usr/bin/env node
/**
 * Rapatrie une branche de maintenance dans `dev` par une PR fusionnée en COMMIT DE FUSION.
 *
 * POURQUOI
 *
 * Les correctifs se font sur `release/x.y.x`, puis « remontent » vers `dev`
 * (git, `gitworkflows` : « commit your fixes to the oldest supported branch…
 * then merge upwards »). Cette fusion arrière porte l'estampille et le
 * changelog du x.y.z publié : sans elle, la mineure suivante part sans eux, et
 * `release.mjs` refuse de publier depuis `dev` (`refusDeMaintenance`, D9 de #796).
 *
 * POURQUOI UN COMMIT DE FUSION, JAMAIS UN SQUASH
 *
 * Un squash recopie les changements sous une empreinte NEUVE : `release/x.y.x`
 * ne devient pas ancêtre de `dev`, la garde de publication continue de
 * refuser, et la fusion suivante rejoue les mêmes conflits. `pr-finish.mjs`,
 * qui squashe un ticket, refuse donc une PR qui porte une `release/*`
 * ({@link carriedReleases}) et renvoie ici.
 *
 * POURQUOI `origin/main` D'ABORD
 *
 * `main` reçoit des commits que `release/x.y.x` n'a pas (le job `accueil` de la
 * publication peut y commiter). Les fusionner d'abord garde `dev:main` en
 * avance rapide pour la mineure suivante.
 *
 * Idempotent : relancé après un conflit résolu et commité, il reprend la
 * branche existante, fusionne ce qui manque, pousse, et retrouve sa PR.
 *
 * @usage node .claude/skills/nodefony-ticket/scripts/release-sync.mjs [release/x.y.x] [--dry-run]
 * @usage node .claude/skills/nodefony-ticket/scripts/release-sync.mjs --merge-when-green <PR>   (la surveillance, en arrière-plan)
 * @option --dry-run  dit ce qui serait fusionné, sans rien modifier
 * @option --merge-when-green  attend les checks (arrêt au premier rouge) puis fusionne en commit de fusion
 * @requires gh authentifié ; arbre propre ; branche courante sans commit non poussé
 * @output la branche, les références fusionnées, la PR et la commande de surveillance
 */
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { guardCli } from "../../nodefony-session/scripts/cli-guard.mjs";

const REPO = "nodefony/nodefony-core";
const TARGET = "dev";
const MAINTENANCE = /^release\/\d+\.\d+\.x$/u;

/**
 * La branche de maintenance à rapatrier — PURE.
 *
 * @param {string[]} remote - branches distantes, `origin/` retiré
 * @param {string | undefined} asked - nom passé en argument
 * @returns {string}
 * @throws sans branche de maintenance, sur un nom inconnu, ou sur plusieurs sans choix
 */
export function pickMaintenance(remote, asked) {
  const all = remote.filter((b) => MAINTENANCE.test(b));
  if (asked) {
    if (!all.includes(asked))
      throw new Error(
        `${asked} n'est pas une branche de maintenance distante (${all.join(", ") || "aucune"})`,
      );
    return asked;
  }
  if (all.length === 0)
    throw new Error("aucune branche release/x.y.x distante — rien à rapatrier");
  if (all.length > 1)
    throw new Error(
      `plusieurs branches de maintenance (${all.join(", ")}) — nommer celle à rapatrier`,
    );
  return all[0];
}

/**
 * Le nom de la branche de fusion : `chore/merge-release-10.0.x`.
 *
 * Sans numéro de ticket : une fusion arrière n'est le travail d'aucun ticket,
 * et `ticketOfBranch` n'y lit donc rien à mettre en cours.
 *
 * @param {string} maintenance - `release/x.y.x`
 * @returns {string}
 */
export function syncBranchName(maintenance) {
  return `chore/merge-${maintenance.replace("/", "-")}`;
}

/**
 * Comment partir sur la branche de fusion — PURE : les faits sont constatés.
 *
 * Une branche locale du même nom a deux vies possibles. Fusion arrière en
 * cours (conflit résolu et commité, pas encore poussé) : elle porte des commits
 * que `dev` n'a pas, on la REPREND. Fusion arrière d'une publication passée,
 * déjà fusionnée (commit de fusion, donc ancêtre de `dev`) : elle est PÉRIMÉE —
 * la reprendre ferait partir la nouvelle fusion d'un `dev` d'un autre jour, on
 * la RECRÉE depuis `origin/dev`, sans rien perdre puisque `dev` contient tout.
 *
 * @param {{ current: boolean, exists: boolean, inTarget: boolean }} facts -
 *   est-on déjà dessus ? existe-t-elle en local ? est-elle ancêtre de `origin/dev` ?
 * @returns {"stay" | "resume" | "recreate" | "create"}
 */
export function syncStart({ current, exists, inTarget }) {
  if (exists && inTarget) return "recreate";
  if (current) return "stay";
  return exists ? "resume" : "create";
}

/**
 * Ce que devient la copie LOCALE de la branche d'une PR qui vient d'être fusionnée — PURE.
 *
 * `gh pr merge --delete-branch --repo …` supprime la branche sur GitHub, jamais
 * la copie locale : `--repo` coupe gh de l'arbre de travail. Elle restait donc,
 * et le graphe de l'auteur se chargeait de branches mortes (#796). Une fusion
 * en squash crée une empreinte NEUVE : `git branch -d` refuse, il faut `-D` —
 * un geste destructeur, qui n'est permis que sur une identité prouvée : la tête
 * locale ÉGALE celle que GitHub a fusionnée. Un commit local de plus (ou une
 * tête différente) et la branche est gardée, en le disant.
 *
 * @param {{ head: string, base: string, current: string, dirty: boolean,
 *   localTip: string | null, mergedTip: string }} facts - branche de la PR,
 *   sa base, la branche courante, l'arbre est-il sale, tête de la copie locale
 *   (`null` si absente), tête fusionnée par GitHub
 * @returns {{ switchTo: string | null, deleteLocal: boolean, reason: string }}
 */
export function localCleanupPlan({
  head,
  base,
  current,
  dirty,
  localTip,
  mergedTip,
}) {
  const keep = (reason) => ({ switchTo: null, deleteLocal: false, reason });
  if (localTip === null) return keep(`aucune copie locale de ${head}`);
  if (localTip !== mergedTip)
    return keep(
      `${head} locale (${localTip.slice(0, 9)}) n'est pas la tête fusionnée (${mergedTip.slice(0, 9)}) — gardée ; la supprimer à la main après vérification : git branch -D ${head}`,
    );
  if (current !== head)
    return { switchTo: null, deleteLocal: true, reason: `${head} supprimée` };
  if (dirty)
    return keep(
      `${head} est la branche courante et l'arbre n'est pas propre — gardée ; commiter ou ranger, puis : git switch ${base} && git branch -D ${head}`,
    );
  return {
    switchTo: base,
    deleteLocal: true,
    reason: `retour sur ${base}, ${head} supprimée`,
  };
}

/**
 * Les références à fusionner, dans l'ordre — PURE : les ancêtres sont constatés.
 *
 * @param {string} maintenance - `release/x.y.x`
 * @param {{ mainInTarget: boolean, maintenanceInTarget: boolean }} facts -
 *   `origin/main` et `origin/<maintenance>` déjà ancêtres de `origin/dev` ?
 * @returns {string[]} vide = rien à rapatrier
 */
export function syncPlan(maintenance, { mainInTarget, maintenanceInTarget }) {
  if (maintenanceInTarget && mainInTarget) return [];
  const refs = [];
  if (!mainInTarget) refs.push("origin/main");
  if (!maintenanceInTarget) refs.push(`origin/${maintenance}`);
  return refs;
}

/**
 * Titre et corps de la PR de fusion arrière — PURS.
 *
 * @param {string} maintenance - `release/x.y.x`
 * @param {string[]} refs - les références fusionnées
 * @returns {{ title: string, body: string }}
 */
export function syncPr(maintenance, refs) {
  return {
    title: `chore(release): rapatrier ${maintenance} dans ${TARGET}`,
    body: [
      `Fusion arrière de \`${maintenance}\` dans \`${TARGET}\` : les correctifs publiés, leur estampille et leur changelog rejoignent la prochaine mineure.`,
      "",
      `Fusionné : ${refs.map((r) => `\`${r}\``).join(" puis ")}.`,
      "",
      `⚠️ **Fusion par COMMIT DE FUSION** (\`release-sync.mjs --merge-when-green\`), jamais en squash : un squash laisserait \`${maintenance}\` hors des ancêtres de \`${TARGET}\`, et la publication suivante serait refusée (D9, #796).`,
    ].join("\n"),
  };
}

/**
 * Les branches de maintenance qu'une PR EMBARQUE — PURE : les ancêtres sont constatés.
 *
 * Une `release/*` est embarquée quand elle est ancêtre de la tête sans l'être
 * de la base. Une PR vers `release/x.y.x` partie de cette même branche ne
 * l'embarque donc pas ; une branche de ticket partie de `dev` après la
 * fusion arrière non plus.
 *
 * @param {Array<{ name: string, inHead: boolean, inBase: boolean }>} releases
 * @returns {string[]}
 */
export function carriedReleases(releases) {
  return releases.filter((r) => r.inHead && !r.inBase).map((r) => r.name);
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
 * Dit si `ancestor` est ancêtre de `ref` (ou lui est égal) dans le dépôt local.
 *
 * @param {string} ancestor
 * @param {string} ref
 * @returns {boolean}
 */
export function isAncestor(ancestor, ref) {
  return (
    spawnSync("git", ["merge-base", "--is-ancestor", ancestor, ref], {
      cwd: ROOT,
    }).status === 0
  );
}

/**
 * Applique {@link localCleanupPlan} après une fusion : retour sur la base mise à
 * jour si l'on était sur la branche fusionnée, puis suppression de sa copie locale.
 *
 * @param {{ head: string, base: string, mergedTip: string }} pr - branche de
 *   la PR, sa base, tête fusionnée par GitHub
 */
export function cleanupLocalBranch({ head, base, mergedTip }) {
  const tip = spawnSync(
    "git",
    ["rev-parse", "--verify", "--quiet", `refs/heads/${head}`],
    { cwd: ROOT, encoding: "utf8" },
  );
  const plan = localCleanupPlan({
    head,
    base,
    current: sh("git", ["branch", "--show-current"]),
    dirty: sh("git", ["status", "--porcelain"]) !== "",
    localTip: tip.status === 0 ? tip.stdout.trim() : null,
    mergedTip,
  });
  if (plan.switchTo) {
    sh("git", ["fetch", "origin", "--prune", "--quiet"]);
    // `git switch <base>` crée la locale depuis `origin/<base>` si elle manque.
    sh("git", ["switch", plan.switchTo]);
    const ff = spawnSync(
      "git",
      ["merge", "--ff-only", "--quiet", `origin/${plan.switchTo}`],
      { cwd: ROOT, encoding: "utf8" },
    );
    if (ff.status !== 0)
      console.log(
        `  ⚠️ ${plan.switchTo} locale a divergé d'origin — non avancée : git merge --ff-only origin/${plan.switchTo} à instruire`,
      );
  }
  if (plan.deleteLocal) sh("git", ["branch", "-D", head]);
  console.log(`  branche locale : ${plan.reason}`);
}

/** Les branches `release/*` distantes, `origin/` retiré — après un `git fetch`. */
export function remoteMaintenance() {
  return sh("git", ["branch", "-r", "--format=%(refname:short)"])
    .split("\n")
    .filter((b) => b.startsWith("origin/"))
    .map((b) => b.slice("origin/".length))
    .filter((b) => MAINTENANCE.test(b));
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--merge-when-green")) {
    const n = argv.find((a) => /^\d+$/u.test(a));
    if (!n) throw new Error("--merge-when-green exige le numéro de la PR");
    mergeWhenGreen(Number(n));
    return;
  }
  const dryRun = argv.includes("--dry-run");
  const asked = argv.find((a) => a.startsWith("release/"));

  const dirty = sh("git", ["status", "--porcelain"]) !== "";
  if (dirty && !dryRun)
    throw new Error("arbre non propre — commiter (et pousser) d'abord");
  // Quitter une branche aux commits non poussés les laisse sans CI ni PR, sans
  // un mot : on refuse plutôt que de changer de branche par-dessus.
  const upstream = spawnSync(
    "git",
    ["rev-list", "--count", "@{upstream}..HEAD"],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (upstream.status === 0 && upstream.stdout.trim() !== "0" && !dryRun)
    throw new Error(
      `la branche courante a ${upstream.stdout.trim()} commit(s) non poussé(s) — git push d'abord`,
    );

  sh("git", ["fetch", "origin", "--prune", "--quiet"]);
  const maintenance = pickMaintenance(remoteMaintenance(), asked);
  const refs = syncPlan(maintenance, {
    mainInTarget: isAncestor("origin/main", `origin/${TARGET}`),
    maintenanceInTarget: isAncestor(
      `origin/${maintenance}`,
      `origin/${TARGET}`,
    ),
  });
  if (!refs.length) {
    console.log(
      `${maintenance} et main sont déjà dans ${TARGET} — rien à rapatrier`,
    );
    return;
  }
  const name = syncBranchName(maintenance);
  const pr = syncPr(maintenance, refs);
  console.log(
    `${maintenance} → ${TARGET}\n  branche ${name}\n  à fusionner : ${refs.join(" puis ")}`,
  );
  if (dryRun) {
    if (dirty) console.log("⚠️ arbre non propre — le geste réel le REFUSERA");
    console.log(`\n— ${pr.title} —\n${pr.body}`);
    return;
  }

  const local = sh("git", ["branch", "--format=%(refname:short)"]).split("\n");
  const start = syncStart({
    current: sh("git", ["branch", "--show-current"]) === name,
    exists: local.includes(name),
    inTarget: local.includes(name) && isAncestor(name, `origin/${TARGET}`),
  });
  if (start === "resume") sh("git", ["switch", name]);
  else if (start === "create")
    sh("git", ["switch", "-c", name, "--no-track", `origin/${TARGET}`]);
  else if (start === "recreate") {
    // `-C` sur la branche courante comprise : l'arbre est propre (refusé plus haut).
    sh("git", ["switch", "-C", name, "--no-track", `origin/${TARGET}`]);
    console.log(
      `  ${name} locale était PÉRIMÉE (déjà dans ${TARGET}) — recréée depuis origin/${TARGET}`,
    );
  }
  for (const ref of refs) {
    const r = spawnSync("git", ["merge", "--no-ff", "--no-edit", ref], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (r.status !== 0)
      throw new Error(
        `conflit en fusionnant ${ref} :\n${(r.stdout + r.stderr).trim()}\n` +
          "  → résoudre, `git add` les fichiers, `git commit --no-edit`, puis relancer ce script",
      );
  }
  sh("git", ["push", "-u", "origin", name]);

  const open = JSON.parse(
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
      "number,url",
    ]),
  )[0];
  const number =
    open?.number ??
    Number(
      sh("gh", [
        "pr",
        "create",
        "--repo",
        REPO,
        "--base",
        TARGET,
        "--head",
        name,
        "--title",
        pr.title,
        "--body",
        pr.body,
      ])
        .split("/")
        .pop(),
    );
  console.log(
    `  PR #${number} ${open?.url ?? `https://github.com/${REPO}/pull/${number}`}\n` +
      `  à lancer EN ARRIÈRE-PLAN :\n    node .claude/skills/nodefony-ticket/scripts/release-sync.mjs --merge-when-green ${number}`,
  );
}

/**
 * La surveillance : attend les checks (arrêt au premier rouge), puis fusionne
 * en COMMIT DE FUSION — arguments passés un par un, jamais par un shell.
 *
 * @param {number} number - numéro de la PR
 */
function mergeWhenGreen(number) {
  const pr = JSON.parse(
    sh("gh", [
      "pr",
      "view",
      String(number),
      "--repo",
      REPO,
      "--json",
      "title,baseRefName,headRefName,headRefOid",
    ]),
  );
  if (pr.baseRefName !== TARGET || !pr.headRefName.startsWith("chore/merge-"))
    throw new Error(
      `PR #${number} (${pr.headRefName} → ${pr.baseRefName}) n'est pas une fusion arrière de release-sync`,
    );
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
    "--merge",
    "--delete-branch",
    "--subject",
    `${pr.title} (#${number})`,
  ]);
  console.log(`PR #${number} fusionnée (commit de fusion) — ${pr.title}`);
  cleanupLocalBranch({
    head: pr.headRefName,
    base: pr.baseRefName,
    mergedTip: pr.headRefOid,
  });
}

if (process.argv[1]?.endsWith("release-sync.mjs")) {
  guardCli(import.meta.url);
  try {
    main();
  } catch (e) {
    const err = /** @type {{ message?: string, stderr?: string }} */ (e);
    console.error(`✗ ${String(err.stderr || err.message || e).trim()}`);
    process.exit(1);
  }
}
