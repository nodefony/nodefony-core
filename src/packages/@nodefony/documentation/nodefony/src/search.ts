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
  let inABlock = false;
  for (const brute of markdown.split("\n")) {
    if (/^\s*```/.test(brute)) {
      inABlock = !inABlock;
      continue;
    }
    if (inABlock) continue;
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
 * Une FAUTE DE FRAPPE ne rend pas la documentation muette : quand la recherche
 * exacte ne trouve rien, chaque terme absent du corpus est remplacé par le mot
 * du corpus le plus fréquent qui n'en diffère que d'une faute (deux à partir de
 * 8 caractères) — lettre inversée, oubliée, en trop ou changée — et la réponse
 * le dit (`correctedQuery`). Un terme de moins de 4 caractères n'est jamais
 * corrigé : trop de mots courts sont à une lettre les uns des autres.
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
  const fold = (text: string): string =>
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const terms = [...new Set(fold(query).split(/\s+/).filter(Boolean))].filter(
    (t) => t.length > 1,
  );
  if (!terms.length) {
    return { query, terms, scanned: 0, matched: 0, hits: [] };
  }

  // La passe EXACTE : une page ne compte que si elle porte tous les termes.
  const rank = (wanted: string[]): IDocSearchHit[] => {
    const hits: IDocSearchHit[] = [];
    for (const doc of docs) {
      const foldedTitle = fold(`${doc.title} ${doc.navTitle} ${doc.slug}`);
      const lines = doc.body.split("\n");
      const foldedLines = lines.map(fold);
      const foldedBody = foldedLines.join("\n");

      // Une page ne compte que si elle porte TOUS les termes — sur son titre OU
      // son corps. Sinon « session redis » rendrait toutes les pages qui parlent
      // de sessions, et la recherche cesserait de discriminer.
      const carriesAll = wanted.every(
        (t) => foldedBody.includes(t) || foldedTitle.includes(t),
      );
      if (!carriesAll) continue;

      let occurrences = 0;
      for (const t of wanted) {
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
        // `[ \t]+(\S.*)` et non `\s+(.+)` : les deux morceaux du second pouvaient
        // matcher un espace, donc la frontière entre eux se réessayait à chaque
        // position — temps QUADRATIQUE en la longueur des blancs
        // (js/polynomial-redos). Le corpus est fourni par l'appelant, il n'est
        // pas borné avant ce point. Exiger un non-blanc en tête du groupe fixe
        // la frontière, à capture identique.
        const heading = /^#{2,4}[ \t]+(\S.*)$/.exec(brute);
        if (heading) {
          section = heading[1]?.replace(/[*`_]/g, "").trim();
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
        const folded = foldedLines[i] ?? "";
        if (!wanted.some((t) => folded.includes(t))) continue;
        const lineText = brute
          // Un lien garde son TEXTE, jamais sa cible.
          //
          // Les DEUX classes excluent le crochet ouvrant, et il a fallu les deux :
          // la première tuée par `[^\][]` (une suite `[[[[…` faisait de chaque `[`
          // un départ possible), la seconde par `[^)[]` — sur `[](` répété, la
          // cible avalait tout le reste de la ligne avant d'échouer, à chaque
          // départ. Mesuré sur 20 000 répétitions : 1047 ms avec `[^)]`, 0,2 ms
          // sans le crochet ; une borne `{0,2048}` ne descendait qu'à 154 ms.
          //
          // Exclure `[` d'une cible ne perd rien : la RFC 3986 §2.2 le classe
          // parmi les caractères réservés, qui doivent être percent-encodés
          // (`%5B`) partout ailleurs que dans une adresse IP littérale. Le rendu
          // est identique sur du markdown réel — vérifié par le banc.
          .replace(/\[([^\][]*)\]\([^)[]*\)/g, "$1")
          // Les croisillons d'un titre de niveau 5+, que le balayage de
          // section ne capte pas.
          .replace(/^#{1,6}\s*/, "")
          .replace(/[*`_>]/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (lineText.length < 12) continue;
        excerpts.push({
          ...(section ? { section } : {}),
          text: lineText.length > 220 ? `${lineText.slice(0, 217)}…` : lineText,
        });
      }

      // Un terme dans le titre pèse : c'est le signal le plus fort qu'une page
      // TRAITE le sujet plutôt qu'elle le mentionne.
      const inTitle = wanted.filter((t) => foldedTitle.includes(t)).length;
      hits.push({
        slug: doc.slug,
        title: doc.title,
        navTitle: doc.navTitle,
        sectionLabel: doc.sectionLabel,
        excerpts,
        occurrences,
        score: inTitle * 100 + occurrences,
      });
    }

    hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    return hits;
  };

  let hits = rank(terms);
  let used = terms;
  let correctedQuery: string | undefined;
  if (!hits.length) {
    // Distance d'édition « restreinte » (Damerau) : une inversion de deux
    // lettres voisines compte pour UNE faute — `grcp` est à 1 de `grpc`.
    // Bornée : on abandonne dès qu'une ligne dépasse le seuil.
    const distance = (a: string, b: string, max: number): number => {
      if (Math.abs(a.length - b.length) > max) return max + 1;
      let prev2: number[] = [];
      let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
      for (let i = 1; i <= a.length; i += 1) {
        const cur: number[] = [i];
        let best = i;
        for (let j = 1; j <= b.length; j += 1) {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1;
          let v = Math.min(
            (prev[j] ?? 0) + 1,
            (cur[j - 1] ?? 0) + 1,
            (prev[j - 1] ?? 0) + cost,
          );
          if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
            v = Math.min(v, (prev2[j - 2] ?? 0) + 1);
          cur.push(v);
          if (v < best) best = v;
        }
        if (best > max) return max + 1;
        prev2 = prev;
        prev = cur;
      }
      return prev[b.length] ?? max + 1;
    };
    // Le vocabulaire du corpus et la fréquence de chaque mot — construit
    // seulement ici, quand la recherche exacte a échoué.
    // Construire ce vocabulaire coûte ~250 ms sur le corpus du site (3 Mo) : il
    // est mis en CACHE sur le tableau du corpus lui-même, propriété non
    // énumérable. Une variable du module ne voyagerait pas avec la fonction
    // sérialisée ; le tableau, si — et un autre corpus a son propre cache.
    const KEY = "__nfSearchVocabulary";
    interface Vocabulary {
      vocabulary: Map<string, number>;
      corpus: string[];
    }
    // Seul CE code écrit la propriété : la forme reconnue est donc la sienne.
    const isVocabulary = (v: unknown): v is Vocabulary =>
      typeof v === "object" &&
      v !== null &&
      "vocabulary" in v &&
      v.vocabulary instanceof Map &&
      "corpus" in v &&
      Array.isArray(v.corpus);
    const cached: unknown = Reflect.get(docs, KEY);
    let vocabulary: Map<string, number>;
    let corpus: string[];
    if (isVocabulary(cached)) {
      vocabulary = cached.vocabulary;
      corpus = cached.corpus;
    } else {
      vocabulary = new Map<string, number>();
      corpus = [];
      for (const doc of docs) {
        const text = fold(
          `${doc.title} ${doc.navTitle} ${doc.slug} ${doc.body}`,
        );
        corpus.push(text);
        for (const w of text.match(/[a-z0-9]{3,}/g) ?? [])
          vocabulary.set(w, (vocabulary.get(w) ?? 0) + 1);
      }
      Object.defineProperty(docs, KEY, {
        value: { vocabulary, corpus },
        enumerable: false,
        configurable: true,
      });
    }
    const corrected = terms.map((t) => {
      if (t.length < 4 || corpus.some((c) => c.includes(t))) return t;
      const max = t.length >= 8 ? 2 : 1;
      let best = t;
      let bestDistance = max + 1;
      let bestCount = 0;
      for (const [w, count] of vocabulary) {
        const d = distance(t, w, max);
        if (d < bestDistance || (d === bestDistance && count > bestCount)) {
          best = w;
          bestDistance = d;
          bestCount = count;
        }
      }
      return bestDistance <= max ? best : t;
    });
    if (corrected.some((t, i) => t !== terms[i])) {
      const retry = rank(corrected);
      if (retry.length) {
        hits = retry;
        used = corrected;
        correctedQuery = corrected.join(" ");
      }
    }
  }
  return {
    query,
    terms: used,
    scanned: docs.length,
    matched: hits.length,
    hits: hits.slice(0, limit),
    ...(correctedQuery ? { correctedQuery } : {}),
  };
}
