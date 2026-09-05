/**
 * Ce qu'un nom de migration a le droit d'être — et ce qu'on propose sinon.
 *
 * **Pourquoi une fonction pure, à part de la commande** : ce nom entre dans le
 * tag du fichier, et un tag ne se renomme plus une fois la migration appliquée
 * quelque part — c'est lui qui dit à chaque base ce qu'elle a déjà reçu. La
 * règle qui le garde mérite donc d'être exerçable sans démarrer une
 * application : un contrôle qui coûte trois minutes est un contrôle qu'on
 * saute.
 */

/**
 * Longueur maximale d'un nom de migration.
 *
 * Le tag complet vaut `NNNN_<nom>` et le fichier `<tag>.sql` : à 120
 * caractères, on reste très en deçà des 255 octets qu'un système de fichiers
 * accepte pour un nom, et loin des 260 caractères qu'un chemin Windows tolère
 * par défaut. La borne n'est pas là pour économiser des octets — elle est là
 * pour qu'un nom trop long échoue AVANT d'avoir écrit un fichier, avec une
 * phrase, plutôt qu'au moment de l'écriture avec un code d'erreur système.
 */
export const MIGRATION_NAME_MAX = 120;

/** Ce qu'un nom peut contenir : minuscules, chiffres et le trait bas. */
const FORME = /^[a-z0-9_]+$/;

/** Un nom doit porter au moins une lettre ou un chiffre — `___` n'en est pas un. */
const SUBSTANCE = /[a-z0-9]/;

/** Verdict d'une vérification de nom. */
export type MigrationNameCheck =
  | { ok: true; name: string }
  | {
      ok: false;
      /** Ce qui ne va pas, en une phrase française. */
      reason: string;
      /**
       * Un nom valide à proposer, quand on peut en dériver un qui a du sens.
       *
       * **Jamais un nom que la commande refuserait ensuite** : proposer un
       * geste qui échoue est pire que ne rien proposer, parce qu'il fait perdre
       * un aller-retour ET la confiance dans les autres suggestions.
       */
      suggestion?: string;
    };

/**
 * Dérive un nom acceptable d'une saisie qui ne l'est pas.
 *
 * @param input - ce que l'utilisateur a tapé.
 * @returns un nom conforme, ou `undefined` s'il n'en reste rien de sensé.
 */
export function suggestMigrationName(input: string): string | undefined {
  const derive = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    // `_` et non `_+` : la ligne au-dessus réduit TOUT run de caractères non
    // alphanumériques à UN SEUL trait bas, donc « __ » ne peut pas exister ici.
    // Le quantifieur était donc inutile — et coûteux : `_+$` doit être réessayé
    // à chaque position de départ, ce qui rend le temps QUADRATIQUE en la
    // longueur de la saisie (js/polynomial-redos). La saisie vient de la ligne
    // de commande, elle n'est pas bornée avant ce point.
    .replace(/^_|_$/g, "")
    .slice(0, MIGRATION_NAME_MAX);
  // Une saisie entièrement non latine (« 日本語 », « ΑΒΓ ») ne laisse que des
  // traits bas : le « nom » proposé serait `0001__`, illisible dans six mois —
  // exactement ce que la règle existe pour éviter.
  return SUBSTANCE.test(derive) ? derive : undefined;
}

/**
 * Vérifie un nom de migration, et dit ce qu'il faudrait taper à la place.
 *
 * @param input - nom reçu de la ligne de commande, éventuellement absent.
 * @returns le verdict, avec sa raison et sa suggestion.
 */
export function checkMigrationName(
  input: string | undefined,
): MigrationNameCheck {
  if (!input) {
    return { ok: false, reason: "Il manque le nom de la migration." };
  }
  if (input.length > MIGRATION_NAME_MAX) {
    return {
      ok: false,
      reason:
        `Le nom fait ${input.length} caractères, la limite est ` +
        `${MIGRATION_NAME_MAX} : il devient un nom de fichier, et un chemin ` +
        `trop long échoue à l'écriture sur certains systèmes.`,
      suggestion: suggestMigrationName(input),
    };
  }
  if (!FORME.test(input)) {
    return {
      ok: false,
      reason:
        `Le nom « ${input} » ne convient pas : minuscules, chiffres et ` +
        `« _ » seulement.`,
      suggestion: suggestMigrationName(input),
    };
  }
  if (!SUBSTANCE.test(input)) {
    return {
      ok: false,
      reason:
        `Le nom « ${input} » ne porte aucune lettre ni chiffre : il ` +
        `produirait un tag que personne ne saura relire.`,
    };
  }
  return { ok: true, name: input };
}
