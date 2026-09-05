/**
 * La page d'aide d'UNE commande — le socle que toutes les commandes partagent.
 *
 * **Pourquoi un socle.** Le pied de `nodefony --help` promet
 * `nodefony <commande> --help`. Dix commandes ne tenaient pas cette promesse :
 * sept répondaient « option inconnue : --help » avec le code 64, trois
 * l'ignoraient et S'EXÉCUTAIENT — `nodefony stop --help` arrêtait réellement le
 * serveur. Écrire dix pages à la main aurait rendu dix mises en page
 * différentes, dont on n'aurait corrigé qu'une à chaque fois qu'un défaut y
 * serait trouvé : l'aide de `doctor` avait déjà tout ce qu'il faut, et c'est
 * elle qu'on a extraite ici plutôt que de la recopier.
 *
 * **Le rendu est PUR** ({@link renderUsage}) : la largeur et les couleurs lui
 * sont DONNÉES. C'est ce qui le rend éprouvable ailleurs que dans le terminal
 * où il tourne — donc en intégration continue, où il n'y en a pas.
 *
 * **Ce qu'une page doit dire**, et dans cet ordre : ce que la commande fait,
 * comment on l'appelle, ce que chaque option change, au moins un exemple, et
 * ses codes de sortie. Les deux derniers sont ceux qu'on oublie : un exemple
 * répond plus vite qu'un paragraphe, et personne d'autre ne dit à un script
 * comment lire le retour.
 *
 * @module
 */
import {
  createPalette,
  shouldColorize,
  usableWidth,
  wrap,
  sectionTitle,
  type IPalette,
} from "../kernel/checks/report";

/** Une ligne à deux colonnes : un terme, ce qu'il fait. */
export interface IUsageEntry {
  /** La colonne de gauche — un drapeau, un code, une commande d'exemple. */
  term: string;
  /** Ce qu'il change, en une phrase. */
  text: string;
}

/**
 * Une section libre, insérée entre l'en-tête et les options.
 *
 * Elle porte ce qu'aucune liste d'options ne dirait : ce que la commande
 * regarde, ce qu'elle refuse de faire, la frontière de ce qu'elle sait.
 */
export interface IUsageSection {
  title: string;
  /** Un paragraphe, replié à la largeur. */
  paragraph?: string;
  /** Des lignes déjà composées (une énumération, par exemple). */
  lines?: readonly string[];
  /** Des entrées à deux colonnes. */
  entries?: readonly IUsageEntry[];
}

/** Tout ce qu'une page d'aide a besoin de savoir — et rien d'autre. */
export interface IUsagePage {
  /** La commande telle qu'on la tape, `nodefony` compris. */
  command: string;
  /** Ce qu'elle fait, en une ligne — la même intention que sa description. */
  tagline: string;
  /** Ses alias, s'il en a. */
  aliases?: readonly string[];
  /**
   * Les formes d'appel. Défaut : `<command> [options]`.
   *
   * Plusieurs lignes quand les formes s'excluent — `env --example` n'accepte
   * pas les mêmes drapeaux que `env` seul, et une syntaxe unique le cacherait.
   */
  synopsis?: readonly string[];
  /** Les sections propres à la commande, avant OPTIONS. */
  sections?: readonly IUsageSection[];
  options: readonly IUsageEntry[];
  examples: readonly IUsageEntry[];
  /**
   * Les codes de sortie PROPRES à la commande.
   *
   * Les deux universels (0 et 64) sont ajoutés par le rendu : les redire dans
   * chaque page, c'est prendre le risque qu'une seule les oublie.
   */
  exitCodes?: readonly IUsageEntry[];
  /** Une dernière chose à savoir, repliée en pied de page. */
  footer?: string;
}

/** La largeur de la colonne des termes, dans OPTIONS et CODES DE SORTIE. */
const TERM_COLUMN = 20;

/**
 * Rend la page complète, retour chariot final compris.
 *
 * @param page - ce qu'il y a à dire.
 * @param p - la peinture (une palette sans couleur rend du texte nu).
 * @param width - la largeur utile, déjà bornée.
 * @returns le texte de la page.
 */
