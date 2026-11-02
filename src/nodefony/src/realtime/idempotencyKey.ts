/**
 * Une clé d'idempotence neuve : UUID v4 quand l'environnement l'offre, sinon
 * une chaîne horodatée et aléatoire (page servie hors contexte sécurisé, où
 * `crypto.randomUUID` n'existe pas).
 *
 * Isomorphe : la socket cliente en pose une sur chaque écriture du pont, et un
 * client HTTP la réutilise sur son repli (`Idempotency-Key`) pour que le serveur
 * dédoublonne les deux tentatives.
 *
 * @returns une clé unique pour une écriture.
 */
export function createIdempotencyKey(): string {
  // Lu en `unknown` : ce fichier neutre ne suppose ni DOM ni Node, donc pas
  // `crypto` — sa présence se CONSTATE.
  const crypto: unknown = Reflect.get(globalThis, "crypto");
  if (typeof crypto === "object" && crypto !== null) {
    const randomUUID: unknown = Reflect.get(crypto, "randomUUID");
    if (typeof randomUUID === "function") {
      const id: unknown = Reflect.apply(randomUUID, crypto, []);
      if (typeof id === "string") return id;
    }
  }
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
