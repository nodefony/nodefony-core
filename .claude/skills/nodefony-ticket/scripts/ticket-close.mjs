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
 * Il n'écrit RIEN sur GitHub : il imprime le brouillon, l'auteur le complète, et
 * ferme lui-même. Fermer est irréversible aux yeux du pilotage ; cela ne se
 * délègue pas à un automate qui n'a pas lu le diff.
 *
 * Usage :
 *   node .claude/skills/nodefony-ticket/scripts/ticket-close.mjs 95
 *   node .claude/skills/nodefony-ticket/scripts/ticket-close.mjs 95 --since <sha>
 */
import { execFileSync } from "node:child_process";

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
 * @param numero - le numéro du ticket.
 * @returns le motif, en expression rationnelle POSIX étendue.
 */
export function motifTicket(numero) {
  return `#${numero}([^0-9]|$)`;
}

/**
 * Les commits qui citent un ticket, du plus ancien au plus récent.
 *
 * @param numero - le numéro du ticket, en chaîne ou en nombre.
 * @param depuis - référence git facultative bornant la recherche (`<sha>..HEAD`).
 * @returns un objet par commit : `{ sha, sujet }`.
 */
export function commitsDuTicket(numero, depuis) {
  const plage = depuis ? [`${depuis}..HEAD`] : [];
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
  const numero = process.argv[2];
  if (!numero || !/^\d+$/.test(numero)) {
    console.error(
      "usage : ticket-close.mjs <numéro> [--since <sha>]\n" +
        "  imprime le brouillon de compte rendu ; n'écrit RIEN sur GitHub.",
    );
    process.exit(2);
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
  console.log("Compléter les deux derniers blocs, PUIS fermer :");
  console.log(
    `  gh issue close ${numero} --comment "$(cat <<'EOF'\n<le compte rendu complété>\nEOF\n)"`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
