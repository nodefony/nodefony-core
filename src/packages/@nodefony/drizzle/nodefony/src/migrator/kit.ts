/**
 * Plomberie `drizzle-kit` — la partie qui ne connaît NI le framework NI
 * l'application, et que les deux exécutent donc à l'identique.
 *
 * Elle vivait dans `scripts/`, qui n'est pas publié (`files` ne porte que
 * `dist`, `docs` et `migrations`). La commande `orm:generate`, elle, tourne chez
 * l'utilisateur : lui laisser dépendre de `scripts/` aurait été livrer un verbe
 * dont la moitié manque au paquet. Le socle a donc rejoint le code publié, et
 * `scripts/` le CONSOMME — une seule implémentation, celle qu'exécutent le dépôt
 * du framework et toute application.
 *
 * 🔴 **Le piège qui justifie ce fichier** : `drizzle-kit` **rend le code 0 quand
 * il échoue**. Une exception non rattrapée part sur la sortie d'erreur et le
 * process sort quand même à zéro. Tout appelant doit donc exiger une **preuve
 * positive** que la génération a eu lieu — c'est le rôle de {@link runGenerate}.
 * Un second piège en découle : le dossier de sortie ne peut pas être ABSOLU
 * (l'outil le préfixe par `./`, fabriquant `.//Users/…`), et l'échec de lecture
 * qui s'ensuit se présente lui aussi comme un succès.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { SqlDialect } from "../../interfaces/IDrizzleConfig";
import { MigrationToolError, outilDeGenerationAbsent } from "./refusals";

/** Ce qu'une règle d'audit rend quand elle reconnaît une instruction. */
export interface IAuditRule {
  /** Identifiant stable de la règle (cité dans les messages et les tests). */
  id: string;
  /** Ce que l'instruction fait à la base. */
  what: string;
  /** La manœuvre sûre — un refus qui ne dit pas quoi faire ne sert à rien. */
  todo: string;
}

/** Verdict d'une relecture de migration. */
export interface IMigrationAudit {
  /** Ce qui détruit des données : refusé sans consentement explicite. */
  destructive: IAuditRule[];
  /** Ce qui verrouille en production : signalé, jamais bloquant. */
  blocking: IAuditRule[];
}

/** Une règle d'audit, avec son motif et les dialectes qu'elle concerne. */
interface IAuditPattern extends IAuditRule {
  pattern: RegExp;
  dialects?: readonly SqlDialect[];
}

/** Marqueur de format posé en tête de chaque `.sql` — la porte de sortie. */
export const FORMAT_MARKER = "-- nodefony:migration format=1";

/**
 * Résout le binaire de `drizzle-kit` sans passer par un lanceur de shell.
 *
 * `npx` est un `.cmd` sous Windows, inexécutable sans `shell: true` — qui
 * rouvrirait une injection par le nom de migration. Le paquet n'exporte pas son
 * binaire (`exports` ne couvre que `.` et `./api`), donc on remonte les dossiers
 * `node_modules` comme le ferait Node.
 *
 * @param from - dossier de départ de la remontée (racine du paquet qui génère,
 *   ou racine de l'application).
 * @returns chemin absolu de `bin.cjs`.
 * @throws Error si `drizzle-kit` n'est pas installé au-dessus de `from`.
 */
export function resolveDrizzleKitBin(from: string): string {
  let dir = from;
  for (;;) {
    const candidate = path.join(dir, "node_modules", "drizzle-kit", "bin.cjs");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // Un refus TYPÉ, pas une `Error` nue : sans lui, la cause tombe dans le
      // fourre-tout des commandes de migration, qui explique toute exception
      // par une base injoignable — et publie deux explications qui se
      // contredisent.
      throw new MigrationToolError(outilDeGenerationAbsent());
    }
    dir = parent;
  }
}

/**
 * Lance `drizzle-kit generate` et EXIGE la preuve qu'il a tourné.
 *
 * @param options - `cwd` (dossier depuis lequel l'outil est lancé — les chemins
 *   de la configuration lui sont relatifs), `configRel` (configuration, chemin
 *   relatif à `cwd`), `name` (nom imposé de la migration), `label` (ce qui est
 *   cité dans l'erreur).
 * @returns la sortie complète de l'outil (sortie standard puis sortie d'erreur).
 * @throws Error si le code est non nul, ou si rien ne prouve que la génération a
 *   eu lieu — l'absence de preuve n'est JAMAIS lue comme « rien à faire ».
 */
