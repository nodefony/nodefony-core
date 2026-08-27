#!/usr/bin/env node
/**
 * ticket-verify.mjs — confronte les tickets OUVERTS au code réel, par deux voies.
 *
 * Le problème qu'il ferme : un ticket est cru sans être relu. Il affirme un état
 * du code (« ✅ déjà fait : exporté depuis `client/index.ts:69-73` »), on estime
 * dessus, on planifie dessus — et le jour où un commit rend cette phrase fausse,
 * rien ne le dit. Vécu sur #34, dont le bloc « déjà fait » a survécu au geste qui
 * l'invalidait ; il a fallu y penser pour le trouver.
 *
 * Il ne réimplémente RIEN : il dépose les corps en Markdown et délègue la
 * résolution à `anchor-check.mjs` du skill `nodefony-documentation`, qui porte
 * déjà cette règle pour le corpus doc. Deux copies de la même vérification
 * divergeraient — chacune passerait ses propres contrôles.
 *
 * ⚠️ **Une ancre juste ne rend pas un ticket vrai.** Le cas qui a motivé cet
 * outil n'était pas une ancre morte : #34 pointait des lignes qui existaient
 * toujours, et affirmait au-dessus un état (« le contrat est publié ») que le
 * commit venait d'invalider. Aucune résolution d'ancre ne voit ça. D'où le
 * second mode, `--touched-by`, qui ne juge rien et se contente de dire QUELS
 * tickets parlent des fichiers qu'on vient de toucher : la sélection est
 * mécanique, le verdict reste humain. C'est le mode à passer avant de fermer.
 *
 * Usage :
 *   node ticket-verify.mjs                       # ancres de tous les tickets ouverts
 *   node ticket-verify.mjs 34 54 91              # ancres de ceux-là seulement
 *   node ticket-verify.mjs --touched-by HEAD     # tickets citant les fichiers d'un commit
 *   node ticket-verify.mjs --touched-by main..HEAD
 *
 * Sort 1 si une ancre est introuvable ou hors fichier (mêmes verdicts que le
 * gate doc) ; les `SUSPECT` sont rapportés sans faire échouer — une ancre qui a
 * glissé de quelques lignes est le régime normal d'un dépôt vivant. Le mode
 * `--touched-by` ne sort jamais 1 : il n'accuse pas, il donne à relire.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const CHECK = path.join(
  REPO,
  ".claude",
  "skills",
  "nodefony-documentation",
  "scripts",
  "anchor-check.mjs",
);
const OUT = path.join(REPO, "tmp", "ticket-anchors");

const argv = process.argv.slice(2);
const touchedAt = argv.indexOf("--touched-by");
const touchedBy = touchedAt === -1 ? null : (argv[touchedAt + 1] ?? "HEAD");
const wanted = argv.filter((a) => /^\d+$/.test(a));

/** Corps des tickets ouverts — un objet par ticket, jamais une chaîne concaténée. */
function fetchTickets() {
  if (wanted.length) {
    return wanted.map((n) =>
      JSON.parse(
        execFileSync(
          "gh",
          ["issue", "view", n, "--json", "number,title,body"],
          { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
        ),
      ),
    );
  }
  return JSON.parse(
    execFileSync(
      "gh",
      [
        "issue",
        "list",
        "--state",
        "open",
        "--limit",
        "200",
        "--json",
        "number,title,body",
      ],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    ),
  );
}

let tickets;
try {
  tickets = fetchTickets();
} catch (err) {
  // Un `gh` muet ne prouve pas que les ancres sont bonnes : le DIRE, et ne pas
  // rendre un vert qui n'a rien vérifié.
  console.error(
    `⚠️  GitHub injoignable — aucune ancre vérifiée (${err.message.split("\n")[0]})`,
  );
  process.exit(2);
}

if (touchedBy) {
  const files = execFileSync("git", ["diff", "--name-only", touchedBy], {
    cwd: REPO,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  if (!files.length) {
    console.log(`Aucun fichier touché par \`${touchedBy}\` — rien à relire.`);
    process.exit(0);
  }
  console.log(`${files.length} fichiers touchés par \`${touchedBy}\`.\n`);

  // Qui cite quoi. Un corps cite un fichier par son chemin OU par son seul nom :
  // les deux se cherchent, et le chemin s'écrit en `/` — c'est un chemin qui VOYAGE.
  const citations = new Map(); // ticket -> fichiers cités
  const popularite = new Map(); // fichier -> nombre de tickets qui le citent
  for (const t of tickets) {
    if (!t.body) continue;
    const hits = files.filter((f) => {
      const posix = f.split(path.sep).join("/");
      // Le motif minimal est le chemin sur DEUX segments (`client/index.ts`),
      // jamais le seul nom de fichier : `index.ts`, `config.ts` ou `README.md`
      // ne désignent rien, et les retenir noie le signal sous des tickets qui
      // parlent d'un tout autre module.
      const seg = posix.split("/");
      const motif = seg.slice(-2).join("/");
      return t.body.includes(posix) || t.body.includes(motif);
    });
    if (!hits.length) continue;
    citations.set(t, hits);
    for (const h of hits) popularite.set(h, (popularite.get(h) ?? 0) + 1);
  }

  if (!citations.size) {
    console.log("Aucun ticket ouvert ne parle de ces fichiers.");
    process.exit(0);
  }

  // Un fichier que la moitié des tickets citent est un ANNUAIRE, pas un indice :
  // il ne discrimine rien, et le bruit qu'il produit fait ignorer la liste
  // entière. Le seuil se DÉRIVE du lot (un quart des tickets qui citent), il ne
  // se décrète pas — et ce qui passe dessous est ANNONCÉ, jamais tu.
  const banal = Math.max(3, Math.ceil(citations.size / 4));
  const rare = (f) => (popularite.get(f) ?? 0) <= banal;

  const signal = [...citations].filter(([, hits]) => hits.some(rare));
  const courant = [...citations].filter(([, hits]) => !hits.some(rare));

  for (const [t, hits] of signal) {
    console.log(`#${t.number}  ${t.title}`);
    for (const h of hits.filter(rare)) console.log(`    cite  ${h}`);
  }
  console.log(
    `\n${signal.length} tickets à RELIRE : leurs affirmations portent sur ce qui vient de changer.\n` +
      "Une ancre juste ne suffit pas — vérifier ce que le corps AFFIRME de l'état du code.",
  );
  if (courant.length) {
    const annuaires = [...popularite]
      .filter(([, n]) => n > banal)
      .map(([f, n]) => `${f} (${n})`)
      .join(", ");
    console.log(
      `\n${courant.length} autres tickets écartés — ils ne citent que des fichiers que beaucoup\n` +
        `citent, donc sans valeur d'indice : ${annuaires}.\n` +
        `  ${courant.map(([t]) => "#" + t.number).join(" ")}`,
    );
  }
  process.exit(0);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const pages = [];
for (const t of tickets) {
  if (!t.body) continue;
  // Le nom porte le numéro : c'est lui que le rapport d'`anchor-check` affiche.
  const file = path.join(OUT, `ticket-${t.number}.md`);
  fs.writeFileSync(file, `# #${t.number} — ${t.title}\n\n${t.body}\n`);
  pages.push(file);
}

if (!pages.length) {
  console.log("Aucun ticket ouvert avec un corps — rien à vérifier.");
  process.exit(0);
}

console.log(
  `${pages.length} tickets ouverts → ancres résolues contre le code\n`,
);
// Les chemins sont passés un par un : pas de glob de shell (il n'existe pas sous
// `cmd.exe`, et il n'a rien à faire entre deux processus).
const run = spawnSync(process.execPath, [CHECK, ...pages], {
  cwd: REPO,
  stdio: "inherit",
});
process.exit(run.status ?? 1);
