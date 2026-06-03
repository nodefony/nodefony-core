/**
 * Codes de sortie standardisés — convention BSD `sysexits.h` (FreeBSD
 * `sysexits(3)`). Ce n'est PAS un RFC, mais le standard de facto Unix pour des
 * exit codes porteurs de sens, au-delà du binaire POSIX `0`/non-zéro. Permet à un
 * script appelant de distinguer un « mauvais usage » d'une « erreur interne » ou
 * d'une « config invalide ».
 *
 * Nodefony n'utilise qu'un sous-ensemble pertinent côté CLI ; les valeurs sont
 * celles de `sysexits.h` (ne pas les renuméroter).
 */
export enum SysExit {
  /** Succès. */
  OK = 0,
  /** Mauvais usage : commande inconnue, arguments/options invalides. */
  USAGE = 64,
  /** Donnée d'entrée incorrecte (format/contenu). */
  DATAERR = 65,
  /** Entrée requise introuvable (fichier/ressource absent). */
  NOINPUT = 66,
  /** Service requis indisponible (dépendance non démarrée/enregistrée). */
  UNAVAILABLE = 69,
  /** Erreur interne du logiciel (bug, exception non gérée au boot). */
  SOFTWARE = 70,
  /** Erreur de configuration. */
  CONFIG = 78,
}

export default SysExit;
