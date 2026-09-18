/**
 * **UUID v7 — l'API de Node quand elle existe, un repli conforme sinon.**
 *
 * `crypto.randomUUIDv7()` n'est arrivé qu'en **Node 24.16.0** — mesuré sur six
 * versions : absent en 24.0, 24.8, 24.12 et 24.14, présent en 24.16 et 24.21.
 * Or le framework déclare `engines: ">=24.0.0"`, et un `import` NOMMÉ de ce
 * symbole est résolu à l'instanciation du module ESM : sur un Node 24 antérieur,
 * l'application meurt **avant d'exécuter une seule ligne**, sur
 * « does not provide an export named 'randomUUIDv7' ». npm n'avertit de rien —
 * le `engines` était satisfait.
 *
 * Constaté en vrai sur l'image `gcr.io/distroless/nodejs24-debian12`, dont le
 * Node est en 24.14.0 : l'image se construit, se lance, et meurt au démarrage.
 *
 * 🔴 **Le repli produit un vrai UUID v7, jamais un v4.** Remplacer l'un par
 * l'autre « en attendant » changerait la SÉMANTIQUE sans rien casser de visible :
 * les identifiants cesseraient d'être triables temporellement, et les index qui
 * comptent là-dessus se fragmenteraient — un défaut de performance qui
 * n'apparaît qu'à la charge, des mois plus tard.
 *
 * @module
 */
import { randomBytes } from "node:crypto";
import * as nodeCrypto from "node:crypto";

/**
 * L'implémentation native, si ce Node la porte.
 *
 * 🔴 Résolue par le NAMESPACE (`import * as`), jamais par un import nommé :
 * c'est toute la différence entre un test possible et un module qui refuse de
 * s'instancier. Un namespace ne promet aucune propriété, donc son absence est
 * une valeur `undefined` — quelque chose qu'un `if` peut voir.
 *
 * 🔴 Et par un import STATIQUE, jamais un `await import(…)` : un `await` au
 * niveau du module le rendrait asynchrone, et cette asynchronie se propagerait
 * à tout ce qui l'importe — `Nodefony`, donc le framework entier. Le test se
 * fait une seule fois, à l'évaluation, pas à chaque appel.
 */
const nativeRandomUUIDv7: (() => string) | null = (() => {
  const crypto = nodeCrypto as unknown as { randomUUIDv7?: () => string };
  return typeof crypto.randomUUIDv7 === "function" ? crypto.randomUUIDv7 : null;
})();

/**
 * Compose un UUID v7 conforme à la RFC 9562 §5.7.
 *
 * Disposition des 128 bits : 48 bits d'horodatage Unix en millisecondes
 * (gros-boutiste), 4 bits de version (`7`), 12 bits aléatoires, 2 bits de
 * variante (`10`), 62 bits aléatoires.
 *
 * ⚠️ Comme l'implémentation de Node, il n'y a **pas de compteur monotone** dans
 * une même milliseconde (§6.2, optionnel) : deux identifiants tirés dans la même
 * milliseconde peuvent s'inverser. Trier des créations se fait sur `createdAt`,
 * jamais sur l'identifiant — c'est vrai des deux implémentations, et c'est ce
 * qui permet à ce repli d'être un remplacement EXACT.
 *
 * @returns UUID v7, format `8-4-4-4-12`
 */
export function composeUuidV7(): string {
  const bytes = randomBytes(16);
  const ms = Date.now();
  // 48 bits d'horodatage, octet de poids fort en premier. `Math.floor` sur les
  // divisions : au-delà de 2^32 les opérateurs binaires de JavaScript tronquent
  // à 32 bits, et l'horodatage serait faux sans qu'aucune erreur ne le dise.
  bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ms / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ms / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;
  // Version 7 sur les quatre bits hauts de l'octet 6.
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  // Variante RFC (`10`) sur les deux bits hauts de l'octet 8.
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}

/**
 * Un UUID v7 — natif si ce Node sait le faire, composé ici sinon.
 *
 * @returns UUID v7, format `8-4-4-4-12`
 */
export function randomUuidV7(): string {
  return nativeRandomUUIDv7 ? nativeRandomUUIDv7() : composeUuidV7();
}

/**
 * Cette exécution emploie-t-elle l'implémentation de Node ?
 *
 * Exposé pour que le banc puisse le CONSTATER au lieu de le déduire d'un numéro
 * de version — une capacité se constate, elle ne se déduit pas.
 *
 * @returns `true` si `crypto.randomUUIDv7` est disponible ici
 */
export function usesNativeUuidV7(): boolean {
  return nativeRandomUUIDv7 !== null;
}
