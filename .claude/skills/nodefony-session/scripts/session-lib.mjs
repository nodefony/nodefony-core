/**
 * Règles PURES de la reprise et de la clôture de session — sans réseau, sans
 * disque : `session-resume.mjs` et `session-end.mjs` les appellent, leurs tests
 * les éprouvent.
 *
 * Chacune remplace une consigne en prose que l'agent devait appliquer de tête,
 * et qu'il ratait : le garde-fou `_state` ↔ commits, la lecture de la CI par un
 * champ qui vaut `""` pendant un run, le jalon suivant imprimé à la place du
 * courant. Une règle calculée ne s'oublie pas.
 */

/** Hashes courts (≥ 7 hex) cités dans un texte — `49b5010a`, `d1930bea`. */
export function citedHashes(text) {
  return new Set(
    [...text.matchAll(/(?<![0-9a-z])[0-9a-f]{7,40}(?![0-9a-z])/gu)].map((m) =>
      m[0].slice(0, 7),
    ),
  );
}

/**
 * Les commits `feat`/`fix` postérieurs au `_state` qu'il ne cite pas.
 *
 * C'est le garde-fou du mode RESUME : un `_state` écrit au milieu d'une session
 * qui a continué ment par omission. Non vide ⇒ `_state` PÉRIMÉ, et la prochaine
 * étape se déduit des commits, pas de sa « Priorité 1 ».
 *
 * @param {{hash: string, subject: string}[]} commits - postérieurs au `_state`.
 * @param {string} stateText - contenu du `_state`.
 */
export function uncitedWork(commits, stateText) {
  const cited = citedHashes(stateText);
  return commits.filter(
    (c) =>
      /^(feat|fix)(\(|!|:)/u.test(c.subject) && !cited.has(c.hash.slice(0, 7)),
  );
}

/**
 * Verdict de CI d'un commit à partir de `gh run list --json status,conclusion,workflowName`.
 *
 * Un run en cours a `conclusion: ""` — pas `null` : un `conclusion ?? status`
 * le lit donc comme terminé. Le statut fait foi, jamais la conclusion seule.
 *
 * Un run ANNULÉ n'est pas un vert : les runs lus sont ceux du commit le plus
 * récent qui en a, donc aucun run plus récent du même workflow n'a pu le
 * remplacer — il a atteint son plafond (job figé) ou a été annulé à la main.
 * Le compter vert a affiché ✅ sur un commit dont la CI principale était figée.
 *
 * @param {{status: string, conclusion: string, workflowName: string}[]} runs
 * @returns {{state: "none"|"running"|"failure"|"cancelled"|"success", running: string[], failed: string[], cancelled: string[]}}
 */
export function ciVerdict(runs) {
  if (!runs.length)
    return { state: "none", running: [], failed: [], cancelled: [] };
  const running = runs
    .filter((r) => r.status !== "completed")
    .map((r) => r.workflowName);
  const failed = runs
    .filter(
      (r) =>
        r.status === "completed" &&
        !["success", "skipped", "neutral", "cancelled"].includes(r.conclusion),
    )
    .map((r) => r.workflowName);
  const cancelled = runs
    .filter((r) => r.status === "completed" && r.conclusion === "cancelled")
    .map((r) => r.workflowName);
  const state = failed.length
    ? "failure"
    : running.length
      ? "running"
      : cancelled.length
        ? "cancelled"
        : "success";
  return { state, running, failed, cancelled };
}

/**
 * Tickets passés à « Done » entre deux empreintes du tableau — ce que la session
 * (ou quelqu'un d'autre) a fermé, lisible HORS LIGNE.
 *
 * @param {{number: number, status: string}[]} before
 * @param {{number: number, status: string, title: string}[]} after
 */
export function newlyDone(before, after) {
  const was = new Map(before.map((i) => [i.number, i.status]));
  return after.filter(
    (i) =>
      i.status === "Done" && was.has(i.number) && was.get(i.number) !== "Done",
  );
}

/**
 * Titres des thèmes VIVANTS du sas `RETEX.md` : ceux qui précèdent la section
 * d'archive et ne portent pas la marque « GRADUÉ » / « VERSÉS ».
 *
 * Les titres SONT les règles : les lire suffit à la reprise ; on n'ouvre un
 * thème que s'il touche le travail du jour. Lire les ~440 lignes à chaque
 * reprise coûtait plus que ce qu'elles rendaient.
 */
export function liveRetexThemes(text) {
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("## ")) continue;
    const title = line.slice(3).trim();
    if (title.startsWith("🗄️ Gradué aux") || title.startsWith("🗄️ Archivé"))
      break;
    if (/GRADUÉ|VERSÉS/u.test(title)) continue;
    out.push(title);
  }
  return out;
}

/** Liens `[[nom]]` d'une section `## <titre>` d'un fichier Markdown. */
export function linksInSection(text, heading) {
  const start = text.indexOf(`\n## ${heading}`);
  if (start === -1) return [];
  const rest = text.slice(start + 4 + heading.length);
  const end = rest.search(/\n## /u);
  const body = end === -1 ? rest : rest.slice(0, end);
  return [
    ...new Set([...body.matchAll(/\[\[([^\]]+)\]\]/gu)].map((m) => m[1])),
  ];
}

/** Date `modified:` du frontmatter d'une mémoire, ou `null`. */
export function modifiedOf(text) {
  const m = /^\s*modified:\s*(\S+)/mu.exec(text);
  return m ? m[1] : null;
}

/** Dates ISO écrites dans un texte — le gate « anti-journal » des MEMORY/CLAUDE.md. */
export function datesIn(text) {
  return [...text.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/gu)].map((m) => m[0]);
}

/** Tronque une ligne à `max` caractères visibles. */
export const clip = (s, max = 90) =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;
