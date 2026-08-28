#!/usr/bin/env node
/**
 * check-no-nul-bytes — un octet NUL dans une source la rend INVISIBLE aux outils.
 *
 * `grep` et `rg` décident qu'un fichier est binaire dès qu'ils y voient un octet
 * nul, et cessent alors d'en rendre les lignes — `rg` répond « binary file
 * matches », `grep` se tait carrément selon les options. Le fichier existe, il
 * compile, ses tests passent : il a simplement disparu de toute recherche
 * textuelle du dépôt. Et personne ne l'apprend, puisque l'outil ne rend pas une
 * erreur mais un résultat VIDE.
 *
 * Le cas vécu : `identity()` du migrateur composait sa clé avec un séparateur
 * NUL écrit en LITTÉRAL. Trois recherches successives sur ce fichier ont rendu
 * zéro ligne pendant un diagnostic — dont une preuve d'absence, qui aurait été
 * fausse. Un audit qui conclut « ce symbole n'existe nulle part » sur un fichier
 * de 700 lignes se trompe de la pire façon : avec l'air d'avoir vérifié.
 *
 * **Le remède ne change rien à l'exécution** : `\0` échappé produit exactement
 * le même caractère U+0000 dans la chaîne. Ce qui change est le fichier sur le
 * disque, qui redevient du texte. Il n'y a donc aucune raison d'écrire le
 * littéral, et c'est pourquoi cette garde n'a pas d'échappatoire.
 *
 * @usage    node scripts/check-no-nul-bytes.mjs           # tous les fichiers SUIVIS
 * @usage    node scripts/check-no-nul-bytes.mjs --staged  # ceux de l'index (pre-commit)
 * @output   la liste des fichiers fautifs avec la ligne du premier octet ; sortie 1 si un seul l'est
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const STAGED = process.argv.includes("--staged");

/**
 * Extensions contrôlées — les sources et ce qui se lit à la main.
 *
 * Un binaire légitime (image, police, archive) contient des octets nuls par
 * nature : le contrôler serait du bruit permanent, et le bruit désarme une
 * garde plus sûrement qu'un contournement.
 */
const EXTENSIONS =
  /\.(?:[cm]?[jt]sx?|json|jsonc|md|ya?ml|css|scss|html|sh|sql|txt)$/i;

const args = STAGED
  ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]
  : ["ls-files"];

const sortie = execFileSync("git", [...args, "-z"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const fichiers = sortie.split("\0").filter((f) => f && EXTENSIONS.test(f));

const fautifs = [];
for (const f of fichiers) {
  let data;
  try {
    data = fs.readFileSync(f);
  } catch {
    // Supprimé entre le listage et la lecture : rien à contrôler.
    continue;
  }
  const idx = data.indexOf(0);
  if (idx !== -1) {
    fautifs.push({
      fichier: f,
      ligne: data.subarray(0, idx).toString("utf8").split("\n").length,
      combien: data.filter((o) => o === 0).length,
    });
  }
}

if (fautifs.length === 0) {
  process.stdout.write(
    `✓ ${fichiers.length} sources lisibles par grep et rg (0 octet NUL).\n`,
  );
  process.exit(0);
}

process.stderr.write(
  `\n❌ ${fautifs.length} fichier(s) portent un octet NUL — grep et rg les traitent en BINAIRE\n` +
    `   et n'y trouveront plus rien, sans dire pourquoi :\n\n`,
);
for (const f of fautifs) {
  process.stderr.write(
    `   ${f.fichier}:${f.ligne}  (${f.combien} octet(s) NUL)\n`,
  );
}
process.stderr.write(
  "\n   Écrire `\\0` ÉCHAPPÉ au lieu du caractère littéral : la chaîne produite est\n" +
    "   identique à l'exécution, et le fichier redevient du texte pour les outils.\n",
);
process.exit(1);
