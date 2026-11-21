/**
 * Ce que la reprise dit de la BRANCHE — règles pures, éprouvées sans réseau.
 *
 * Depuis le travail en demandes de fusion (#796), « où en est-on » ne se lit
 * plus sur `dev` : la session est sur une branche de travail, avec sa PR, sa
 * CI et ses fichiers déjà touchés — ou sur une branche longue, où rien ne doit
 * s'écrire. Et ce qui s'est passé PENDANT qu'on travaillait ailleurs (une CI
 * finie, une PR fusionnée dont le ticket reste ouvert parce que `Closes` ne
 * mord pas vers `release/*`) doit remonter à la reprise : personne ne l'a
 * attendu au premier plan, c'est voulu.
 */
import { referencedIssues } from "../../nodefony-ticket/scripts/pr-complete.mjs";

/**
 * Dit si une branche est LONGUE — `main`, `dev`, `release/x.y.x` — donc fermée aux commits de travail.
 *
 * @param {string} branch
 * @returns {boolean}
 */
export const isLongBranch = (branch) =>
  branch === "main" ||
  branch === "dev" ||
  /^release\/\d+\.\d+\.x$/u.test(branch);

/**
 * Le verdict des checks d'une PR (`statusCheckRollup` de `gh pr list`).
 *
 * Un check annulé n'est pas rouge (une PR remplace son propre run) ; un check
 * sans conclusion est en cours.
 *
 * @param {{ name?: string, context?: string, status?: string, conclusion?: string, state?: string }[]} rollup
 * @returns {{ icon: string, red: string[], pending: number, total: number }}
 */
export function checksVerdict(rollup = []) {
  const RED = new Set(["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ERROR"]);
  const red = [];
  let pending = 0;
  for (const c of rollup) {
    const verdict = c.conclusion || c.state || "";
    if (RED.has(verdict)) red.push(c.name ?? c.context ?? "?");
    else if (
      (c.status && c.status !== "COMPLETED") ||
      verdict === "PENDING" ||
      verdict === ""
    )
      pending += 1;
  }
  const icon = red.length
    ? "❌"
    : pending
      ? "⏳"
      : rollup.length
        ? "✅"
        : "· aucun check";
  return { icon, red, pending, total: rollup.length };
}

/**
 * Résumé d'un `git diff --numstat` : nombre de fichiers, lignes, et les plus touchés.
 *
 * @param {string} numstat - sortie brute (`ajouts\tretraits\tchemin` par ligne ; `-` pour un binaire)
 * @param {number} [top] - combien de fichiers nommer
 * @returns {string}
 */
export function diffSummary(numstat, top = 5) {
  const rows = numstat
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [a, d, ...p] = l.split("\t");
      return {
        file: p.join("\t"),
        added: Number(a) || 0,
        removed: Number(d) || 0,
      };
    });
  if (!rows.length) return "aucun fichier modifié";
  const added = rows.reduce((s, r) => s + r.added, 0);
  const removed = rows.reduce((s, r) => s + r.removed, 0);
  const most = [...rows]
    .sort((x, y) => y.added + y.removed - (x.added + x.removed))
    .slice(0, top)
    .map((r) => r.file.split("/").pop());
  return `${rows.length} fichier(s), +${added} −${removed} · plus touchés : ${most.join(", ")}`;
}

/**
 * Les lignes « branche et PR » de la reprise.
 *
 * @param {object} s
 * @param {string} s.branch - branche courante
 * @param {{ number: number, isDraft: boolean, baseRefName: string, url: string, statusCheckRollup?: object[] } | null} s.pr - la PR ouverte de la branche
 * @param {{ ahead: number, behind: number } | null} s.vsBase - avance/retard sur `origin/<base>`
 * @param {boolean} s.pushed - la branche a-t-elle un amont à jour ?
 * @param {string} s.diff - `diffSummary` de la branche contre sa base
 * @param {number} s.dirty - fichiers non commités
 * @param {{ number: number, headRefName: string }[]} s.parked - PR en brouillon des AUTRES branches
 * @param {{ number: number, baseRefName: string } | null} [s.merged] - la PR FUSIONNÉE de
 *   cette branche, s'il y en a une : la branche est FINIE, et la rouvrir par
 *   `ticket-start` y empilerait un second ticket sur un historique déjà squashé
 * @returns {string[]}
 */
