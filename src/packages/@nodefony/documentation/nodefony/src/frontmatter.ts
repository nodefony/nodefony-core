/**
 * Parseur de frontmatter YAML minimal — **sans dépendance**.
 *
 * Un fichier de doc Nodefony commence (optionnellement) par un bloc encadré de
 * `---` qui porte des métadonnées (`title`, `audience`, `section`, `version`,
 * `status`, `updated`, `source`). On n'embarque PAS `gray-matter` (~plusieurs
 * deps transitives) pour ça : la doc n'utilise qu'un sous-ensemble plat de YAML
 * (clé: valeur scalaire ou liste). Ce parseur couvre ce sous-ensemble et reste
 * volontairement strict/petit.
 *
 * Supporté :
 * - `key: value`                → string (quotes simples/doubles retirées)
 * - `key: [a, b, c]`            → string[] (liste inline)
 * - `key:` puis lignes `  - x`  → string[] (liste en bloc)
 * - lignes vides / commentaires `#` ignorées
 *
 * NON supporté (volontaire) : objets imbriqués, multi-lignes `|`/`>`, ancres.
 * La doc n'en a pas besoin → on ne paie pas la complexité.
 */

/** Métadonnées extraites du frontmatter — valeurs scalaires ou listes. */
export type Frontmatter = Record<string, string | string[]>;

/** Résultat du parse : `meta` (frontmatter) + `body` (markdown sans le bloc). */
export interface ParsedDoc {
  meta: Frontmatter;
  body: string;
}

/** Retire une paire de quotes simples ou doubles entourant la valeur. */
function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

/** Parse une liste inline `[a, "b", c]` → `["a","b","c"]` (vide → `[]`). */
function parseInlineList(raw: string): string[] {
  const inner = raw.slice(1, -1).trim();
  if (inner === "") return [];
  return inner
    .split(",")
    .map((s) => unquote(s.trim()))
    .filter((s) => s !== "");
}

/**
 * Sépare le bloc frontmatter du corps markdown et parse les métadonnées.
 *
 * @param raw - contenu brut du fichier `.md`.
 * @returns `{ meta, body }` — `meta` vide et `body = raw` s'il n'y a pas de bloc.
 */
export function parseFrontmatter(raw: string): ParsedDoc {
  // Le bloc doit être tout en haut. Tolère un éventuel BOM/espaces de tête.
  const m = /^﻿?\s*---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { meta: {}, body: raw };

  const meta: Frontmatter = {};
  const lines = m[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim();

    if (value === "") {
      // Liste en bloc : lignes suivantes indentées `- item`.
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        items.push(unquote(lines[++i].replace(/^\s*-\s+/, "").trim()));
      }
      meta[key] = items; // peut rester [] (clé déclarée sans valeur)
      continue;
    }

    if (value.startsWith("[") && value.endsWith("]")) {
      meta[key] = parseInlineList(value);
      continue;
    }

    meta[key] = unquote(value);
  }

  return { meta, body: m[2] };
}

/** Lit une clé de frontmatter en string (1er élément si liste), ou `undefined`. */
export function metaString(meta: Frontmatter, key: string): string | undefined {
  const v = meta[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

/** Lit une clé de frontmatter en string[] (wrappe un scalaire), ou `[]`. */
export function metaList(meta: Frontmatter, key: string): string[] {
  const v = meta[key];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}
