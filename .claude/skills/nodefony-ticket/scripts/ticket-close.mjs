#!/usr/bin/env node
/**
 * Compose le COMPTE RENDU de fermeture d'un ticket — la moitié mécanique.
 *
 * POURQUOI CE SCRIPT EXISTE
 *
 * Un ticket fermé sur « fait » ne laisse aucune trace de ce qui a été fait. Le
 * travail, lui, a produit des commits, des tests, une garde vue mordre, et
 * presque toujours quelque chose qui DÉBORDE de l'énoncé — la protection
 * demandée en séance, le voisin qu'on a dû aligner. Rien de tout cela n'est
 * retrouvable ensuite, et le retrouver coûte une relecture de code : très
 * exactement la dépense que le ticket existe pour éviter (~72 % du coût d'une
 * session est de la relecture de contexte).
 *
 * CE QU'IL FAIT, ET CE QU'IL NE FERA JAMAIS
 *
 * Il rend les deux blocs que git connaît — les COMMITS qui citent le ticket, et
 * les fichiers de TEST qu'ils touchent. Il ne rend PAS les deux autres (« au-delà
 * du ticket », « non fait ») : ceux-là ne sont dans aucun dépôt, ils ne sont que
 * dans la tête de celui qui vient de travailler, et c'est pour ça qu'ils sont les
 * seuls qui valent d'être écrits à la main. Un script qui les inventerait rendrait
 * un compte rendu plausible et faux — pire que pas de compte rendu.
 *
 * Sans option, il n'écrit RIEN sur GitHub : il imprime le brouillon, l'auteur le
 * complète. Fermer est irréversible aux yeux du pilotage ; cela ne se délègue pas
 * à un automate qui n'a pas lu le diff — d'où `--close`, qui ne ferme que sur le
 * compte rendu COMPLÉTÉ qu'on lui tend.
 *
 * FERMER = DEUX FAITS, UN SEUL GESTE
 *
 * Le ticket fermé ET son statut « Done » au tableau. L'automatisme « Item closed »
 * pose bien « Done » à la fermeture, mais « Pull request linked to issue » le
 * REMET à « In Progress » quand on relie une PR au ticket APRÈS coup — vécu,
 * #797 et #801 : fermés, « Done » deux secondes plus tard, puis repassés « In
 * Progress » au clic « Development » fait après la clôture, lus « encore
 * ouverts » par l'auteur. `--close` pose donc « Done » lui-même ; `--done`
 * répare un ticket déjà fermé, c'est le geste que `board-lint` donne pour
 * `FERME-PAS-DONE`.
 *
 * Usage :
 *   node .claude/skills/nodefony-ticket/scripts/ticket-close.mjs 95
 *   node .claude/skills/nodefony-ticket/scripts/ticket-close.mjs 95 --since <sha>
 *
 *   node .claude/skills/nodefony-ticket/scripts/ticket-close.mjs --check compte-rendu.md
 *   node .claude/skills/nodefony-ticket/scripts/ticket-close.mjs 95 --close compte-rendu.md
 *   node .claude/skills/nodefony-ticket/scripts/ticket-close.mjs 95 --done
 *
 * @usage  node .claude/skills/nodefony-ticket/scripts/ticket-close.mjs <numéro> [--since <sha>] | --check <fichier> | <numéro> --close <fichier> | <numéro> --done | <numéro> --prune
 * @option --since  début de la plage de commits du ticket
 * @option --check  vérifie qu'un compte rendu tient dans un commentaire GitHub (65 536 caractères)
 * @option --close  publie le compte rendu complété, ferme le ticket et pose « Done » au tableau
 * @option --done   pose « Done » au tableau sur un ticket DÉJÀ fermé
 * @option --prune  supprime la branche locale d'un ticket dont la PR est fusionnée (la fermeture le fait d'elle-même)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isLongBranch } from "../../nodefony-session/scripts/branch-status.mjs";
import { guardCli } from "../../nodefony-session/scripts/cli-guard.mjs";
import { ticketOfBranch } from "./commit-kind.mjs";
import { checkBodyLength } from "./github-limits.mjs";
import { setBoardStatus } from "./ticket-progress.mjs";

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return "";
  }
};

/**
 * Les fichiers de TEST d'une liste de fichiers touchés.
 *
 * Retenus : une extension de suite (`.test.`, `.spec.`) ou un segment `tests/`
 * au PLURIEL. Le singulier est exclu à dessein — `src/modules/test/` est le
 * module de DÉCOR du dépôt, pas une suite : le ramasser noyait les vraies
 * preuves sous ses controllers et son `CLAUDE.md`.
 *
 * @param fichiers - chemins relatifs au dépôt, tels que `git` les rend.
 * @returns les chemins retenus, sans doublon, dans l'ordre d'apparition.
 */
