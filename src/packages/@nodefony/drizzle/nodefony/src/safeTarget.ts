import path from "node:path";
import type { SqlDialect } from "../config/config";

/**
 * Comment DÉSIGNER la base d'un connecteur sans rien faire fuiter.
 *
 * **Pourquoi une règle à part, et pourquoi elle est PURE.** Trois endroits
 * doivent nommer la même base — l'adaptateur, qui la publie au plan
 * d'administration ; les commandes de migration, qui doivent dire sur QUOI
 * elles ont travaillé ; et le rapport d'état, que lisent un humain, un script
 * et une console. Trois rendus recopiés divergeraient, et la divergence serait
 * silencieuse : chacun passerait ses propres tests. Écrite ici, la règle
 * s'éprouve sans base, sans kernel et sans variable d'environnement.
 *
 * Deux familles, deux dangers différents :
 *
 * - **une base FICHIER** (sqlite) : le danger est l'arborescence du serveur —
 *   le nom de l'utilisateur, la structure du disque. Le chemin est donc rendu
 *   RELATIF au répertoire de travail, et se réduit au nom de fichier dès qu'il
 *   sort du projet ;
 * - **une base RÉSEAU** (PostgreSQL, MySQL) : le danger est le compte. Une URL
 *   de migration porte l'identifiant et le mot de passe du seul compte autorisé
 *   à modifier un schéma de production. Seuls l'hôte, le port et le nom de la
 *   base sont rendus — jamais la partie qui précède l'arobase.
 *
 * ⚠️ `redactSecrets` ne couvre PAS ce cas : aucune de ses familles ne masque un
 * mot de passe d'URL. C'est pourquoi cette fonction ne masque pas, elle
 * RECONSTRUIT — on ne publie que les morceaux dont on a décidé qu'ils sont
 * publiables, ce qui reste vrai pour une URL dont la forme nous surprendrait.
 *
 * @param cible - dialecte et coordonnées, telles que la résolution les rend.
 * @param cwd - répertoire de référence pour relativiser un chemin de fichier.
 * @param grammaire - grammaire de chemins à employer. Injectée pour une seule
 *   raison : une fonction qui lit `path` global ne s'éprouve que sur la
 *   plateforme qu'elle décrit, c'est-à-dire jamais ici. Avec `path.win32`, le
 *   cas Windows se joue sur n'importe quel système.
 * @returns une désignation affichable, sans identifiant ni mot de passe.
 */
export function describeTargetSafely(
  cible: { dialect: SqlDialect; filename?: string; url?: string },
  cwd: string = process.cwd(),
  grammaire: typeof path = path,
): string {
  if (cible.dialect === "sqlite") {
    const fichier = cible.filename ?? ":memory:";
    if (fichier === ":memory:" || !grammaire.isAbsolute(fichier)) {
      return fichier;
    }
    const relatif = grammaire.relative(cwd, fichier);
    // Ce chemin VOYAGE — il part dans un rapport lu à l'écran et dans la charge
    // utile `--json`, que des scripts comparent. Il s'écrit donc en `/` sur les
    // trois systèmes : `relative` rend `var\db.sqlite` sous Windows, et deux
    // plateformes publieraient alors deux désignations différentes de la MÊME
    // base. Un chemin qu'on OUVRE s'écrit natif ; celui-ci ne s'ouvre pas.
    return relatif && !relatif.startsWith("..")
      ? relatif.split(grammaire.sep).join("/")
      : grammaire.basename(fichier);
  }
  const defaut = cible.dialect === "postgres" ? "5432" : "3306";
  if (cible.url === undefined || cible.url === "") {
    return cible.dialect;
  }
  try {
    const u = new URL(cible.url);
    return `${u.hostname}:${u.port || defaut}${u.pathname}`;
  } catch {
    // Une URL illisible ne se publie PAS telle quelle : elle pourrait
    // contenir un secret sous une forme qu'on n'a pas su analyser.
    return cible.dialect;
  }
}
