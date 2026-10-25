/**
 * Libellé qu'écrit le noyau quand une erreur de CONFIGURATION interrompt le
 * démarrage — `boot lifecycle: <libellé> de "<module>" — <message>`.
 *
 * Module à part, sans dépendance : `create` le lit dans la sortie d'une
 * commande enfant pour en extraire la cause, et ne doit pas importer le noyau
 * pour autant (il tourne sans démarrage). Une copie du texte côté lecteur
 * divergerait à la première retouche du libellé, et la cause redeviendrait un
 * « code 78 » muet.
 */
export const BOOT_CONFIG_ERROR_LABEL =
  "erreur de CONFIGURATION (boot interrompu)";