export function fichiersDeTest(fichiers) {
  const vu = new Set();
  const out = [];
  for (const f of fichiers) {
    if (!f) continue;
    const estTest =
      /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || /(^|\/)tests\//.test(f);
    if (estTest && !vu.has(f)) {
      vu.add(f);
      out.push(f);
    }
  }
  return out;
}

/**
 * Le motif `--grep` qui isole UN ticket parmi ses voisins.
 *
 * 🔴 **Pas de `\\b`** : le moteur de git est une expression rationnelle POSIX
 * étendue, qui n'a pas de borne de mot — un `--grep='#95\\b'` ne mord sur RIEN
 * et le compte rendu sort vide en annonçant « aucun commit », ce qui ressemble
 * exactement à un oubli de citation. Constaté sur ce script même, à son premier
 * usage réel. La borne s'écrit donc en POSIX : un caractère non chiffre, ou la
 * fin de ligne — sans quoi `#9` ramènerait le travail de `#95`.
 *
 * 🔴 **Ce qui PORTE le ticket, pas ce qui le CITE** (revue #796, B4) : un
 * commit qui raconte « vécu sur #802 » n'est pas du travail de #802. Comptent la
 * référence de sujet en fin de ligne — `(#N)`, ou composée : `(D7, #796)`,
 * `(#760, étape 4)`, `(#760 #747)` — et les mots-clés de GitHub
 * (`closes`, `fixes`, `resolves`, leurs flexions, et `Refs`) — forme du pied
 * qu'écrivent `ticket-start` et le squash de `pr-finish`.
 *
 * @param numero - le numéro du ticket.
 * @returns le motif, en expression rationnelle POSIX étendue.
 */
export function motifTicket(numero) {
  return `(\\(([^)]*[^0-9])?#${numero}([^0-9)][^)]*)?\\)$|([Cc]los(e|es|ed)|[Ff]ix(es|ed)?|[Rr]esolv(e|es|ed)|[Rr]efs) #${numero}([^0-9]|$))`;
}

/**
 * Les références où chercher le travail d'un ticket — PUR.
 *
 * 🔴 `HEAD` seul ne suffit plus en travail par PR (revue #796, B4) : fermé
 * depuis `release/x.y.x` après la fusion, le ticket a son travail dans le
 * commit de SQUASH de la base ; fermé depuis une autre branche, `HEAD` ramassait
 * le travail d'un voisin (constaté en fermant #802). Les branches LONGUES
 * d'origin ne portent que des squash (qui citent `Refs #N` ou `Closes #N`) :
 * les ajouter trouve le travail fusionné, d'où qu'on ferme.
 *
 * @param {string[]} remoteRefs - références distantes (`origin/dev`, `origin/fix/1-x`…)
 * @param {string | undefined} depuis - borne facultative : alors `<sha>..HEAD` seul
 * @returns {string[]} les arguments de révision de `git log`
 */
export function searchRefs(remoteRefs, depuis) {
  if (depuis) return [`${depuis}..HEAD`];
  return [
    "HEAD",
    ...remoteRefs.filter(
      (r) => r.startsWith("origin/") && isLongBranch(r.slice("origin/".length)),
    ),
  ];
}

