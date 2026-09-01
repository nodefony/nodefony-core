/**
 * Recherche plein texte du corpus de documentation — brique PURE.
 *
 * Elle ne lit ni disque ni réseau : on lui passe des pages déjà chargées, elle
 * rend un classement. C'est ce qui lui permet d'avoir DEUX consommateurs très
 * différents sans être écrite deux fois :
 *
 * - le service {@link DocumentationService.search}, côté serveur, qui lit les
 *   `.md` du disque à chaque requête ;
 * - le générateur du site public, qui n'a pas de serveur du tout : il embarque
 *   un index dans la page et fait tourner CETTE fonction dans le navigateur du
 *   lecteur (`searchDocs.toString()` — voir `build-docs-site.mjs`).
 *
 * D'où la contrainte qui gouverne ce fichier : **`searchDocs` et ses aides sont
 * auto-suffisantes**. Aucun import, aucune variable de portée supérieure, aucune
 * syntaxe qui suppose un bundler. Le jour où l'une d'elles capture quelque chose
 * de son module, le site continue de se construire et la recherche casse chez le
 * lecteur — sans un mot. Le test de parité (`search-parity.test.ts`) est là pour
 * ça : il exécute la fonction SÉRIALISÉE, pas la fonction importée.
 */
import type {
  IDocSearchExcerpt,
  IDocSearchHit,
  IDocSearchResult,
} from "../interfaces/IDocumentation";

/** Une page telle que la recherche a besoin de la voir. */
export interface SearchableDoc {
  slug: string;
  title: string;
  navTitle: string;
  /** Libellé de la section d'arbre qui porte la page (« Guides », « Cœur »…). */
  sectionLabel: string;
  /** Corps de la page, frontmatter retiré. */
  body: string;
}

/**
 * Réduit un texte à sa forme comparable : minuscules, accents retirés.
 *
 * « Sécurité » et « securite » doivent trouver la même chose — personne ne tape
 * les accents dans un champ de recherche.
 */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Termes effectivement cherchés : pliés, dédoublonnés, un caractère écarté. */
export function splitSearchTerms(query: string): string[] {
  return [...new Set(foldText(query).split(/\s+/).filter(Boolean))].filter(
    (t) => t.length > 1,
  );
}

/**
 * Prose INDEXABLE d'une page de documentation.
 *
 * Ce qui est retiré ne l'est pas par souci de taille mais de PERTINENCE : un
 * bloc de code fait remonter une page sur `const`, un tableau de compatibilité
 * sur n'importe quel nom de navigateur, et le fil d'Ariane sur le titre de
 * toutes ses voisines. Une recherche qui rend tout ne rend rien.
 *
 * @param markdown - le corps de la page, frontmatter déjà retiré.
 * @returns le texte à indexer, lignes conservées (les extraits s'y resituent).
 */
