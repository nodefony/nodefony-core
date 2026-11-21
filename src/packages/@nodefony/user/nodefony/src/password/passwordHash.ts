/**
 * Empreintes tronquées d'un mot de passe, pour la seule comparaison à une liste.
 *
 * ⚠️ Ce n'est PAS un hachage de stockage : SHA-1 tronqué n'est ni lent ni salé,
 * et ne doit jamais toucher un mot de passe persisté — c'est le rôle de
 * `IPasswordEncoder` (bcrypt/argon). Ici, l'enjeu est inverse : comparer une
 * liste d'empreintes sans embarquer un seul mot de passe en clair.
 *
 * La règle vit ici plutôt que dans le générateur ET dans la politique, parce que
 * deux copies d'une même troncature divergeraient en silence : la liste
 * deviendrait muette, et le contrôle passerait pour vert.
 */
import { createHash } from "node:crypto";

/**
 * Les 4 premiers octets du SHA-1, en entier non signé.
 *
 * La liste des mots de passe courants ne se compare plus sur 4 octets mais sur 8
 * (`commonPasswordHash`) : sur 32 bits, un mot de passe sain tombait sur une
 * fausse correspondance environ 2,3 fois sur un million. Cette fonction publique
 * rend toujours la même valeur qu'avant.
 *
 * @param plain - mot de passe candidat.
 * @returns les 4 premiers octets du SHA-1, gros-boutiens, en entier non signé.
 */
export function truncatedPasswordHash(plain: string): number {
  // Le poids fort de la paire : un seul point de hachage pour les deux fonctions.
  return commonPasswordHash(plain)[0];
}

/**
 * L'empreinte d'un mot de passe dans la liste des mots de passe courants : les
 * 8 premiers octets du SHA-1, en deux entiers non signés gros-boutiens.
 *
 * Huit octets plutôt que quatre : sur ~10 000 empreintes, la fausse
 * correspondance passe de ~2,3 × 10⁻⁶ à ~5 × 10⁻¹⁶ par mot de passe. À 32 bits,
 * elle refusait un mot de passe sain à un utilisateur, et une application
 * générée sur ~430 000 ne semait pas son compte admin (mot de passe tiré au
 * hasard par `create app`). Deux `number` plutôt qu'un `bigint` : la recherche
 * binaire compare des entiers sur 32 bits, sans allocation.
 *
 * @param plain - mot de passe candidat.
 * @returns `[poidsFort, poidsFaible]`, comparable aux paires de la liste.
 */
export function commonPasswordHash(plain: string): [number, number] {
  const digest = createHash("sha1").update(plain, "utf8").digest();
  return [digest.readUInt32BE(0), digest.readUInt32BE(4)];
}