/**
 * Les commits qui citent un ticket, du plus ancien au plus récent — sur HEAD
 * et les branches longues d'origin ({@link searchRefs}).
 *
 * @param numero - le numéro du ticket, en chaîne ou en nombre.
 * @param depuis - référence git facultative bornant la recherche (`<sha>..HEAD`).
 * @returns un objet par commit : `{ sha, sujet }`.
 */
export function commitsDuTicket(numero, depuis) {
  const plage = searchRefs(
    sh("git", [
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/remotes/origin",
    ])
      .split("\n")
      .filter(Boolean),
    depuis,
  );
  const brut = sh("git", [
    "log",
    "--reverse",
    "--format=%h\t%s",
    `--grep=${motifTicket(numero)}`,
    "-E",
    ...plage,
  ]);
  return brut
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, ...reste] = l.split("\t");
      return { sha, sujet: reste.join("\t") };
    });
}

/**
 * Assemble le brouillon de compte rendu.
 *
 * Les deux blocs que l'auteur doit remplir sont laissés en TOUTES LETTRES avec
 * leur consigne : un gabarit dont les trous sont invisibles se rend tel quel.
 *
 * @param numero - le numéro du ticket.
 * @param commits - ce que rend {@link commitsDuTicket}.
 * @param tests - ce que rend {@link fichiersDeTest}.
 * @returns le corps du commentaire, en markdown.
 */
export function composer(numero, commits, tests) {
  const l = [];
  l.push("**Commits**");
  if (commits.length === 0) {
    l.push(
      `- (aucun commit ne cite #${numero} — le message de commit doit le citer,` +
        ` sinon la timeline du ticket reste vide)`,
    );
  } else {
    for (const c of commits) l.push(`- \`${c.sha}\` ${c.sujet}`);
  }
  l.push("");
  l.push("**Preuves**");
  if (tests.length === 0) {
    l.push("- (aucun fichier de test touché — dire pourquoi, ou l'écrire)");
  } else {
    for (const t of tests) l.push(`- \`${t}\``);
  }
  l.push(
    "- Garde vue mordre : <ce qu'on a débranché> → <ce qui est tombé>." +
      " Un test qu'on n'a jamais vu échouer ne prouve rien.",
  );
  l.push("");
  l.push("**Au-delà du ticket**");
  l.push(
    "- <ce qui a débordé de l'énoncé, et POURQUOI — protection demandée en" +
      " séance, voisin qu'il a fallu aligner. « rien » si le périmètre a tenu.>",
  );
  l.push("");
  l.push("**Non fait**");
  l.push(
    "- <le point du « Fini quand » non couvert, et son motif. « rien » si tout" +
      " l'énoncé est couvert.>",
  );
  return l.join("\n");
}