export function extractSearchText(markdown: string): string {
  const out: string[] = [];
  let dansUnBloc = false;
  for (const brute of markdown.split("\n")) {
    if (/^\s*```/.test(brute)) {
      dansUnBloc = !dansUnBloc;
      continue;
    }
    if (dansUnBloc) continue;
    // Fil d'Ariane, images, HTML brut, commentaires : de la navigation ou de la
    // présentation, jamais du propos.
    if (/^\s*(📍|!\[|<!--|<[a-z])/.test(brute)) continue;
    // Une rangée de séparation de tableau (`|---|:--:|`) ne porte aucun mot.
    if (/^\s*\|[\s|:-]+\|\s*$/.test(brute)) continue;
    // Les tableaux sont alignés à l'espace par le formateur : la colonne de
    // remplissage n'apprend rien à la recherche et pèse dans l'index que le
    // lecteur télécharge.
    out.push(brute.replace(/[ \t]{2,}/g, " "));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Classe les pages qui portent TOUS les termes, la plus pertinente d'abord.
 *
 * ⚠️ Cette fonction est SÉRIALISÉE et exécutée dans un navigateur (voir l'en-tête
 * du fichier) : elle ne doit rien référencer hors de son propre corps.
 *
 * @param docs - le corpus à balayer.
 * @param query - ce que le lecteur a tapé.
 * @param limit - nombre de résultats rendus (le total retenu est dit à part).
 * @returns le classement, plus ce que la recherche a réellement balayé.
 */
export function searchDocs(
  docs: SearchableDoc[],
  query: string,
  limit = 20,
): IDocSearchResult {
  const plier = (text: string): string =>
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const terms = [...new Set(plier(query).split(/\s+/).filter(Boolean))].filter(
    (t) => t.length > 1,
  );
  if (!terms.length) {
    return { query, terms, scanned: 0, matched: 0, hits: [] };
  }

  const hits: IDocSearchHit[] = [];
  let scanned = 0;

  for (const doc of docs) {
    scanned += 1;
    const foldedTitle = plier(`${doc.title} ${doc.navTitle} ${doc.slug}`);
    const lines = doc.body.split("\n");
    const foldedLines = lines.map(plier);
    const foldedBody = foldedLines.join("\n");

    // Une page ne compte que si elle porte TOUS les termes — sur son titre OU
    // son corps. Sinon « session redis » rendrait toutes les pages qui parlent
    // de sessions, et la recherche cesserait de discriminer.
    const porteTout = terms.every(
      (t) => foldedBody.includes(t) || foldedTitle.includes(t),
    );
    if (!porteTout) continue;

    let occurrences = 0;
    for (const t of terms) {
      let i = foldedBody.indexOf(t);
      while (i !== -1) {
        occurrences += 1;
        i = foldedBody.indexOf(t, i + t.length);
      }
    }

    // Les extraits : la ligne porteuse, resituée sous son titre de section.
    const excerpts: IDocSearchExcerpt[] = [];
    let section: string | undefined;
    for (let i = 0; i < lines.length && excerpts.length < 3; i += 1) {
      const brute = lines[i] ?? "";
      const titre = /^#{2,4}\s+(.+)$/.exec(brute);
      if (titre) {
        section = titre[1]?.replace(/[*`_]/g, "").trim();
        continue;
      }
      // Le titre de niveau 1 est DÉJÀ affiché au-dessus du résultat : le rendre
      // aussi en extrait faisait répéter la même phrase deux fois, et volait la
      // place du seul contenu qui apprend quelque chose.
      if (/^#\s/.test(brute)) continue;
      // Le fil d'Ariane, les images et les lignes de tableau ne sont pas de la
      // PROSE : les rendre comme extrait donnait « 📍 [Documentation](../../
      // index.md) › … » en guise de résumé.
      if (/^\s*(📍|!\[|\||<!--|```)/.test(brute)) continue;
      const pliee = foldedLines[i] ?? "";
      if (!terms.some((t) => pliee.includes(t))) continue;
      const texte = brute
        // Un lien garde son TEXTE, jamais sa cible.
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        // Les croisillons d'un titre de niveau 5+, que le balayage de
        // section ne capte pas.
        .replace(/^#{1,6}\s*/, "")
        .replace(/[*`_>]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (texte.length < 12) continue;
      excerpts.push({
        ...(section ? { section } : {}),
        text: texte.length > 220 ? `${texte.slice(0, 217)}…` : texte,
      });
    }

    // Un terme dans le titre pèse : c'est le signal le plus fort qu'une page
    // TRAITE le sujet plutôt qu'elle le mentionne.
    const dansLeTitre = terms.filter((t) => foldedTitle.includes(t)).length;
    hits.push({
      slug: doc.slug,
      title: doc.title,
      navTitle: doc.navTitle,
      sectionLabel: doc.sectionLabel,
      excerpts,
      occurrences,
      score: dansLeTitre * 100 + occurrences,
    });
  }

  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return {
    query,
    terms,
    scanned,
    matched: hits.length,
    hits: hits.slice(0, limit),
  };
}
