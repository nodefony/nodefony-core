#!/usr/bin/env node
/**
 * ticket-anchor-migrate.mjs — convertit les ancres `fichier:ligne` des tickets
 * OUVERTS en ancres par symbole (`<fichier>.ts#<Symbole>`).
 *
 * Le problème qu'il ferme : une ligne dérive à chaque ajout au-dessus d'elle ;
 * décalée mais encore présente, elle a l'air d'une preuve et désigne autre
 * chose. Le contrôle `ANCRE-LIGNE` de `board-lint` les compte ; ce script les
 * convertit, au lieu qu'une session les paie une à une, à la main.
 *
 * Il ne réimplémente RIEN : la conversion est celle de la documentation,
 * `anchor-migrate.mjs` du skill `nodefony-documentation`. Ce script ne fait que
 * le décor — déposer les corps en Markdown, fournir à la conversion l'HISTOIRE
 * de chaque corps, renvoyer les corps réécrits.
 *
 * ⚠️ L'histoire est la raison d'être de ce pilote. Résolue dans le code
 * d'aujourd'hui, une ancre écrite il y a trois semaines sur une ligne qui a
 * glissé viserait la déclaration qui l'occupe MAINTENANT (vécu sur #541). Chaque
 * version d'un corps, lue dans son historique d'édition, porte donc les deux
 * révisions de `HEAD` (premier parent) qui encadrent sa date : la conversion
 * n'accepte une cible que si les deux la rendent, et qu'elle existe encore.
 * Ce qui reste est listé, jamais deviné.
 *
 * Sans `--apply`, rien ne part sur GitHub : le bilan dit ce qui changerait, et
 * les corps réécrits sont déposés pour relecture (`body-<N>.md`).
 *
 * @usage  node .claude/skills/nodefony-ticket/scripts/ticket-anchor-migrate.mjs [<numéro>…]
 * @usage  node .claude/skills/nodefony-ticket/scripts/ticket-anchor-migrate.mjs --apply [<numéro>…]
 * @option --apply  réécrit les corps convertis sur GitHub (sans : bilan seul)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { guardCli } from "../../nodefony-session/scripts/cli-guard.mjs";
import { parseLineAnchors } from "./board-lint.mjs";

guardCli(import.meta.url);

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const MIGRATE = path.join(
  REPO,
  ".claude",
  "skills",
  "nodefony-documentation",
  "scripts",
  "anchor-migrate.mjs",
);
// Sous une CATÉGORIE de tmp/ (scripts/repo/tmp-layout.mjs) : rien à sa racine.
const OUT = path.join(REPO, "tmp", "scratch", "ticket-anchors");
const REPORT = path.join(REPO, "tmp", "reports", "ticket-anchor-migrate.json");

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const wanted = new Set(argv.filter((a) => /^\d+$/.test(a)).map(Number));

const QUERY = `query($owner: String!, $repo: String!, $endCursor: String) {
  repository(owner: $owner, name: $repo) {
    issues(states: OPEN, first: 50, after: $endCursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title body createdAt
        userContentEdits(first: 100) { totalCount nodes { editedAt diff } }
      }
    }
  }
}`;

/** Les tickets ouverts, avec l'historique d'édition de leur corps. */
function fetchTickets() {
  const pages = JSON.parse(
    execFileSync(
      "gh",
      [
        "api",
        "graphql",
        "--paginate",
        "--slurp",
        "-F",
        "owner={owner}",
        "-F",
        "repo={repo}",
        "-f",
        `query=${QUERY}`,
      ],
      { cwd: REPO, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    ),
  );
  return pages.flatMap((p) => p.data.repository.issues.nodes);
}

/**
 * Les versions d'un corps, de la plus ancienne à la plus récente. Un historique
 * tronqué ne date rien : il rend `[]`, et toutes ses ancres sont laissées.
 */
function versionsOf(t) {
  const edits = t.userContentEdits;
  if (edits.totalCount > edits.nodes.length) return [];
  if (!edits.nodes.length) return [{ date: t.createdAt, text: t.body }];
  return edits.nodes
    .filter((n) => typeof n.diff === "string")
    .reverse()
    .map((n) => ({ date: n.editedAt, text: n.diff }));
}

// La frise de `HEAD` au premier parent : ce que la branche portait à une date,
// sans les commits d'une branche latérale pas encore fusionnée.
const frise = execFileSync(
  "git",
  ["log", "--first-parent", "--format=%H %ct", "HEAD"],
  { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)
  .trim()
  .split("\n")
  .map((l) => {
    const [sha, ct] = l.split(" ");
    return { sha, t: Number(ct) };
  });

/** Les révisions qui encadrent une date : la dernière avant, la première après. */
function revsAround(iso) {
  const t = Date.parse(iso) / 1000;
  const k = frise.findIndex((c) => c.t <= t);
  if (k === -1) return frise.length ? [frise[frise.length - 1].sha] : [];
  return [frise[k].sha, frise[k - 1]?.sha].filter(Boolean);
}

let tickets;
try {
  tickets = fetchTickets();
} catch (err) {
  console.error(
    `⚠️  GitHub injoignable — rien converti (${err.message.split("\n")[0]})`,
  );
  process.exit(2);
}
tickets = tickets.filter(
  (t) => t.body && (!wanted.size || wanted.has(t.number)),
);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const pages = [];
const history = {};
const headerOf = (t) => `# #${t.number} — ${t.title}\n\n`;
const pageOf = (t) => path.join(OUT, `ticket-${t.number}.md`);
let tronques = 0;
for (const t of tickets) {
  if (!parseLineAnchors(t.body).length && !/`:\d+/.test(t.body)) continue;
  fs.writeFileSync(pageOf(t), `${headerOf(t)}${t.body}\n`);
  pages.push(t);
  const versions = versionsOf(t);
  if (!versions.length) tronques++;
  history[path.relative(REPO, pageOf(t)).split(path.sep).join("/")] =
    versions.map((v) => ({ text: v.text, revs: revsAround(v.date) }));
}
if (!pages.length) {
  console.log("Aucun ticket ouvert ne porte d'ancre par ligne.");
  process.exit(0);
}
if (tronques)
  console.log(
    `⚠️  ${tronques} ticket(s) à l'historique tronqué : leurs ancres sont laissées.`,
  );
const historyPath = path.join(OUT, "history.json");
fs.writeFileSync(historyPath, JSON.stringify(history));

console.log(`${pages.length} tickets ouverts portent des ancres par ligne\n`);
// Les chemins sont passés un par un : pas de glob de shell (il n'existe pas sous
// `cmd.exe`), et un DOSSIER sous `tmp/` serait ignoré par la détection.
const run = spawnSync(
  process.execPath,
  [
    MIGRATE,
    ...pages.map(pageOf),
    "--apply",
    "--history",
    historyPath,
    "--keep-orphans",
    "--report",
    REPORT,
  ],
  { cwd: REPO, stdio: "inherit" },
);

let modifies = 0;
let restantes = 0;
for (const t of pages) {
  const texte = fs.readFileSync(pageOf(t), "utf8");
  if (!texte.startsWith(headerOf(t))) {
    console.error(`⚠️  #${t.number} : en-tête altéré, corps non renvoyé`);
    continue;
  }
  const corps = texte.slice(headerOf(t).length).replace(/\n$/, "");
  const reste = parseLineAnchors(corps);
  restantes += reste.length;
  if (corps === t.body) continue;
  modifies++;
  const bodyFile = path.join(OUT, `body-${t.number}.md`);
  fs.writeFileSync(bodyFile, corps);
  console.log(
    `#${t.number}  ${parseLineAnchors(t.body).length} → ${reste.length} ancre(s) par ligne`,
  );
  if (!APPLY) continue;
  // Un corps édité depuis la lecture ne s'écrase pas : on relit, on compare.
  const actuel = JSON.parse(
    execFileSync("gh", ["issue", "view", String(t.number), "--json", "body"], {
      cwd: REPO,
      encoding: "utf8",
    }),
  ).body;
  if (actuel !== t.body) {
    console.error(`⚠️  #${t.number} : corps modifié depuis la lecture, ignoré`);
    continue;
  }
  execFileSync(
    "gh",
    ["issue", "edit", String(t.number), "--body-file", bodyFile],
    { cwd: REPO, stdio: ["ignore", "ignore", "inherit"] },
  );
}

// Le reste se LISTE, jamais ne se devine : ce que la conversion a laissé (avec
// son motif), puis les ancres vers un fichier sans symbole (`.md`, `.yml`…),
// qu'elle ne voit pas.
const laissees = JSON.parse(fs.readFileSync(REPORT, "utf8")).filter(
  (d) => d.texte === null,
);
const numeroDe = (page) => Number(/ticket-(\d+)\.md$/.exec(page)?.[1]);
const aTrancher = laissees.map((d) => ({
  n: numeroDe(d.page),
  raw: d.raw.replace(/`/g, ""),
  motif: d.action,
}));
for (const t of pages) {
  const corps = fs.readFileSync(pageOf(t), "utf8");
  for (const raw of parseLineAnchors(corps))
    if (
      !aTrancher.some(
        (x) => x.n === t.number && (x.raw.endsWith(raw) || raw.endsWith(x.raw)),
      )
    )
      aTrancher.push({ n: t.number, raw, motif: "sans symbole" });
}
if (aTrancher.length) {
  console.log(`\nÀ trancher à la main (${aTrancher.length}) :`);
  for (const x of aTrancher.sort((p, q) => p.n - q.n))
    console.log(`  #${x.n}  ${x.raw}  · ${x.motif}`);
}
console.log(
  `\n${modifies} corps ${APPLY ? "réécrits sur GitHub" : "à réécrire (--apply pour les envoyer)"} · ` +
    `${restantes} ancre(s) fichier:ligne restent. Détail : ${path.relative(REPO, REPORT)}`,
);
process.exit(run.status ?? 1);