function main() {
  // `--check <fichier>` : le compte rendu COMPLÉTÉ tient-il dans un commentaire
  // GitHub ? Un `gh issue close --comment` refusé laisse le ticket OUVERT — la
  // limite se vérifie avant l'envoi, jamais au refus.
  const check = process.argv.indexOf("--check");
  if (check > 0) {
    const verdict = checkBodyLength(
      readFileSync(process.argv[check + 1], "utf8"),
    );
    if (!verdict.ok) {
      console.error(`refusé : ${verdict.reason}`);
      process.exit(1);
    }
    console.log(
      `compte rendu : ${verdict.length} caractères — tient dans un commentaire`,
    );
    return;
  }
  const numero = process.argv[2];
  if (!numero || !/^\d+$/.test(numero)) {
    console.error(
      "usage : ticket-close.mjs <numéro> [--since <sha>] | --check <fichier>\n" +
        "        ticket-close.mjs <numéro> --close <fichier> | <numéro> --done | <numéro> --prune\n" +
        "  sans option : imprime le brouillon de compte rendu, n'écrit RIEN sur GitHub.",
    );
    process.exit(2);
  }
  const closeAt = process.argv.indexOf("--close");
  if (closeAt > 0) {
    closeTicket(numero, process.argv[closeAt + 1]);
    return;
  }
  if (process.argv.includes("--done")) {
    markDone(numero);
    return;
  }
  // `--prune` : la même règle que la fermeture, pour un ticket DÉJÀ fermé dont
  // la branche locale est restée (fermé avant que la règle existe, ou à la main).
  if (process.argv.includes("--prune")) {
    pruneTicketBranches(numero);
    return;
  }
  const i = process.argv.indexOf("--since");
  const depuis = i > 0 ? process.argv[i + 1] : undefined;

  const commits = commitsDuTicket(numero, depuis);
  const touches = commits.flatMap((c) =>
    sh("git", ["show", "--name-only", "--format=", c.sha])
      .split("\n")
      .filter(Boolean),
  );
  const corps = composer(numero, commits, fichiersDeTest(touches));

  console.log(corps);
  console.log("");
  console.log("─".repeat(72));
  console.log(
    "Compléter les deux derniers blocs dans un fichier, le VÉRIFIER, PUIS fermer :",
  );
  console.log(
    "  node .claude/skills/nodefony-ticket/scripts/ticket-close.mjs --check compte-rendu.md",
  );
  console.log(
    `  node .claude/skills/nodefony-ticket/scripts/ticket-close.mjs ${numero} --close compte-rendu.md`,
  );
}

/**
 * Les branches LOCALES d'un ticket qu'on peut supprimer à sa fermeture — et
 * celles qu'on garde, avec le motif.
 *
 * Une PR fusionnée en squash laisse sa branche locale : git ne la reconnaît pas
 * comme fusionnée (le commit de `release/*` n'est pas le sien), et rien ne la
 * supprime — 15 branches mortes sur 21 constatées. Une branche ne part que si
 * sa PR est FUSIONNÉE et que sa pointe est le commit fusionné OU l'un de ses
 * ancêtres (branche locale en retard sur sa PR : rien à perdre) : un commit
 * absent de la PR serait du travail que la fusion n'a pas emporté. La branche
 * courante ne part jamais (git le refuserait, et c'est là que l'on travaille).
 *
 * @param {number} numero - le ticket.
 * @param {{ name: string, tip: string }[]} locales - branches locales et leur pointe.
 * @param {{ head: string, oid: string }[]} fusionnees - PR fusionnées : branche et commit fusionné.
 * @param {string | null} courante - la branche courante.
 * @param {(tip: string, oid: string) => boolean} [isAncestor] - `tip` est-il un
 *   ancêtre de `oid` ? (injecté : `git merge-base --is-ancestor` en vrai)
 * @returns {{ prune: string[], keep: { name: string, why: string }[] }}
 */
export function branchesToPrune(
  numero,
  locales,
  fusionnees,
  courante,
  isAncestor = () => false,
) {
  const prune = [];
  const keep = [];
  for (const { name, tip } of locales) {
    if (ticketOfBranch(name) !== numero) continue;
    const pr = fusionnees.find((m) => m.head === name);
    if (pr === undefined) keep.push({ name, why: "aucune PR fusionnée" });
    else if (pr.oid !== tip && !isAncestor(tip, pr.oid))
      keep.push({ name, why: "porte un commit absent de la PR fusionnée" });
    else if (name === courante)
      keep.push({
        name,
        why: "branche courante — en changer, puis git branch -D",
      });
    else prune.push(name);
  }
  return { prune, keep };
}

/**
 * Supprime les branches locales du ticket que {@link branchesToPrune} libère,
 * et dit celles qu'il garde. Un échec ne remet pas en cause la fermeture.
 *
 * @param {string} numero - le ticket.
 */