export function runGenerate({
  cwd,
  configRel,
  name,
  label,
  regenerateCommand,
}: {
  cwd: string;
  configRel: string;
  name: string;
  label: string;
  /** La commande à rejouer dans un terminal, citée quand l'outil pose une question. */
  regenerateCommand?: string;
}): string {
  const result = spawnSync(
    process.execPath,
    [
      resolveDrizzleKitBin(cwd),
      "generate",
      `--config=${configRel}`,
      `--name=${name}`,
    ],
    { cwd, encoding: "utf8" },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0 || !generationHappened(output)) {
    if (isInteractivePromptFailure(output)) {
      const rejouer =
        regenerateCommand ?? `nodefony orm:generate --name ${name}`;
      throw new Error(
        `Un RENOMMAGE probable a été détecté sur ${label}, et il faut trancher.\n\n` +
          `  drizzle-kit ne peut pas deviner votre intention : une colonne qui\n` +
          `  disparaît et une autre qui apparaît, c'est soit un renommage — les\n` +
          `  données SUIVENT —, soit une suppression puis un ajout — les données\n` +
          `  sont PERDUES. Il pose donc la question, et il n'y a pas de terminal\n` +
          `  ici pour y répondre.\n\n` +
          `  Rejouer la commande dans un terminal interactif :\n` +
          `    ${rejouer}\n\n` +
          `  ⚠️ Après avoir répondu « renamed », RELIRE le fichier produit : quand\n` +
          `  une colonne est renommée ET que son type change, l'outil n'écrit que\n` +
          `  le renommage et OUBLIE le changement de type (drizzle-orm#3826).`,
      );
    }
    throw new Error(
      `La génération n'a pas eu lieu sur ${label} (code ${result.status}). ` +
        `Ne rien conclure de ce silence : l'outil rend 0 même en échec.\n` +
        output.trim(),
    );
  }
  return output;
}

/**
 * La génération a-t-elle EU LIEU ? — lue sur une sortie DÉCOLORÉE.
 *
 * L'outil ne rend pas de code d'échec (il sort 0 même quand il rate) : la seule
 * preuve disponible est un marqueur dans son texte. Encore faut-il le chercher
 * dans le texte, et non dans sa mise en forme.
 *
 * 🔴 **Le piège, payé en intégration continue** : la forge pose `FORCE_COLOR`,
 * l'outil colore alors sa coche — `[`, une séquence d'échappement, `✓`, une
 * autre séquence, `]` — et `"[✓]"` n'est plus une sous-chaîne. La génération
 * réussissait, le fichier était écrit, et l'appelant annonçait qu'elle n'avait
 * pas eu lieu. Vert sur un poste sans terminal, rouge à la forge : la sonde
 * mesurait la présentation.
 *
 * Fonction PURE, pour qu'elle s'éprouve sans lancer un process — une règle qui
 * exige un sous-processus pour être vue rouge n'est jamais vue rouge.
 *
 * @param output - sortie complète de l'outil, telle qu'elle a été capturée.
 * @returns `true` si l'outil dit avoir écrit, ou n'avoir rien eu à écrire.
 */
