/**
 * Lecture d'un en-tête `Authorization: Bearer …`.
 *
 * 🔴 **L'implémentation a déménagé au CŒUR** (`nodefony`), et ce fichier n'en
 * garde que le point d'entrée. Le motif n'est pas cosmétique : deux couches qui
 * ne se voient pas lisent le même en-tête — les authentificateurs d'ici, et le
 * rôle *serveur de ressource* OAuth, qui vit au cœur parce qu'il ne dépend
 * d'aucun module. Une frontière de paquets aurait imposé une copie, et une copie
 * de cette fonction ne diverge pas bruyamment : elle diverge sur un cas limite
 * (`Bearer` sans séparateur, espace insécable, jeton vide) que **chaque copie
 * continue de passer dans ses propres tests**.
 *
 * Ce qui l'a motivée reste vrai et se relit au cœur : le motif d'origine était
 * quadratique, et il s'exécutait avant toute authentification — donc pour un
 * porteur qui n'avait rien prouvé.
 *
 * Les tests d'ici (`tests/unit/bearer.test.ts`, cas anti-ReDoS compris) valent
 * désormais pour l'implémentation du cœur : ils l'atteignent par ce point
 * d'entrée, ce qui est exactement le contrôle qu'on veut sur une brique
 * partagée.
 */
export { bearerToken } from "nodefony";
