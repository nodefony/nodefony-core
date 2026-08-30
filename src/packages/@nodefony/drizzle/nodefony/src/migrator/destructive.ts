import type { IMigrationFile } from "./types";

/**
 * Ce qu'une migration s'apprête à DÉTRUIRE — constaté avant d'appliquer.
 *
 * ## Pourquoi ce garde existe, alors qu'aucun outil de migration n'en a
 *
 * La question posée était : « faut-il sauvegarder la base avant une
 * migration ? ». La réponse honnête est **non, et personne ne le fait** —
 * Flyway, Liquibase, Rails, Django, Alembic, Prisma : aucun ne sauvegarde. Les
 * raisons tiennent :
 *
 * - l'outil n'a **ni les droits, ni la place, ni le temps**. Le compte qui migre
 *   a le droit de modifier le schéma, pas d'exporter toutes les données — et
 *   c'est exactement ce qu'on veut ;
 * - la sauvegarde est un **métier d'exploitation** (instantané de volume,
 *   restauration à un instant donné, réplica), déjà outillé et déjà froid ;
 * - un instantané pris par l'outil donnerait une **fausse assurance**.
 *   Restaurer une base de production est une décision et une interruption de
 *   service, jamais un drapeau qu'on tape par réflexe. Le pire des scénarios
 *   est celui où quelqu'un migre sans précaution *parce que « l'outil
 *   sauvegarde »*.
 *
 * Mais il restait un vrai trou, et c'est lui qu'on ferme ici : **appliquer un
 * `DROP COLUMN` en production sans un mot**. L'outil ne sauvegarde pas — il
 * **empêche d'appliquer sans savoir**. C'est ce que fait l'analyse de Atlas, et
 * ce qu'aucun applicateur de l'écosystème Node ne propose.
 *
 * ## Ce que ce scan N'EST PAS
 *
 * Ce n'est pas un analyseur syntaxique SQL, et il ne prétend pas à
 * l'exhaustivité : il reconnaît des formes. Une instruction destructive écrite
 * d'une façon qu'il ne connaît pas passera. **Il ne remplace donc jamais la
 * lecture du SQL** (`--dry-run`), et surtout pas la règle qui protège vraiment :
 * ne jamais faire un changement destructif dans la même version que le code qui
 * s'en sert (étendre, déployer, migrer les données, retirer une version plus
 * tard). Le retour arrière porte alors sur le CODE, jamais sur la base.
 *
 * Un faux positif coûte une lecture et un drapeau ; un faux négatif coûte des
 * données. Le scan penche donc toujours du côté du signalement.
 */

/** Gravité d'une trouvaille — elles ne se traitent pas pareil. */
export type DestructiveSeverity =
  /** Des données existantes disparaissent. Refusé hors développement. */
  | "data-loss"
  /**
   * Rien ne disparaît, mais l'instruction peut échouer sur des données
   * existantes, ou casser le code de la version précédente. Signalé, jamais
   * bloquant : c'est le lot normal d'une migration qui fait évoluer un schéma.
   */
  | "breaking";

/** Une instruction qui mérite d'être vue avant d'être exécutée. */
export interface IDestructiveFinding {
  source: string;
  tag: string;
  /** Chemin du fichier — pour aller le lire. */
  path: string;
  severity: DestructiveSeverity;
  /** Étiquette courte et stable, lisible par une machine. */
  kind: string;
  /** Ce qui est perdu ou risqué, en français. */
  what: string;
  /** L'instruction elle-même, bornée pour rester lisible. */
  statement: string;
}

/** Longueur au-delà de laquelle une instruction est tronquée à l'affichage. */
const MAX_STATEMENT = 300;

/**
 * Formes reconnues, de la plus grave à la plus bénigne.
 *
 * L'ordre compte : la première qui correspond gagne, pour qu'une instruction ne
 * soit pas signalée deux fois sous deux noms.
 */
