import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter, metaString, type Frontmatter } from "./frontmatter";
import { pathToSlug, type DocSource } from "./slug";

/**
 * Un fichier `.md` découvert par le scan, avec son chemin RÉEL et ses
 * métadonnées. Le `absPath` est la seule source de vérité pour lire le fichier
 * (jamais reconstruit depuis le slug → 0 traversée de répertoire).
 */
export interface ScannedDoc {
  /** Clé d'allowlist URL-safe (cf {@link pathToSlug}). */
  slug: string;
  /** Chemin relatif POSIX au dossier de base scanné. */
  relPath: string;
  /** Chemin absolu RÉEL du fichier (pour la lecture). */
  absPath: string;
  /** Origine (racine du projet ou module). */
  source: DocSource;
  /** Chemin du dossier parent (POSIX) — sert à regrouper en sections. */
  group: string;
  /** Frontmatter parsé (title/audience/section/version/status/updated/source). */
  meta: Frontmatter;
  /** Titre résolu (frontmatter `title`, sinon nom de fichier humanisé). */
  title: string;
}

/** `01-vue-ensemble.md` → `Vue Ensemble` (retire préfixe numérique + sépare). */
function humanizeFilename(base: string): string {
  return base
    .replace(/\.md$/i, "")
    .replace(/^\d+[-_]/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** `true` si un chemin relatif contient un segment exclu (ex. `node_modules`). */
function isExcluded(relPath: string, exclude: readonly string[]): boolean {
  const segments = relPath.split(/[/\\]/);
  return segments.some((seg) => exclude.includes(seg));
}

/**
 * Scanne récursivement un dossier de docs et retourne les fichiers `.md`
 * trouvés, frontmatter lu, triés par chemin relatif.
 *
 * Best-effort : un dossier absent (`ENOENT`) renvoie `[]` (pas d'erreur) ; un
 * fichier illisible garde son titre humanisé (frontmatter ignoré).
 *
 * @param baseDir - dossier racine à scanner (absolu).
 * @param source - origine taguée sur chaque doc (racine ou module).
 * @param exclude - noms de segments de chemin à ignorer.
 * @returns liste des docs trouvés (vide si dossier absent).
 */
export async function scanDocsDir(
  baseDir: string,
  source: DocSource,
  exclude: readonly string[] = [],
): Promise<ScannedDoc[]> {
  let entries: string[];
  try {
    entries = (await readdir(baseDir, { recursive: true })) as string[];
  } catch {
    return []; // dossier absent / illisible → rien (best-effort, hors dépôt OK)
  }

  const mdFiles = entries.filter(
    (rel) => rel.toLowerCase().endsWith(".md") && !isExcluded(rel, exclude),
  );

  const docs = await Promise.all(
    mdFiles.map(async (rel): Promise<ScannedDoc> => {
      const relPosix = rel.replace(/\\/g, "/");
      const parts = relPosix.split("/");
      const base = parts[parts.length - 1];
      const group = parts.slice(0, -1).join("/") || "racine";
      const absPath = join(baseDir, rel);

      let meta: Frontmatter = {};
      try {
        const raw = await readFile(absPath, "utf8");
        meta = parseFrontmatter(raw).meta;
      } catch {
        /* illisible → frontmatter vide, titre humanisé */
      }

      return {
        slug: pathToSlug(source, relPosix),
        relPath: relPosix,
        absPath,
        source,
        group,
        meta,
        title: metaString(meta, "title") ?? humanizeFilename(base),
      };
    }),
  );

  return docs.sort((a, b) => a.relPath.localeCompare(b.relPath));
}
