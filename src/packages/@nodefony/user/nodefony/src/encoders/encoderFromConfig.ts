import type { IPasswordEncoder } from "../../contracts/IPasswordEncoder";
import { Argon2idEncoder } from "./Argon2idEncoder";
import { BcryptEncoder } from "./BcryptEncoder";
import { MigratingEncoder } from "./MigratingEncoder";

/**
 * Spécification déclarative d'UN encodeur de mot de passe — miroir structurel
 * de la section `encoders` du schéma Zod de `@nodefony/security` (qui valide
 * bornes et défauts), SANS en dépendre : ce module reste la couche basse,
 * l'inversion de dépendance est préservée (security consomme user, jamais
 * l'inverse).
 */
export interface IEncoderSpec {
  /** Algorithme : `argon2id` (RFC 9106, défaut) ou `bcrypt` (legacy). */
  type: "argon2id" | "bcrypt";
  /** Argon2id : mémoire par hash (KiB). */
  memoryKiB?: number;
  /** Argon2id : passes d'itération. */
  timeCost?: number;
  /** Argon2id : lanes parallèles. */
  parallelism?: number;
  /** bcrypt : coût (ignoré par argon2id). */
  rounds?: number;
}

// Construit l'instance correspondant à une spec (les défauts vivent dans les
// constructeurs des encodeurs — une spec partielle reste sûre).
function buildOne(spec: IEncoderSpec): IPasswordEncoder {
  switch (spec.type) {
    case "bcrypt":
      return new BcryptEncoder(spec.rounds);
    case "argon2id":
      return new Argon2idEncoder({
        memoryKiB: spec.memoryKiB,
        timeCost: spec.timeCost,
        parallelism: spec.parallelism,
      });
  }
}

/**
 * Traduit une liste ORDONNÉE de specs d'encodeurs en encodeur exécutable —
 * le pont entre la section `encoders` de la config sécurité et le
 * {@link UserService}.
 *
 * Sémantique de l'ordre : la **première** spec est l'encodeur PRINCIPAL
 * (produit tous les nouveaux hashs), les suivantes sont les formats LEGACY
 * acceptés en lecture seule — un login réussi sur un hash legacy est re-haché
 * au format principal ({@link MigratingEncoder}, migration transparente).
 *
 * @param specs - specs ordonnées (typiquement `Object.values(config.encoders)`,
 *   l'ordre d'insertion du record fait foi).
 * @returns l'encodeur seul (1 spec), un {@link MigratingEncoder} (N specs), ou
 *   l'Argon2id aux défauts OWASP si la liste est vide (défaut sûr).
 */
export function encoderFromConfig(
  specs: readonly IEncoderSpec[],
): IPasswordEncoder {
  if (specs.length === 0) {
    return new Argon2idEncoder();
  }
  const [primary, ...legacy] = specs.map(buildOne);
  if (legacy.length === 0) {
    return primary;
  }
  return new MigratingEncoder(primary, legacy);
}