export function generationHappened(output: string): boolean {
  // Les séquences de style SGR, et elles seules : on ne cherche pas à nettoyer
  // un terminal, seulement à lire un marqueur sans sa couleur.
  const plain = output.replace(/\u001B\[[0-9;]*m/g, "");
  return plain.includes("No schema changes") || plain.includes("[✓]");
}

/**
 * Instructions qui DÉTRUISENT des données, par dialecte.
 *
 * Sources : la documentation PostgreSQL sur les verrous d'`ALTER TABLE`, le
 * comportement constaté de `drizzle-kit`, et le fait — vérifié — que l'outil se
 * décrit lui-même comme une aide à la productivité, pas comme un dispositif de
 * sûreté de déploiement. Aucun générateur de diff ne peut distinguer seul un
 * renommage (les données suivent) d'une suppression suivie d'un ajout (les
 * données disparaissent) : c'est une intention, pas une différence de schéma.
 *
 * Chaque entrée porte le motif, ce qui se passe, et ce qu'il faut faire — le
 * message d'un refus doit dire quoi faire, pas seulement ce qui est refusé.
 */
const DESTRUCTIVE_PATTERNS: readonly IAuditPattern[] = [
  {
    id: "drop-table",
    pattern: /\bDROP\s+TABLE\b/i,
    what: "supprime une table ET toutes ses lignes",
    todo: "sauvegarder, puis appliquer en deux temps (cf expand/contract)",
  },
  {
    id: "drop-column",
    pattern: /\bDROP\s+COLUMN\b/i,
    what: "supprime une colonne ET son contenu, sans retour possible",
    todo:
      "s'il s'agissait d'un RENOMMAGE, regénérer dans un terminal interactif " +
      "et répondre « renamed » : l'outil produit alors un RENAME, qui conserve " +
      "les données",
  },
  {
    id: "alter-column-type",
    pattern: /\bALTER\s+(?:COLUMN\s+)?[`"\w]+\s+(?:SET\s+DATA\s+)?TYPE\b/i,
    what:
      "convertit une colonne : les valeurs qui n'entrent pas dans le nouveau " +
      "type sont perdues ou font échouer la migration à mi-parcours",
    todo:
      "vérifier la conversion sur une copie des données de production avant " +
      "d'appliquer",
  },
  {
    id: "modify-column",
    pattern: /\bMODIFY\s+COLUMN\b/i,
    what: "réécrit une colonne MySQL (type, nullabilité) — mêmes risques",
    todo: "vérifier la conversion sur une copie des données avant d'appliquer",
  },
  {
    id: "truncate",
    pattern: /\bTRUNCATE\b/i,
    what: "vide une table entière",
    todo: "ne jamais laisser une instruction de ce genre dans une migration",
  },
];

/**
 * Instructions qui VERROUILLENT en production sans rien détruire.
 *
 * Elles ne justifient pas un refus — elles doivent être VUES. Le scénario type,
 * largement documenté : un `ALTER TABLE` prend un verrou exclusif, se met en file
 * derrière une requête longue, et toutes les requêtes suivantes s'empilent
 * derrière lui ; le parc de connexions se vide en quelques dizaines de secondes,
 * et l'application rend des 503 alors que la migration, elle, n'a rien de lent.
 */
const BLOCKING_PATTERNS: readonly IAuditPattern[] = [
  {
    id: "create-index-not-concurrent",
    dialects: ["postgres"],
    pattern: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b(?!\s+CONCURRENTLY)/i,
    what:
      "bloque les écritures de la table pendant toute la construction de " +
      "l'index (minutes sur une grande table)",
    todo:
      "sur une table déjà volumineuse en production, appliquer l'index à part, " +
      "en `CREATE INDEX CONCURRENTLY` (hors transaction)",
  },
  {
    id: "set-not-null",
    dialects: ["postgres"],
    pattern: /\bSET\s+NOT\s+NULL\b/i,
    what: "scanne la table entière sous verrou exclusif pour valider chaque ligne",
    todo:
      "ajouter d'abord une contrainte `CHECK … NOT VALID`, la valider à part, " +
      "puis poser le `NOT NULL`",
  },
];

/**
 * Analyse le SQL d'une migration et rend ce qui mérite un refus ou un regard.
 *
 * Volontairement **textuelle** : il ne s'agit pas d'analyser du SQL, mais de
 * refuser de laisser passer sans un mot ce qui détruit des données. Un motif de
 * trop fait poser une question ; un motif de moins fait perdre une table.
 *
 * @param sql - contenu d'un fichier de migration.
 * @param dialect - dialecte concerné (certains risques lui sont propres).
 * @returns `{ destructive, blocking }`, chacun décrivant ce qui a été reconnu.
 */
export function auditMigrationSql(
  sql: string,
  dialect: SqlDialect,
): IMigrationAudit {
  // Les commentaires portent des mots-clés (« DROP COLUMN » dans une phrase) et
  // produiraient des refus fantômes.
  const code = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  const match = (list: readonly IAuditPattern[]): IAuditRule[] =>
    list
      .filter((rule) => !rule.dialects || rule.dialects.includes(dialect))
      .filter((rule) => rule.pattern.test(code))
      .map(({ id, what, todo }) => ({ id, what, todo }));
  return {
    destructive: match(DESTRUCTIVE_PATTERNS),
    blocking: match(BLOCKING_PATTERNS),
  };
}

/**
 * Reconnaît l'échec de `drizzle-kit` faute de terminal interactif.
 *
 * L'outil pose une question — « cette colonne a-t-elle été renommée, ou
 * supprimée puis ajoutée ? » — à laquelle lui seul ne peut pas répondre. Sans
 * terminal, il échoue, et **rend 0**. Sans reconnaissance explicite, l'utilisateur
 * reçoit une pile d'appels de l'outil au lieu de la seule chose qui compte : la
 * question qu'on lui pose, et où y répondre.
 *
 * @param output - sortie complète de l'outil.
 * @returns `true` si l'échec vient d'une question restée sans terminal.
 */
export function isInteractivePromptFailure(output: string): boolean {
  return /Interactive prompts require a TTY/i.test(output);
}

/**
 * Pose le marqueur de format en tête des `.sql` d'un dossier qui ne l'ont pas.
 *
 * Écrit en fins de ligne `\n` quel que soit le système : le dépôt et le gabarit
 * d'application déclarent `* text=auto eol=lf`, sans quoi une copie de travail
 * Windows produirait une fausse dérive à chaque lecture.
 *
 * @param dir - dossier `<sortie>/<dialecte>` dont on marque les fichiers.
 * @returns le nombre de fichiers marqués.
 */
export function stampFormatMarker(dir: string): number {
  if (!fs.existsSync(dir)) {
    return 0;
  }
  let stamped = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".sql")) {
      continue;
    }
    const file = path.join(dir, name);
    const body = fs.readFileSync(file, "utf8");
    if (body.startsWith(FORMAT_MARKER)) {
      continue;
    }
    fs.writeFileSync(file, `${FORMAT_MARKER}\n${body.replace(/\r\n/g, "\n")}`);
    stamped++;
  }
  return stamped;
}
