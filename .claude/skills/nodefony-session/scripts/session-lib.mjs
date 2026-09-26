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

/**
 * Thèmes MÛRS annoncés par `retex-seuil.mjs` (`   55  🎯 Titre`), dans l'ordre rendu.
 *
 * 🔴 La clôture n'affichait que la PREMIÈRE ligne du script — les totaux — et
 * avalait la liste : un thème à 55 frictions a traversé huit clôtures sans
 * qu'aucune ne le nomme. Le contrôle existait ; son verdict n'arrivait pas.
 *
 * @param {string} out - sortie standard de `retex-seuil.mjs` (sans `--all`).
 * @returns {{count: number, title: string}[]}
 */
export function matureThemes(out) {
  const res = [];
  for (const line of out.split("\n")) {
    const m = /^\s+(\d+)\s{2}(\S.*)$/u.exec(line);
    if (m) res.push({ count: Number(m[1]), title: m[2].trim() });
  }
  return res;
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

/**
 * Le premier item de la section `## Reste` d'un `_state`, et les tickets qu'il cite.
 *
 * La ligne ➡️ de la reprise ne voit que le TABLEAU : un travail sans ticket y est
 * invisible. Vécu : la Priorité 1 d'un `_state` (vider le cliquet de typage)
 * n'avait aucun ticket, et la reprise l'a reléguée derrière un ticket de release.
 * `tickets` vide ⇒ la priorité se présente AVANT ➡️, et appelle un ticket.
 *
 * @param {string} text - contenu du `_state`.
 * @returns {{text: string, tickets: number[]} | null} null sans Reste ou Reste vide.
 */
export function firstPriority(text) {
  text = `\n${text}`;
  const start = text.indexOf("\n## Reste");
  if (start === -1) return null;
  const rest = text.slice(start + "\n## Reste".length);
  const end = rest.search(/\n## /u);
  const lines = (end === -1 ? rest : rest.slice(0, end)).split("\n").slice(1);
  const item = [];
  for (const line of lines) {
    const head = /^(?:\d+\.|[-*])\s+(.*)$/u.exec(line);
    if (head) {
      if (item.length) break;
      item.push(head[1].trim());
    } else if (item.length && /^\s+\S/u.test(line)) {
      item.push(line.trim());
    } else if (item.length && line.trim() === "") {
      break;
    }
  }
  if (!item.length) return null;
  const joined = item.join(" ");
  const tickets = [
    ...new Set(
      [...joined.matchAll(/(?<![\w/])#(\d+)\b/gu)].map((m) => Number(m[1])),
    ),
  ];
  return { text: joined, tickets };
}

/**
 * Instant d'écriture d'un `_state` — l'ancre du début de la session suivante.
 *
 * Le champ `modified:` du frontmatter ne suffit PAS : rien ne le pose de façon
 * sûre (absent de 4 `_state` sur 20), et sans lui la clôture retombait en
 * silence sur « les 20 derniers commits » — trois sessions d'un coup — et la
 * reprise éteignait son garde-fou « `_state` PÉRIMÉ ». La date du dernier commit
 * du fichier dans le dépôt de la mémoire existe toujours, sur tout poste.
 *
 * @param {{ committedAt: string | null, modified: string | null, mtime: string | null }} sources
 *   - `committedAt` : `git log -1 --format=%cI -- <fichier>` du dépôt mémoire ;
 *   - `modified` : champ du frontmatter ({@link modifiedOf}) ;
 *   - `mtime` : date du fichier sur le disque, dernier recours.
 * @returns la première date disponible, dans cet ordre, ou `null`.
 */
export function stateWrittenAt({ committedAt, modified, mtime }) {
  return committedAt || modified || mtime || null;
}

/**
 * Arguments de `git log` qui bornent la session.
 *
 * Une révision se RÉSOUT par git, quelle que soit sa forme (`abc1234`, `abc1234^`,
 * `HEAD~3`) ; seul ce qui ne se résout pas est pris pour une date. Reconnue au
 * seul motif d'un hash nu, `abc1234^` partait en `--since=abc1234^` — un filtre
 * de DATE que git lit n'importe comment : tout l'historique.
 *
 * @param {string | null} since - révision ou date du début de session.
 * @param {(rev: string) => string | null} resolve - hash d'une révision, ou `null`.
 * @returns les arguments, et `anchored: false` quand aucune ancre n'existe.
 */
export function sessionLogArgs(since, resolve) {
  if (!since) return { args: ["-20"], anchored: false };
  const sha = resolve(since);
  return {
    args: sha ? [`${sha}..HEAD`] : [`--since=${since}`],
    anchored: true,
  };
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

/**
 * Nom du `_state` à écrire : la date du jour, suffixée de la lettre qui SUIT la
 * plus haute déjà prise ce jour-là.
 *
 * Jamais « la première lettre libre » : avec `…26`, `…26c` et `…26d` sur le
 * disque, elle rendait `…26b`, rangé AVANT les autres — et la reprise, qui prend
 * le dernier `_state` par nom, relisait l'ancien.
 *
 * @param {string[]} states - noms de fichiers `_state` existants.
 * @param {string} today - date du jour, `AAAA-MM-JJ`.
 * @returns {string} le nom du fichier à écrire.
 */
export function nextStateName(states, today) {
  const re = new RegExp(`^project_session_${today}([a-z]?)_state\\.md$`, "u");
  let highest = null;
  for (const name of states) {
    const m = re.exec(name);
    if (m && (highest === null || m[1] > highest)) highest = m[1];
  }
  const suffix =
    highest === null
      ? ""
      : highest === ""
        ? "b"
        : String.fromCharCode(highest.charCodeAt(0) + 1);
  return `project_session_${today}${suffix}_state.md`;
}
