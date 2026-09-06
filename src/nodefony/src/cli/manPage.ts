import { Buffer } from "node:buffer";
import type { ICliManifest } from "./completion";
import { groupCommands } from "./helpReport";

/**
 * Page de manuel Unix (`man nodefony`), rendue depuis le manifest du CLI.
 *
 * **Pourquoi générer plutôt qu'écrire.** Une page man est un fichier statique
 * installé avec le paquet ; écrite à la main, elle diverge du CLI au premier
 * ajout de commande, et personne ne s'en aperçoit — c'est précisément ce que la
 * règle « la documentation décrit la vérité COURANTE » interdit. Le manifest
 * ({@link ICliManifest}) est extrait de commander, donc de la même source que
 * `--help` et que la complétion : cette page en est la TROISIÈME porte, avec la
 * même garantie de fraîcheur. Un gate compare la page committée à cette sortie.
 *
 * **Ce que la page NE PEUT PAS contenir, et qu'elle doit donc annoncer.** Douze
 * des commandes du CLI viennent des MODULES de l'application (`http:network`,
 * `frontend:build`, `security:user:add`…) : elles dépendent du projet dans
 * lequel on se trouve, quand la page est installée une fois pour toutes avec le
 * paquet. Elle documente donc les commandes du FRAMEWORK et renvoie
 * explicitement à `nodefony --help` pour les autres — une page qui énonce sa
 * propre frontière, plutôt qu'une page qui laisse croire qu'elle liste tout.
 *
 * **Aucune date.** `.TH` accepte un champ date ; le remplir rendrait la sortie
 * non déterministe et ferait échouer le gate le lendemain de sa génération. La
 * version tient ce rôle, et c'est la seule chose qu'on veuille y lire.
 *
 * **Portabilité.** `man` existe sous Linux et macOS ; npm installe la page à
 * l'installation GLOBALE. Windows n'a pas de `man` natif et npm y ignore le
 * champ : `nodefony --help` y reste la porte, et la page ne prétend rien
 * d'autre.
 */

/**
 * Largeur des lignes du SOURCE, en octets.
 *
 * 78 et non 80 : deux octets de marge coûtent moins qu'un avertissement
 * récurrent qu'on apprendrait à ignorer.
 *
 * ⚠️ **`mandoc -T lint` en signalera QUAND MÊME quelques-unes, et c'est un
 * artefact de sa mesure, pas un défaut de la page.** Il normalise chaque
 * caractère non-ASCII en séquence d'échappement avant de compter — un `é`
 * devient `\[u00E9]`, soit 9 octets au lieu de 2 — si bien qu'une page en
 * français dépasse toujours son seuil. Ces avertissements sont de niveau STYLE
 * et n'ont aucun effet sur le rendu (vérifié : `man` affiche la page
 * correctement). Ne PAS en faire un gate : il faudrait mutiler les
 * paragraphes pour satisfaire une mesure qui ne décrit pas le fichier réel.
 */
const MAN_SOURCE_WIDTH = 78;

/** Nom de la page, section 1 (commandes utilisateur). */
export const MAN_PAGE_NAME = "nodefony.1";

/**
 * Échappe une chaîne pour roff.
 *
 * Trois pièges, tous silencieux — ils ne produisent pas d'erreur, seulement une
 * page mal rendue : la contre-oblique introduit les séquences roff, le tiret nu
 * devient un tiret TYPOGRAPHIQUE (illisible dans une option `--json`, et non
 * copiable), et une ligne qui COMMENCE par un point ou une apostrophe est lue
 * comme une directive.
 */