function pruneTicketBranches(numero) {
  const n = Number(numero);
  const locales = sh("git", [
    "for-each-ref",
    "--format=%(refname:short) %(objectname)",
    "refs/heads",
  ])
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [name = "", tip = ""] = l.split(" ");
      return { name, tip };
    })
    .filter((b) => ticketOfBranch(b.name) === n);
  if (locales.length === 0) return;
  const fusionnees = [];
  for (const { name } of locales) {
    const out = sh("gh", [
      "pr",
      "list",
      "--state",
      "merged",
      "--head",
      name,
      "--json",
      "headRefName,headRefOid",
    ]);
    try {
      for (const pr of JSON.parse(out || "[]"))
        fusionnees.push({ head: pr.headRefName, oid: pr.headRefOid });
    } catch {
      // Réponse illisible : rien n'est tenu pour fusionné, rien ne part.
    }
  }
  const courante = sh("git", ["branch", "--show-current"]).trim() || null;
  const isAncestor = (tip, oid) => {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", tip, oid], {
        stdio: "ignore",
      });
      return true;
    } catch {
      // Non-ancêtre, ou commit fusionné absent du dépôt local : on garde.
      return false;
    }
  };
  const { prune, keep } = branchesToPrune(
    n,
    locales,
    fusionnees,
    courante,
    isAncestor,
  );
  for (const name of prune) {
    try {
      execFileSync("git", ["branch", "-D", name], { stdio: "ignore" });
      console.log(`branche locale ${name} supprimée (PR fusionnée)`);
    } catch {
      console.log(
        `branche locale ${name} NON supprimée — git branch -D ${name}`,
      );
    }
  }
  for (const { name, why } of keep)
    console.log(`branche locale ${name} gardée : ${why}`);
}

/**
 * Publie le compte rendu, ferme le ticket, puis pose « Done » au tableau.
 *
 * Le compte rendu part par `--body-file`, jamais en argument : une ligne de
 * commande Windows plafonne à 32 767 caractères, un commentaire GitHub en admet
 * 65 536. Une étape GitHub qui échoue arrête tout avec un code ≠ 0 et dit où
 * l'on en est — le ticket resté ouvert ne doit jamais passer pour fermé.
 *
 * @param {string} numero - le numéro du ticket.
 * @param {string | undefined} fichier - le compte rendu COMPLÉTÉ.
 */
function closeTicket(numero, fichier) {
  if (!fichier) {
    console.error("usage : ticket-close.mjs <numéro> --close <fichier>");
    process.exit(2);
  }
  const verdict = checkBodyLength(readFileSync(fichier, "utf8"));
  if (!verdict.ok) {
    console.error(`refusé : ${verdict.reason}`);
    process.exit(1);
  }
  const gh = (args) =>
    execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    gh(["issue", "comment", numero, "--body-file", fichier]);
  } catch (e) {
    console.error(
      `compte rendu NON publié, #${numero} reste ouvert : ${e.stderr ?? e}`,
    );
    process.exit(1);
  }
  try {
    gh(["issue", "close", numero]);
  } catch (e) {
    console.error(
      `compte rendu publié, mais #${numero} reste OUVERT : ${e.stderr ?? e}\n` +
        `  → gh issue close ${numero}   puis   ticket-close.mjs ${numero} --done`,
    );
    process.exit(1);
  }
  console.log(`#${numero} fermé avec son compte rendu`);
  markDone(numero);
  pruneTicketBranches(numero);
}

/**
 * Pose « Done » au tableau sur un ticket fermé, et dit ce qui s'est passé.
 *
 * @param {string} numero - le numéro du ticket.
 */
function markDone(numero) {
  let changed;
  try {
    changed = setBoardStatus([numero], "Done", "CLOSED");
  } catch {
    console.error(
      `⚠️ tableau injoignable — statut « Done » NON posé sur #${numero}\n` +
        `  → ticket-close.mjs ${numero} --done`,
    );
    process.exit(1);
  }
  console.log(
    changed.length
      ? `#${numero} → « Done » au tableau`
      : `#${numero} : statut inchangé (déjà « Done », hors tableau, ou ticket encore ouvert)`,
  );
}

if (process.argv[1]?.endsWith("ticket-close.mjs")) {
  guardCli(import.meta.url);
  main();
}