const PATTERNS: ReadonlyArray<{
  kind: string;
  severity: DestructiveSeverity;
  re: RegExp;
  what: string;
}> = [
  {
    kind: "drop-database",
    severity: "data-loss",
    re: /\bDROP\s+(DATABASE|SCHEMA)\b/i,
    what: "supprime une base ou un schéma ENTIER — tout ce qu'il contient disparaît",
  },
  {
    kind: "drop-table",
    severity: "data-loss",
    re: /\bDROP\s+TABLE\b/i,
    what: "supprime une table et TOUTES ses lignes",
  },
  {
    kind: "drop-column",
    severity: "data-loss",
    // Deux formes, et la seconde est le piège : PostgreSQL et MySQL acceptent
    // `ALTER TABLE t DROP nom` SANS le mot `COLUMN`. Un motif qui n'attendrait
    // que `DROP COLUMN` laisserait passer la moitié des suppressions réelles.
    // La négation exclut les autres `DROP …` d'un `ALTER TABLE`, qui ne
    // détruisent pas de données (contrainte, index, valeur par défaut, NOT NULL).
    re: /\bDROP\s+COLUMN\b|\bALTER\s+TABLE\b[\s\S]*?\bDROP\s+(?!COLUMN\b|CONSTRAINT\b|INDEX\b|PRIMARY\b|FOREIGN\b|UNIQUE\b|CHECK\b|DEFAULT\b|NOT\s+NULL\b|IDENTITY\b|EXPRESSION\b)[`"']?\w+/i,
    what: "supprime une colonne et TOUTES ses valeurs",
  },
  {
    kind: "truncate",
    severity: "data-loss",
    re: /\bTRUNCATE\b/i,
    what: "vide une table de toutes ses lignes",
  },
  {
    kind: "delete-all",
    severity: "data-loss",
    // Un `DELETE FROM` sans `WHERE` vide la table. Avec `WHERE`, c'est une
    // migration de données ordinaire, qu'on ne signale pas.
    re: /\bDELETE\s+FROM\b(?![\s\S]*\bWHERE\b)/i,
    what: "supprime toutes les lignes d'une table (aucun filtre `WHERE`)",
  },
  {
    kind: "alter-type",
    severity: "breaking",
    re: /\b(ALTER\s+COLUMN[\s\S]*\bTYPE\b|MODIFY\s+COLUMN\b|ALTER\s+COLUMN[\s\S]*\bSET\s+DATA\s+TYPE\b)/i,
    what: "change le type d'une colonne — la conversion peut tronquer une valeur ou échouer sur les lignes existantes",
  },
  {
    kind: "set-not-null",
    severity: "breaking",
    re: /\bSET\s+NOT\s+NULL\b/i,
    what: "rend une colonne obligatoire — échoue si des lignes ont une valeur vide",
  },
  {
    kind: "rename",
    severity: "breaking",
    re: /\bRENAME\s+(TABLE|COLUMN|TO)\b/i,
    what: "renomme une table ou une colonne — le code de la version précédente ne la trouvera plus",
  },
  {
    kind: "drop-constraint",
    severity: "breaking",
    re: /\bDROP\s+(CONSTRAINT|INDEX|PRIMARY\s+KEY|FOREIGN\s+KEY)\b/i,
    what: "retire une garantie d'intégrité ou un index — les données restent, les protections non",
  },
];

/**
 * Reconnaît la recréation de table de SQLite, et l'exclut de la perte de données.
 *
 * SQLite ne sait pas modifier une colonne : l'outil de génération produit alors
 * la ronde connue — créer `__new_x`, y recopier les lignes de `x`, supprimer
 * `x`, renommer. Ce `DROP TABLE` est **structurel**, les données ont été
 * recopiées juste avant ; le signaler comme une perte ferait crier au loup à
 * chaque changement de colonne, et le garde serait désarmé au bout de trois
 * fois.
 *
 * ⚠️ Ce n'est pas une garantie que rien n'est perdu : si une colonne
 * n'apparaît pas dans le `INSERT … SELECT`, ses données disparaissent bel et
 * bien. C'est pourquoi la recréation reste SIGNALÉE, avec le geste — lire le
 * SQL —, et seulement déclassée en avertissement.
 */
function isTableRebuild(statements: readonly string[]): boolean {
  const joint = statements.join("\n");
  return (
    /\bCREATE\s+TABLE\s+[`"']?__new_/i.test(joint) &&
    /\bINSERT\s+INTO\s+[`"']?__new_/i.test(joint)
  );
}

/** Borne une instruction pour l'affichage, sans jamais la déformer. */
function borne(statement: string): string {
  const plat = statement.replace(/\s+/g, " ").trim();
  return plat.length > MAX_STATEMENT
    ? `${plat.slice(0, MAX_STATEMENT)}…`
    : plat;
}

/**
 * Cherche, dans les migrations en attente, ce qui détruit ou casse.
 *
 * @param files - migrations qui vont être appliquées.
 * @returns une trouvaille par instruction reconnue, dans l'ordre d'application.
 */
export function scanDestructive(
  files: readonly IMigrationFile[],
): IDestructiveFinding[] {
  const out: IDestructiveFinding[] = [];
  for (const file of files) {
    const rebuild = isTableRebuild(file.statements);
    for (const statement of file.statements) {
      for (const p of PATTERNS) {
        if (!p.re.test(statement)) {
          continue;
        }
        // Dans une recréation SQLite, la suppression de l'ancienne table et le
        // renommage de la nouvelle font partie de la mécanique.
        const structurel =
          rebuild && (p.kind === "drop-table" || p.kind === "rename");
        out.push({
          source: file.source,
          tag: file.tag,
          path: file.path,
          severity: structurel ? "breaking" : p.severity,
          kind: structurel ? "table-rebuild" : p.kind,
          what: structurel
            ? "recrée la table pour modifier une colonne (SQLite ne sait pas faire autrement) — les lignes sont recopiées, MAIS une colonne absente du `INSERT … SELECT` serait perdue : lire le SQL"
            : p.what,
          statement: borne(statement),
        });
        break;
      }
    }
  }
  return out;
}

/** Les trouvailles qui font vraiment disparaître des données. */
export function dataLoss(
  findings: readonly IDestructiveFinding[],
): IDestructiveFinding[] {
  return findings.filter((f) => f.severity === "data-loss");
}

/**
 * Rend le bilan lisible par un humain — le fait, puis ce qu'il faut faire.
 *
 * @param findings - trouvailles à présenter.
 * @param bloquant - la commande refuse-t-elle d'appliquer ?
 * @returns le texte, sans mise en forme (l'appelant colore s'il le veut).
 */
export function renderDestructive(
  findings: readonly IDestructiveFinding[],
  bloquant: boolean,
): string {
  const titre = bloquant
    ? `Ces migrations DÉTRUISENT des données — rien n'a été appliqué.`
    : `Ces migrations touchent à des données existantes.`;
  let out = `${titre}\n\n`;
  for (const f of findings) {
    const marque = f.severity === "data-loss" ? "✗" : "!";
    out += `  ${marque} ${f.source}/${f.tag} — ${f.what}\n`;
    out += `      ${f.statement}\n`;
  }
  if (bloquant) {
    out +=
      `\nCe n'est pas un refus de principe : une fois appliquée, une suppression ` +
      `ne se rattrape que par une restauration de la base — c'est-à-dire une ` +
      `interruption de service et une décision, jamais un retour arrière.\n` +
      `\nL'outil ne sauvegarde pas la base, et aucun outil de migration ne le ` +
      `fait : il n'en a ni les droits, ni la place, ni le temps, et le faire ` +
      `donnerait une assurance qui n'existe pas. La sauvegarde est le métier de ` +
      `l'exploitation (instantané de volume, restauration à un instant donné).\n` +
      `\nLa vraie protection est de ne PAS détruire dans la même version que le ` +
      `code : ajoute la nouvelle forme, déploie, recopie les données, et ne ` +
      `supprime l'ancienne qu'à la version suivante. Le retour arrière porte ` +
      `alors sur le code, et la base n'a jamais besoin d'être restaurée.\n`;
  }
  return out;
}

/** Les gestes proposés face à un refus destructif. */
export function destructiveActions(connector: string): string[] {
  const suffixe = connector === "default" ? "" : ` --connector ${connector}`;
  return [
    `nodefony orm:migrate${suffixe} --dry-run`,
    `nodefony orm:migrate${suffixe} --allow-destructive`,
  ];
}

/** Résumé d'une ligne, pour un message ou un journal. */
export function summarizeDestructive(
  findings: readonly IDestructiveFinding[],
  connector: string,
): string {
  const pertes = dataLoss(findings);
  const noms = [...new Set(pertes.map((f) => `${f.source}/${f.tag}`))];
  return (
    `Le connecteur « ${connector} » a ${pertes.length} instruction(s) qui ` +
    `SUPPRIMENT des données, dans ${noms.length} migration(s) : ${noms.join(", ")}.`
  );
}

/**
 * Les instructions qui touchent des lignes DÉJÀ EN BASE — sans détruire.
 *
 * Rien à voir avec {@link scanDestructive}, qui cherche ce qui fait perdre de
 * la donnée. Celles-ci sont parfaitement légitimes : ajouter une colonne à une
 * table peuplée, remplir cette colonne, changer une contrainte. Elles ont un
 * point commun qui les rend intéressantes — **après elles, quelqu'un se demande
 * si les données ont suivi**, et c'est à cet instant précis, mesuré sur le banc
 * de découvrabilité, qu'un agent a répondu « réinitialisons la base pour
 * vérifier », emportant la ligne témoin qu'il devait justement préserver.
 *
 * Un lot purement `CREATE TABLE` ne pose pas la question : il n'y avait rien
 * avant. C'est ce qui distingue un schéma initial d'une évolution.
 */
const TOUCHE_LES_LIGNES: readonly RegExp[] = [
  /\bALTER\s+TABLE\b/i,
  /\bUPDATE\s+/i,
  /\bINSERT\s+INTO\b/i,
  /\bDELETE\s+FROM\b/i,
];

/**
 * Ce lot de migrations touche-t-il des lignes qui existaient déjà ?
 *
 * @param files - migrations sur le point d'être appliquées.
 * @returns vrai dès qu'une instruction modifie une table existante.
 */
export function touchesExistingRows(
  files: readonly { statements: readonly string[] }[],
): boolean {
  for (const file of files) {
    for (const statement of file.statements) {
      if (TOUCHE_LES_LIGNES.some((re) => re.test(statement))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Comment vérifier qu'une migration a préservé les données — **en UN geste**.
 *
 * Cette phrase existe parce que la sortie de SUCCÈS ne disait rien. Le produit
 * annonçait « ✓ 1 migration appliquée » et s'arrêtait là ; l'agent à qui l'on
 * demandait de prouver que les données avaient suivi n'avait aucun moyen sous
 * les yeux, et celui qu'il inventait — repartir d'une base vide — détruit
 * précisément ce qu'il fallait observer.
 *
 * 🔴 Elle NOMME la base, et c'est ce qui manquait au premier jet. Dire « une
 * copie de la base » sans dire laquelle laisse deviner un chemin : mesuré au
 * banc, l'agent a suivi le conseil, visé le mauvais fichier, vu son `cp`
 * échouer en silence, puis FABRIQUÉ une base au client SQL — avec une table
 * d'historique inventée. La migration a été refusée sur cette base bancale, et
 * c'est ce refus qui l'a renvoyé détruire la vraie. Le produit connaissait
 * pourtant l'emplacement : il le publie dans sa propre sortie.
 *
 * Elle nomme aussi les deux interpréteurs : « VAR=x commande » est de la
 * syntaxe POSIX, que celui de Windows refuse.
 *
 * @param connector - connecteur visé, pour composer la commande.
 * @param cible - la base telle que le rapport la publie (`driver.target`),
 *   et son dialecte : on copie un FICHIER en sqlite, on exporte ailleurs.
 * @returns la phrase à rendre après une application réussie.
 */
export function verifierLesDonnees(
  connector: string,
  cible?: { dialect: string; target?: string },
): string {
  const suffixe = connector === "default" ? "" : ` --connector ${connector}`;
  const sqlite = cible?.dialect === "sqlite";
  const nommee = cible?.target ?? "<la base de ce connecteur>";
  // 🔴 Comment OBTENIR la copie, pas seulement quoi en faire. Une base
  // d'historique écrite à la main n'a pas les colonnes du framework, et la
  // migration y échoue pour une raison qui n'a rien à voir avec elle.
  const copie = sqlite
    ? `copie le fichier « ${nommee} » (par exemple vers « essai.db ») — ne la RECRÉE pas à la main, l'historique du framework a ses propres colonnes`
    : `fabrique la copie par un export du moteur (« pg_dump » / « mysqldump ») depuis « ${nommee} » — ne la RECRÉE pas à la main, l'historique du framework a ses propres colonnes`;
  const url = sqlite ? "sqlite:essai.db" : "<url de la copie>";
  return (
    "Ces migrations ont modifié des tables qui portaient déjà des lignes. " +
    "Pour VÉRIFIER que les données ont suivi, ne repars pas d'une base " +
    "vide : ce sont ces lignes-là qui sont la réponse, les effacer efface la " +
    "question. Deux moyens. Compter et regarder sur place — « SELECT " +
    "COUNT(*) » sur les tables touchées, et les valeurs des colonnes " +
    "nouvellement remplies. Ou rejouer le même lot sur une COPIE, sans " +
    `toucher à celle-ci : ${copie}, puis désigne-la par ` +
    `NF_MIGRATE_DATABASE_URL :\n  NF_MIGRATE_DATABASE_URL=${url} nodefony orm:migrate${suffixe}\n` +
    `  (PowerShell : $env:NF_MIGRATE_DATABASE_URL = "${url}" ; ` +
    `nodefony orm:migrate${suffixe})`
  );
}