export function escapeRoff(text: string): string {
  const escaped = text
    .replace(/\\/gu, "\\\\")
    .replace(/-/gu, "\\-")
    .trim()
    // Un saut de ligne au milieu d'une description casserait le paragraphe.
    //
    // `[^\S\n]` = un blanc QUI N'EST PAS un saut de ligne. Écrit `\s*\n\s*`,
    // les deux quantificateurs chevauchent le `\n` littéral : sur une suite de
    // sauts de ligne, le moteur réessaie chaque découpage, en temps quadratique.
    // Cette fonction est EXPORTÉE — une application la lâche sur son propre
    // texte, et rien ne dit que ce texte est court.
    .replace(/[^\S\n]*\n\s*/gu, " ");
  return /^[.']/u.test(escaped) ? `\\&${escaped}` : escaped;
}

/**
 * Replie une ligne de TEXTE à 80 colonnes, sur les espaces.
 *
 * Convention des sources man, et pas seulement de la coquetterie : `mandoc -T
 * lint` la contrôle, si bien qu'une source non repliée noie ses propres
 * avertissements sous des dizaines de « line longer than 80 bytes » — on ne
 * verrait plus passer une vraie erreur de structure. Le rendu, lui, ne change
 * pas : roff recompose les paragraphes.
 *
 * Les DIRECTIVES (`.TH`, `.TP`, `.B …`) ne sont jamais repliées — une ligne de
 * directive coupée en deux cesse d'être une directive.
 *
 * ⚠️ **La limite est en OCTETS, pas en caractères** : c'est ainsi que `mandoc`
 * compte, et cette page est en français. Replier sur `String.length` laissait
 * passer toute ligne accentuée — un `é` pèse deux octets, donc une ligne de 79
 * caractères pouvait en faire 90.
 */
function wrap(line: string): string {
  const byteLength = (s: string): number => Buffer.byteLength(s, "utf8");
  if (line.startsWith(".") || byteLength(line) <= MAN_SOURCE_WIDTH) {
    return line;
  }
  const out: string[] = [];
  let current = "";
  for (const word of line.split(" ")) {
    if (current && byteLength(`${current} ${word}`) > MAN_SOURCE_WIDTH) {
      out.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) {
    out.push(current);
  }
  return out.join("\n");
}

/** Une entrée de liste `.TP` : un terme en gras, sa description en dessous. */
function tagged(term: string, description: string): string {
  return `.TP\n.B ${term}\n${escapeRoff(description) || "\\-"}`;
}

/**
 * Rend la page de manuel complète, en roff.
 *
 * @param manifest - le manifest des commandes INTÉGRÉES (extrait de commander).
 * @param version - version du paquet, affichée dans l'en-tête et le pied.
 * @returns le source roff, terminé par un saut de ligne.
 */
export function renderManPage(manifest: ICliManifest, version: string): string {
  const out: string[] = [];
  const v = escapeRoff(version);

  // Champ date volontairement VIDE — cf note d'en-tête de ce fichier.
  out.push(`.TH NODEFONY 1 "" "nodefony ${v}" "Nodefony Manual"`);

  out.push(".SH NAME");
  out.push(
    "nodefony \\- framework fullstack Node.js : HTTP, WebSocket, ORM, agents",
  );

  out.push(".SH SYNOPSIS");
  out.push(".B nodefony");
  out.push("[\\fICOMMANDE\\fR] [\\fIOPTIONS\\fR]");
  out.push(".br");
  out.push(".B nodefony");
  out.push("\\fB\\-\\-help\\fR | \\fB\\-\\-version\\fR");

  out.push(".SH DESCRIPTION");
  out.push(
    "Interface en ligne de commande de Nodefony : elle lance l'application " +
      "(développement, production, cluster), la construit, l'inspecte et la " +
      "diagnostique, et engendre du code conforme au framework.",
  );
  out.push(".PP");
  out.push(
    "Lancée sans argument dans un terminal interactif, elle ouvre un menu des " +
      "gestes utiles ici. Hors terminal, elle affiche l'aide.",
  );
  out.push(".PP");
  out.push(
    "\\fBCette page ne liste que les commandes du FRAMEWORK.\\fR Une " +
      "application en ajoute par ses modules \\- par exemple " +
      "\\fBhttp:network\\fR, \\fBfrontend:build\\fR ou " +
      "\\fBsecurity:user:add\\fR \\- et celles\\-ci dépendent du projet dans " +
      "lequel la commande est lancée. Pour la liste RÉELLE, dans le projet " +
      "courant :",
  );
  out.push(".PP");
  out.push(".RS 4");
  out.push(".B nodefony \\-\\-help");
  out.push(".RE");

  out.push(".SH COMMANDS");
  out.push(
    "Les commandes sont rangées par INTENTION, dans l'ordre d'une journée de " +
      "travail \\- comme \\fBnodefony \\-\\-help\\fR. Un rangement " +
      "alphabétique mettrait \\fBai:mcp\\fR avant \\fBdevelopment\\fR ; " +
      "il ne répond à personne.",
  );
  // 🔴 Le CLASSEMENT vient de `grouperCommandes`, jamais d'une copie locale.
  // C'est la même fonction qui range `nodefony --help` : deux tables auraient
  // divergé au premier groupe ajouté, et la page de manuel aurait décrit un
  // rangement que le CLI n'applique plus. Le manifeste porte le groupe
  // précisément pour que cette page, rendue hors de tout boot, puisse le lire.
  for (const group of groupCommands(
    manifest.commands.map((c) => ({
      name: c.name,
      aliases: c.aliases ?? [],
      description: c.description,
      ...(c.group === undefined ? {} : { group: c.group }),
    })),
  )) {
    out.push(`.SS ${escapeRoff(group.title)}`);
    for (const cmd of group.commands) {
      out.push(
        tagged(
          [cmd.name, ...cmd.aliases].map((n) => escapeRoff(n)).join(", "),
          cmd.description,
        ),
      );
    }
  }

  if (manifest.globalOptions.length > 0) {
    out.push(".SH OPTIONS");
    out.push(
      "Options acceptées par toutes les commandes. Chaque commande porte en " +
        "plus les siennes, que \\fBnodefony \\fI<commande>\\fB \\-\\-help\\fR " +
        "détaille.",
    );
    for (const opt of manifest.globalOptions) {
      out.push(".TP");
      out.push(`.B ${escapeRoff(opt)}`);
    }
  }

  out.push(".SH ENVIRONMENT");
  out.push(
    tagged(
      "NODE_ENV",
      "Mode d'exécution (development | production). Posé par l'orchestrateur, il PRIME sur l'intention de la commande.",
    ),
  );
  out.push(
    tagged(
      "APP_ENV",
      "Environnement de DÉPLOIEMENT, libre (staging, canary, prod-eu). Axe distinct du mode d'exécution.",
    ),
  );
  out.push(
    tagged(
      "NF_*",
      "Toute variable lue par Nodefony porte ce préfixe. nodefony env en dresse la cascade et la provenance.",
    ),
  );
  out.push(
    tagged(
      "NF__<MODULE>__<CHEMIN>",
      "Surcharge une clé de configuration d'un module (double souligné entre les niveaux), appliquée avant la validation du schéma.",
    ),
  );

  out.push(".SH FILES");
  out.push(
    tagged(
      "nodefony.config.ts",
      "Configuration de l'application. Sa présence marque la racine du projet.",
    ),
  );
  out.push(
    tagged(
      "env.ts",
      "Catalogue des variables d'environnement de l'application.",
    ),
  );
  out.push(
    tagged(
      "node_modules/.cache/nodefony/cli\\-manifest.json",
      "Cache des commandes, réécrit à chaque commande. Sert la complétion et le menu, qui doivent répondre sans démarrer l'application.",
    ),
  );

  out.push(".SH EXAMPLES");
  out.push(tagged("nodefony create app mon\\-app", "Crée une application."));
  out.push(
    tagged(
      "nodefony dev",
      "Démarre en développement, avec redémarrage à chaud.",
    ),
  );
  out.push(
    tagged(
      "nodefony inspect routes",
      "Affiche les routes RÉELLEMENT montées, sans ouvrir de port.",
    ),
  );
  out.push(
    tagged(
      "nodefony doctor",
      "Diagnostique le projet, même s'il ne démarre plus.",
    ),
  );

  out.push(".SH SEE ALSO");
  out.push(
    "La documentation complète vit dans le projet (\\fBdocs/\\fR) et dans la " +
      "console d'administration. \\fBnodefony card\\fR rend la carte de visite " +
      "de l'application : où aller, quoi lancer.",
  );

  out.push(".SH AUTHOR");
  out.push("Christophe CAMENSULI et les contributeurs de Nodefony.");

  // Repli ligne par ligne APRÈS assemblage : plusieurs entrées de `out` sont
  // elles-mêmes des blocs multi-lignes (`tagged` rend `.TP` + terme + texte).
  // Les replier en bloc ne faisait rien — le bloc commence par un point, donc
  // il était pris pour une directive et laissé tel quel, description comprise.
  return `${out.join("\n").split("\n").map(wrap).join("\n")}\n`;
}
