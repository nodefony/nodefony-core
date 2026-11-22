/**
 * Les pages TRADUITES du site : qui traduit quoi, et la traduction est-elle à
 * jour de sa source ?
 *
 * Contrat d'une traduction (frontmatter de la page traduite) :
 *
 *     lang: en
 *     translationOf: ../cbor.md        # chemin relatif vers la page SOURCE
 *     sourceHash: 3f9a1c0b7d2e         # empreinte de la source traduite
 *
 * L'ADRESSE d'une traduction ne dépend pas de l'emplacement de son fichier : c'est
 * celle de sa source, préfixée par la langue (`/docs/modules/core/cbor/` →
 * `/en/docs/modules/core/cbor/`, {@link translationPath}). Une adresse publiée ne
 * se change plus : la convention est figée avant la première traduction.
 *
 * La source ne déclare rien : c'est la traduction qui se rattache, donc ajouter
 * une langue ne touche à aucune page existante. Chaque groupe (source +
 * traductions) se déclare aux moteurs en `hreflang`, réciproquement ; et une
 * source modifiée sans que sa traduction suive REFUSE le build : une page
 * anglaise qui dit autre chose que la française est pire que pas de page.
 *
 * @usage import { translationGroups, staleTranslations, sourceFingerprint } from "./lib/translations.mjs"
 */
import { createHash } from "node:crypto";
import path from "node:path";

/** Langue que les moteurs servent à qui n'a aucune des langues proposées. */
export const DEFAULT_LANGUAGE = "en";

/** Langue dans laquelle le corpus est ÉCRIT — celle d'une page sans `lang`. */
export const SOURCE_LANGUAGE = "fr";

/** Code de langue accepté : BCP 47 simple, langue et région facultative (`fr`, `en`, `fr-CA`). */
const LANG_TAG = /^[a-z]{2,3}(-[A-Z]{2})?$/;

/**
 * La langue d'une page, lue à son frontmatter.
 *
 * @param meta - frontmatter de la page
 * @returns le code de langue, {@link SOURCE_LANGUAGE} par défaut
 * @throws Error si le code n'est pas un BCP 47 simple (`french`, `en_UK`)
 */
export function pageLanguage(meta) {
  const lang =
    typeof meta?.lang === "string" && meta.lang !== ""
      ? meta.lang
      : SOURCE_LANGUAGE;
  if (!LANG_TAG.test(lang))
    throw new Error(
      `langue « ${lang} » : attendu un code BCP 47 simple (fr, en, fr-CA)`,
    );
  return lang;
}

/**
 * L'adresse d'une traduction : celle de sa source, préfixée par la langue.
 *
 * @param sourcePath - chemin publié de la source, depuis la racine du site (`/docs/…/`)
 * @param lang - langue de la traduction
 * @returns `/<lang>/docs/…/`
 */
export function translationPath(sourcePath, lang) {
  return `/${lang}${sourcePath.startsWith("/") ? "" : "/"}${sourcePath}`;
}

/**
 * Empreinte du CORPS d'une page source — frontmatter exclu (une date de mise à
 * jour ne change pas ce qu'il faut traduire), blancs de fin de ligne ignorés.
 *
 * @param markdown - la page source entière
 * @returns 12 caractères hexadécimaux
 */
export function sourceFingerprint(markdown) {
  const body = markdown
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/[ \t]+$/gm, "")
    .trim();
  return createHash("sha256").update(body).digest("hex").slice(0, 12);
}

/**
 * La page source qu'une traduction déclare, en chemin de dépôt (`/`).
 *
 * @param page - `{ repoRel, meta }`
 * @returns le chemin de la source, ou `null` si la page n'est pas une traduction
 */
export function sourceOfTranslation({ repoRel, meta }) {
  const target =
    typeof meta?.translationOf === "string" ? meta.translationOf : "";
  if (target === "") return null;
  return path.posix.normalize(
    path.posix.join(path.posix.dirname(repoRel), target),
  );
}

/**
 * Les groupes de versions d'une même page : la source et ses traductions.
 *
 * @param pages - pages publiées `{ repoRel, url, meta }` (`url` absolue)
 * @returns adresse absolue d'une page → liste complète de ses versions
 *   `[{ lang, url, isDefault }]` ; une page sans traduction n'y figure pas
 * @throws Error si une traduction vise une source non publiée ou une autre
 *   traduction, si deux versions d'un groupe portent la même langue, ou si
 *   l'adresse d'une traduction ne suit pas {@link translationPath}
 */
export function translationGroups(pages, { siteUrl } = {}) {
  const byRepo = new Map(pages.map((p) => [p.repoRel, p]));
  const groups = new Map();
  for (const p of pages) {
    const src = sourceOfTranslation(p);
    if (src === null) continue;
    const source = byRepo.get(src);
    if (source === undefined)
      throw new Error(
        `${p.repoRel} : translationOf vise ${src}, absente du site`,
      );
    // Une traduction se rattache à la SOURCE, jamais à une autre traduction :
    // une chaîne fr ← en ← de écraserait les groupes, non réciproques.
    if (sourceOfTranslation(source) !== null)
      throw new Error(
        `${p.repoRel} : translationOf vise ${src}, elle-même une traduction — viser sa source`,
      );
    if (siteUrl !== undefined) {
      const expected = `${siteUrl}${translationPath(source.url.slice(siteUrl.length), pageLanguage(p.meta))}`;
      if (p.url !== expected)
        throw new Error(
          `${p.repoRel} : publiée à ${p.url}, attendu ${expected}`,
        );
    }
    const members = groups.get(source.repoRel) ?? [source];
    members.push(p);
    groups.set(source.repoRel, members);
  }
  const out = new Map();
  for (const members of groups.values()) {
    const langs = members.map((m) => pageLanguage(m.meta));
    const dup = langs.find((l, i) => langs.indexOf(l) !== i);
    if (dup !== undefined)
      throw new Error(`${members[0].repoRel} : deux versions en « ${dup} »`);
    const hasDefault = langs.includes(DEFAULT_LANGUAGE);
    const alternates = members.map((m, i) => ({
      lang: langs[i],
      url: m.url,
      // À défaut d'une version dans la langue par défaut, la source fait foi.
      isDefault: hasDefault ? langs[i] === DEFAULT_LANGUAGE : i === 0,
    }));
    for (const m of members) out.set(m.url, alternates);
  }
  return out;
}

/**
 * Les traductions en retard sur leur source.
 *
 * @param pages - pages publiées `{ repoRel, meta }`
 * @param readSource - lit une page source par son chemin de dépôt
 * @returns un message par traduction périmée, qui donne l'empreinte attendue
 */
export function staleTranslations(pages, readSource) {
  const out = [];
  for (const p of pages) {
    const src = sourceOfTranslation(p);
    if (src === null) continue;
    const expected = sourceFingerprint(readSource(src));
    const declared =
      typeof p.meta?.sourceHash === "string" ? p.meta.sourceHash : "";
    if (declared !== expected)
      out.push(
        `${p.repoRel} : traduit ${src} à l'empreinte « ${declared || "absente"} », la source est à « ${expected} » — mettre la traduction à jour, puis sourceHash: ${expected}`,
      );
  }
  return out;
}
