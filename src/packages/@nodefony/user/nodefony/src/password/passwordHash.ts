/**
 * Empreinte tronquée d'un mot de passe, pour la seule comparaison à une liste.
 *
 * ⚠️ Ce n'est PAS un hachage de stockage : SHA-1 tronqué n'est ni lent ni salé,
 * et ne doit jamais toucher un mot de passe persisté — c'est le rôle de
 * `IPasswordEncoder` (bcrypt/argon). Ici, l'enjeu est inverse : comparer 40 Ko
 * d'empreintes sans embarquer un seul mot de passe en clair.
 *
 * La règle vit ici plutôt que dans le générateur ET dans la politique, parce que
 * deux copies d'une même troncature divergeraient en silence : la liste
 * deviendrait muette, et le contrôle passerait pour vert.
 */
import { createHash } from "node:crypto";

/**
 * Les 4 premiers octets du SHA-1, en entier non signé.
 *
 * @param plain - mot de passe candidat.
 * @returns l'empreinte tronquée, comparable aux entrées de la liste.
 */
export function truncatedPasswordHash(plain: string): number {
  return createHash("sha1").update(plain, "utf8").digest().readUInt32BE(0);
}
