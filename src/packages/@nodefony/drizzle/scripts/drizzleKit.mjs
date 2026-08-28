/**
 * Socle partagé des scripts de migration du module : ce que la génération et le
 * contrôle de dérive doivent voir **pareil**, sous peine de diverger en silence.
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
import { fileURLToPath } from "node:url";

/** Racine du module `@nodefony/drizzle`. */
export const MODULE_ROOT = path.resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
);

/**
 * Dialectes générés, dans l'ordre où ils sont produits.
 *
 * Les trois se génèrent TOUJOURS ensemble : un tag publié sur npm est immuable à
 * vie, donc trois journaux désalignés ne se renumérotent pas.
 */
export const DIALECTS = ["sqlite", "postgres", "mysql"];

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
 * @returns chemin absolu de `bin.cjs`.
 * @throws Error si `drizzle-kit` n'est pas installé.
 */
export function resolveDrizzleKitBin() {
  let dir = MODULE_ROOT;
  for (;;) {
    const candidate = path.join(dir, "node_modules", "drizzle-kit", "bin.cjs");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        "drizzle-kit introuvable — c'est une dépendance de DÉVELOPPEMENT du " +
          "module (`npm install`), jamais une dépendance d'exécution.",
      );
    }
    dir = parent;
  }
}

/** Chemin du journal d'un dialecte. */
export const journalPath = (dialect) =>
  path.join(MODULE_ROOT, "migrations", dialect, "meta", "_journal.json");

/**
 * Lit la suite des tags d'un dialecte, ou `[]` si rien n'a encore été généré.
 *
 * @param dialect - dialecte lu.
 * @returns les tags dans l'ordre du journal.
 */
export function readTags(dialect) {
  const file = journalPath(dialect);
  if (!fs.existsSync(file)) {
    return [];
  }
  const journal = JSON.parse(fs.readFileSync(file, "utf8"));
  return (journal.entries ?? []).map((entry) => entry.tag);
}

/**
 * Lance `drizzle-kit generate` et EXIGE la preuve qu'il a tourné.
 *
 * @param options - `configRel` (configuration, chemin relatif au module), `name`
 *   (nom imposé de la migration), `label` (ce qui est cité dans l'erreur).
 * @returns la sortie complète de l'outil (sortie standard puis sortie d'erreur).
 * @throws Error si le code est non nul, ou si rien ne prouve que la génération a
 *   eu lieu — l'absence de preuve n'est JAMAIS lue comme « rien à faire ».
 */
export function runGenerate({ configRel, name, label }) {
  const result = spawnSync(
    process.execPath,
    [
      resolveDrizzleKitBin(),
      "generate",
      `--config=${configRel}`,
      `--name=${name}`,
    ],
    { cwd: MODULE_ROOT, encoding: "utf8" },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  // Les deux seules fins normales de l'outil. Tout le reste — y compris un code
  // 0 muet — signifie que la génération n'a pas eu lieu.
  const ran = output.includes("No schema changes") || output.includes("[✓]");
  if (result.status !== 0 || !ran) {
    if (isInteractivePromptFailure(output)) {
      throw new Error(
        `Un RENOMMAGE probable a été détecté sur ${label}, et il faut trancher.\n\n` +
          `  drizzle-kit ne peut pas deviner votre intention : une colonne qui\n` +
          `  disparaît et une autre qui apparaît, c'est soit un renommage — les\n` +
          `  données SUIVENT —, soit une suppression puis un ajout — les données\n` +
          `  sont PERDUES. Il pose donc la question, et il n'y a pas de terminal\n` +
          `  ici pour y répondre.\n\n` +
          `  Rejouer la commande dans un terminal interactif :\n` +
          `    npm run generate:migrations -- --name <nom>\n\n` +
          `  ⚠️ Après avoir répondu « renamed », RELIRE le fichier produit : quand\n` +
          `  une colonne est renommée ET que son type change, l'outil n'écrit que\n` +
          `  le renommage et OUBLIE le changement de type (drizzle-orm#3826). Le\n` +
          `  contrôle de dérive (npm run check:migrations) le rattrape.`,
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
 * Refuse tout état où les trois journaux ne portent pas la même suite de tags.
 *
 * @param when - moment du contrôle, cité dans le message.
 * @returns les tags communs aux trois dialectes.
 * @throws Error si deux dialectes divergent.
 */
export function assertJournalsAligned(when) {
  const byDialect = new Map(DIALECTS.map((d) => [d, readTags(d)]));
  const reference = byDialect.get(DIALECTS[0]);
  for (const dialect of DIALECTS.slice(1)) {
    const tags = byDialect.get(dialect);
    const same =
      tags.length === reference.length &&
      tags.every((tag, i) => tag === reference[i]);
    if (!same) {
      throw new Error(
        `Journaux désalignés ${when} : ${DIALECTS[0]} porte ` +
          `[${reference.join(", ")}] et ${dialect} porte [${tags.join(", ")}]. ` +
          `Les trois dialectes se génèrent ENSEMBLE — un tag publié est ` +
          `immuable, donc un désalignement ne se renumérote pas.`,
      );
    }
  }
  return reference;
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
const DESTRUCTIVE_PATTERNS = [
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
const BLOCKING_PATTERNS = [
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
export function auditMigrationSql(sql, dialect) {
  // Les commentaires portent des mots-clés (« DROP COLUMN » dans une phrase) et
  // produiraient des refus fantômes.
  const code = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  const match = (list) =>
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
export function isInteractivePromptFailure(output) {
  return /Interactive prompts require a TTY/i.test(output);
}
