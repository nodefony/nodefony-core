import {
  type DecoratedClass,
  type RepositoryMetadata,
  setRepositoryMeta,
} from "./metadataStore";

/**
 * Options du décorateur {@link repository}.
 */
export interface RepositoryOptions {
  /** Nom logique de l'entité gérée par ce repository. */
  entity: string;

  /** ORM cible — lève l'ambiguïté si l'entité existe pour plusieurs ORM. */
  orm?: string;
}

/**
 * Décore une classe comme repository d'une entité (tag métadonnée pur).
 *
 * Stocke le lien repo↔entity dans un `WeakMap` (cf. `metadataStore`, sans
 * `reflect-metadata`). N'enregistre RIEN dans un registre en P5.3 : le binding
 * DI (`@Inject('repository.user.db_principale')`) est câblé par l'adapter ORM
 * concret (P5.4+), qui scanne ces métadonnées. Coût uniquement au chargement
 * du module — jamais par requête.
 *
 * @param name - nom logique du repository (clé DI, ex. `"repository.user"`).
 * @param options - entité gérée + ORM cible optionnel.
 * @returns le décorateur de classe (renvoie la classe inchangée).
 *
 * @example
 * ```ts
 * \@repository("repository.user", { entity: "User", orm: "db_principale" })
 * class UserRepository implements IRepository<User> { ... }
 * ```
 */
export function repository(name: string, options: RepositoryOptions) {
  return <T extends DecoratedClass>(target: T): T => {
    const meta: RepositoryMetadata = {
      name,
      entity: options.entity,
      orm: options.orm,
      target,
    };
    setRepositoryMeta(target, meta);
    return target;
  };
}