export function branchLines({
  branch,
  pr,
  vsBase,
  pushed,
  diff,
  dirty,
  parked,
  merged = null,
}) {
  const lines = [];
  if (isLongBranch(branch)) {
    lines.push(
      `🌿 ${branch} = branche LONGUE — aucune branche de travail : \`ticket-start.mjs <N> --slug <sujet>\` avant tout code`,
    );
  } else if (!pr && merged) {
    lines.push(
      `🌿 ${branch} — PR #${merged.number} FUSIONNÉE dans ${merged.baseRefName} : branche FINIE → ` +
        `git switch ${merged.baseRefName} && git pull --ff-only && git branch -D ${branch}` +
        (dirty
          ? ` · ⚠️ non commités : ${dirty} — à reporter sur une branche neuve (ticket-start) AVANT`
          : ""),
    );
  } else if (!pr) {
    lines.push(
      `🌿 ${branch} — AUCUNE PR ouverte : \`ticket-start.mjs <N>\` l'ouvre (il reprend la branche existante)`,
    );
  } else {
    const v = checksVerdict(pr.statusCheckRollup);
    lines.push(
      `🌿 ${branch} → ${pr.baseRefName}${vsBase ? ` · +${vsBase.ahead}/−${vsBase.behind} sur origin/${pr.baseRefName}` : ""}${pushed ? "" : " · NON poussée ⚠️"}`,
    );
    lines.push(
      `   PR #${pr.number} ${pr.isDraft ? "brouillon" : "prête"} ${v.icon}${v.red.length ? ` rouge : ${v.red.slice(0, 3).join(", ")}${v.red.length > 3 ? "…" : ""}` : v.pending ? ` ${v.pending}/${v.total} en cours` : ""} ${pr.url}`,
    );
    lines.push(`   ${diff}${dirty ? ` · non commités : ${dirty}` : ""}`);
  }
  if (parked.length) {
    lines.push(
      `🅿️ Mis de côté (PR brouillon) : ${parked
        .slice(0, 6)
        .map((p) => `#${p.number} ${p.headRefName}`)
        .join(" · ")}`,
    );
  }
  return lines;
}

/**
 * Les tickets restés ouverts après la fusion de leurs PR — UNE entrée par
 * ticket, toutes ses PR fusionnées nommées.
 *
 * Vers `release/*`, `Closes` ne ferme rien : sans cette ligne, un ticket livré
 * resterait ouvert jusqu'à ce que quelqu'un s'en souvienne. Mais une PR
 * fusionnée ne prouve pas que le ticket est SOLDÉ : un ticket peut se livrer en
 * plusieurs PR (vécu #796 : #805 et #807 fusionnées, un « Reste » de six
 * points). Le rappel ne tranche donc pas — il dit « fermer si le reste est
 * soldé » — et se tait quand une PR OUVERTE porte encore le ticket : le
 * travail continue.
 *
 * @param {{ number: number, body?: string, headRefName?: string }[]} merged - PR fusionnées récentes
 * @param {{ number: number, state?: string }[]} items - items de l'empreinte du tableau
 * @param {{ number: number, body?: string, headRefName?: string }[]} [openPrs] - PR ouvertes
 * @returns {{ ticket: number, prs: number[] }[]} dans l'ordre de première apparition
 */
export function mergedButOpen(merged, items, openPrs = []) {
  const open = new Set(
    items.filter((i) => i.state === "OPEN").map((i) => i.number),
  );
  const inProgress = new Set(openPrs.flatMap((pr) => referencedIssues(pr)));
  /** @type {Map<number, number[]>} */
  const byTicket = new Map();
  for (const pr of merged)
    for (const ticket of referencedIssues(pr)) {
      if (!open.has(ticket) || inProgress.has(ticket)) continue;
      const prs = byTicket.get(ticket);
      if (prs === undefined) byTicket.set(ticket, [pr.number]);
      else if (!prs.includes(pr.number)) prs.push(pr.number);
    }
  return [...byTicket].map(([ticket, prs]) => ({ ticket, prs }));
}