export function renderUsage(
  page: IUsagePage,
  p: IPalette,
  width: number = usableWidth(80),
): string {
  const out: string[] = [];

  // Deux espaces entre les colonnes, pas un : la colonne de gauche est
  // DÉRIVÉE du plus long terme, donc elle ne porte plus le blanc qu'une
  // largeur figée offrait par accident — et « --cwd <chemin> point de départ »
  // se lisait comme un seul mot.
  const entry = (term: string, text: string, column: number): void => {
    const margin = " ".repeat(column + 4);
    const [first, ...rest] = wrap(text, width - margin.length, "");
    out.push(`  ${p.action(term.padEnd(column, " "))}  ${first ?? ""}`);
    for (const line of rest) out.push(`${margin}${line}`);
  };

  const section = (name: string): void => {
    const { title, divider } = sectionTitle(name, width);
    out.push("", `${p.strong(title)}${p.dim(divider)}`, "");
  };

  const paragraph = (text: string): void => {
    for (const line of wrap(text, width - 4, "  ")) out.push(line);
  };

  out.push("", `  ${p.strong(page.command)}`);
  for (const line of wrap(page.tagline, width - 4, "  ")) {
    out.push(p.dim(line));
  }

  out.push("");
  const forms = page.synopsis ?? [`${page.command} [options]`];
  for (const [i, form] of forms.entries()) {
    out.push(i === 0 ? `  usage : ${form}` : `          ${form}`);
  }
  if (page.aliases?.length) {
    // Sur la même ligne quand la place existe, dessous sinon : deux
    // informations serrées valent mieux qu'une ligne coupée.
    const alias = `alias : ${page.aliases.join(", ")}`;
    const inline = `  usage : ${forms[0] ?? ""}        ${alias}`;
    if (forms.length === 1 && inline.length <= width) {
      out[out.length - 1] = `  usage : ${forms[0]}${p.dim(`        ${alias}`)}`;
    } else {
      out.push(p.dim(`  ${alias}`));
    }
  }

  for (const s of page.sections ?? []) {
    section(s.title);
    if (s.paragraph) paragraph(s.paragraph);
    for (const line of s.lines ?? []) out.push(`  ${line}`);
    for (const e of s.entries ?? []) entry(e.term, e.text, TERM_COLUMN);
  }

  if (page.options.length > 0) {
    section("OPTIONS");
    // La colonne se DÉRIVE du plus long drapeau, bornée : figée, elle saute dès
    // qu'une option la dépasse, et la page se met à ressembler à une sortie
    // cassée. C'est le défaut qu'on a corrigé sur les tableaux d'`inspect`.
    const column = Math.min(
      TERM_COLUMN,
      Math.max(0, ...page.options.map((o) => o.term.length)),
    );
    for (const o of page.options) entry(o.term, o.text, column);
  }

  if (page.examples.length > 0) {
    section("EXEMPLES");
    const widest = Math.max(...page.examples.map((e) => e.term.length));
    // Une glose qui n'a plus la place de tenir passe SOUS sa commande : deux
    // colonnes serrées à quinze caractères se lisent moins bien qu'une seule.
    const twoColumns = width - widest - 4 >= 24;
    for (const e of page.examples) {
      if (!twoColumns) {
        out.push(`  ${p.action(e.term)}`);
        for (const l of wrap(e.text, width - 6, "      ")) {
          out.push(p.dim(l));
        }
        continue;
      }
      const indent = " ".repeat(widest + 4);
      const [first, ...rest] = wrap(e.text, width - indent.length, "");
      out.push(
        `  ${p.action(e.term.padEnd(widest, " "))}  ${p.dim(first ?? "")}`,
      );
      for (const l of rest) out.push(`${indent}${p.dim(l)}`);
    }
  }

  section("CODES DE SORTIE");
  // 0 et 64 valent pour TOUTES les commandes : rendus ici, aucune page ne peut
  // les oublier, et aucune ne peut en donner une version divergente.
  // Triés par valeur : un script les lit dans l'ordre, et 0 · 66 · 64 se lit
  // comme une liste qu'on aurait oublié de ranger.
  const codes: IUsageEntry[] = [
    { term: "0", text: "succès" },
    ...(page.exitCodes ?? []),
    { term: "64", text: "option inconnue ou mauvais usage (EX_USAGE)" },
  ].sort((a, b) => Number(a.term) - Number(b.term));
  for (const c of codes) entry(c.term, c.text, 4);

  if (page.footer) {
    out.push("");
    for (const line of wrap(page.footer, width - 4, "  ")) {
      out.push(p.dim(line));
    }
  }
  out.push("");
  return `${out.join("\n")}\n`;
}

/**
 * Écrit la page sur la sortie standard — la réponse à `--help`.
 *
 * Sur **stdout** et avec le code **0** : `--help` est une réponse, pas une
 * erreur. Un `nodefony env --help | less` doit voir la page, et un script ne
 * doit pas la lire comme un échec.
 *
 * @param page - la page à rendre.
 * @returns le code de sortie, toujours 0.
 */
export function printUsage(page: IUsagePage): number {
  process.stdout.write(
    renderUsage(
      page,
      createPalette(shouldColorize(process.env, Boolean(process.stdout.isTTY))),
      usableWidth(process.stdout.columns),
    ),
  );
  return 0;
}

/**
 * Écrit un refus PUIS la page, sur la sortie d'erreur.
 *
 * La page suit le refus parce que les deux questions arrivent ensemble : on
 * vient de se tromper de drapeau, et ce qu'on veut lire tout de suite est la
 * liste de ceux qui existent.
 *
 * @param page - la page à rendre.
 * @param message - ce qui a été refusé, sans le nom de la commande.
 * @returns le code de sortie, toujours 64 (EX_USAGE).
 */
export function printUsageError(page: IUsagePage, message: string): number {
  const p = createPalette(
    shouldColorize(process.env, Boolean(process.stderr.isTTY)),
  );
  const width = usableWidth(process.stderr.columns);
  const name = page.command.replace(/^nodefony\s+/u, "");
  for (const line of wrap(`${name} : ${message}`, width, "  ")) {
    process.stderr.write(`${p.failure(line)}\n`);
  }
  process.stderr.write(renderUsage(page, p, width));
  return 64;
}
