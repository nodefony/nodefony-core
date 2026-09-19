import fs from "node:fs";
import path from "node:path";

/**
 * Dossiers qu'on ne descend jamais.
 *
 * Les deux derniers sont le cas qui compte : **553 des 729 pages** du dépôt
 * sont des RETEX archivés. Ce sont des documents historiques — datés, figés,
 * jamais republiés — et les juger au standard d'une page de référence rendait
 * 626 rouges sur 729. Un contrôle qui crie faux n'est pas sévère : il apprend
 * à être ignoré, y compris le jour où il a raison.
 */
const IGNORES = new Set([
  "node_modules",
  "dist",
  "session-retros",
  "archive",
  "archives",
]);

/**
 * Les pages de DOC sous un dossier, récursivement.
 *
 * Le corpus, c'est ce qui vit sous un dossier `docs` : un `README`, un
 * `CLAUDE.md` ou un `MEMORY.md` de module s'adresse à qui travaille DANS le
 * dépôt, pas au lecteur du portail — ils ont leurs propres règles.
 *
 * Cette descente existe pour qu'une commande npm soit possible : `docs/**\/*.md`
 * n'est expansé ni par `sh` POSIX (pas de `globstar`) ni par `cmd.exe`, si bien
 * que le contrôle restait réservé à qui savait composer la ligne à la main.
 *
 * @param dir - dossier de départ.
 * @returns les chemins des pages, triés.
 */
export const pagesDe = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        return e.name.startsWith(".") || IGNORES.has(e.name)
          ? []
          : pagesDe(abs);
      }
      return e.name.endsWith(".md") && /(?:^|[\\/])docs[\\/]/u.test(abs)
        ? [abs]
        : [];
    })
    .sort();

/**
 * Résout des cibles de ligne de commande en liste de pages : un dossier est
 * descendu, un fichier est gardé tel quel (y compris hors `docs/` — on ne
 * refuse pas de contrôler une page qu'on désigne explicitement).
 *
 * @param cibles - les arguments reçus.
 * @returns les pages à traiter.
 */
export const resoudreCorpus = (cibles) =>
  cibles.flatMap((c) =>
    fs.existsSync(c) && fs.statSync(c).isDirectory() ? pagesDe(c) : [c],
  );

/**
 * Les fichiers d'INSTRUCTIONS sous un dossier : `CLAUDE.md` et `MEMORY.md`.
 *
 * Ils sont volontairement hors du corpus rendu par `pagesDe` — ils s'adressent
 * à qui travaille dans le dépôt, pas au lecteur du portail, et n'ont ni
 * frontmatter ni sections imposées. Ils ont en revanche une exigence qui leur
 * est propre : les symboles qu'ils citent doivent exister.
 *
 * @param dir - dossier de départ.
 * @returns les chemins des fichiers d'instructions, triés.
 */
export const instructionsDe = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        return e.name.startsWith(".") || IGNORES.has(e.name)
          ? []
          : instructionsDe(abs);
      }
      return e.name === "CLAUDE.md" || e.name === "MEMORY.md" ? [abs] : [];
    })
    .sort();
