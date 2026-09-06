/**
 * Découpe d'un markdown par ses titres — le plan, puis une section.
 *
 * ⭐ **Pourquoi ce fichier existe** : les pages de documentation du framework
 * pèsent 50 à 80 ko. Rendues entières à un agent, elles saturent sa fenêtre pour
 * une question qui tenait dans un paragraphe ; tronquées, elles s'arrêtent au
 * milieu d'une phrase sans dire ce qui manque. Le plan est la troisième voie :
 * il coûte quelques centaines d'octets et permet de demander LA section utile.
 *
 * Vit dans le cœur parce que ses deux consommateurs sont de part et d'autre de
 * la frontière de dépendance — le serveur MCP (cœur) et le plan
 * d'administration (`@nodefony/framework`, qui peut importer le cœur, l'inverse
 * étant interdit).
 */

/** Un titre du document, et ce qu'il ouvre. */
export interface IMarkdownSection {
  /** Niveau du titre : 1 pour `#`, 2 pour `##`… */
  level: number;
  /** Texte du titre, tel qu'il est écrit. */
  title: string;
  /** Ligne (1-indexée) du titre dans le document. */
  line: number;
  /** Poids de la section, titre compris — de quoi choisir sans l'ouvrir. */
  chars: number;
}

/** Un titre atx, hors bloc de code. */
// Le titre est capturé BRUT, puis nettoyé à part. Écrite d'un seul tenant
// (`(.+?)\s*#*\s*$`), la reconnaissance devient ambiguë — le paresseux, les
// blancs et les `#` de fermeture peuvent se partager les mêmes caractères de
// plusieurs façons, et le moteur les essaie toutes. Deux gestes simples valent
// mieux qu'une expression qui a l'air savante.
const HEADING_RE = /^(#{1,6})[^\S\n](.*)$/;
/** Les `#` de fermeture, forme ATX facultative : `## Titre ##`. */
const HEADING_CLOSING_RE = /[^\S\n]#+$/;
/** Ouverture ou fermeture d'un bloc de code clôturé. */
const FENCE_RE = /^\s*(?:```|~~~)/;

/**
 * Forme comparable d'un titre : minuscules, sans diacritiques ni ponctuation
 * de décoration — un agent recopie rarement « 🔴 Règle ABSOLUE » à l'identique.
 */
function foldTitle(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Repère les titres d'un markdown, **en ignorant les blocs de code**.
 *
 * Cette exclusion n'est pas un détail de forme : la documentation du framework
 * est pleine d'exemples shell, où un `# commentaire` en début de ligne serait
 * lu comme un titre de niveau 1 — et découperait le document à des endroits qui
 * n'existent pas.
 *
 * @param markdown - corps du document (frontmatter déjà retiré)
 * @returns les titres dans l'ordre du document, avec le poids de leur section
 */
export function outlineMarkdown(markdown: string): IMarkdownSection[] {
  const lines = markdown.split("\n");
  const sections: IMarkdownSection[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (FENCE_RE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = HEADING_RE.exec(lines[i]);
    if (m) {
      sections.push({
        level: m[1].length,
        title: m[2].trim().replace(HEADING_CLOSING_RE, "").trim(),
        line: i + 1,
        chars: 0,
      });
    }
  }
  // Le poids d'une section = jusqu'au titre suivant de niveau ≤ au sien ; le
  // dernier va jusqu'à la fin. Calculé après coup pour n'avoir qu'un balayage.
  for (let s = 0; s < sections.length; s += 1) {
    const start = sections[s].line - 1;
    let end = lines.length;
    for (let n = s + 1; n < sections.length; n += 1) {
      if (sections[n].level <= sections[s].level) {
        end = sections[n].line - 1;
        break;
      }
    }
    sections[s].chars = lines.slice(start, end).join("\n").length;
  }
  return sections;
}

/**
 * Extrait UNE section d'un markdown, sous-sections comprises.
 *
 * Le titre demandé est reconnu sans casse, sans accents et sans ponctuation
 * décorative ({@link foldTitle}) : « securite » retrouve « 🔐 Sécurité ». À
 * défaut d'égalité, une inclusion suffit — un agent cite plus souvent un bout
 * de titre que sa forme exacte.
 *
 * @param markdown - corps du document (frontmatter déjà retiré)
 * @param wanted - titre cherché, sous n'importe quelle forme approchante
 * @returns le titre RÉEL et le corps de sa section, ou `null` si rien ne matche
 */
export function extractMarkdownSection(
  markdown: string,
  wanted: string,
): { title: string; markdown: string } | null {
  const sections = outlineMarkdown(markdown);
  const target = foldTitle(wanted);
  if (target === "") return null;
  const found =
    sections.find((s) => foldTitle(s.title) === target) ??
    sections.find((s) => foldTitle(s.title).includes(target));
  if (!found) return null;

  const lines = markdown.split("\n");
  const start = found.line - 1;
  let end = lines.length;
  for (const s of sections) {
    if (s.line > found.line && s.level <= found.level) {
      end = s.line - 1;
      break;
    }
  }
  return { title: found.title, markdown: lines.slice(start, end).join("\n") };
}
