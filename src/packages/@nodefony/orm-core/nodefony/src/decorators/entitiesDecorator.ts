import type { Module } from "nodefony";
import type { IEntity } from "../../interfaces/IEntity";
import type { IEntityDefinition } from "../defineEntity";
import { entityRegistry } from "../EntityRegistry";

// Idiome TS des mixins de constructeur — `any[]` requis : un `unknown[]` casse
// l'`extends constructor`. Même contrainte que le mixin `@controllers` du framework.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T = object> = new (...args: any[]) => T;

/** Connecteur retenu quand ni l'entité ni le décorateur n'en nomment un. */
export const DEFAULT_CONNECTOR = "default";

/** Options du décorateur {@link entities}. */
export interface EntitiesOptions {
  /**
   * Connexion nommée pour toutes les entités de la liste (défaut : `"default"`).
   * Une entité qui porte son propre `connector` garde le sien — utile pour une base
   * secondaire (ex. un entrepôt d'analyse) déclarée dans le même module.
   */
  connector?: string;
}

/**
 * Déclare les entités qu'un module apporte — l'équivalent de `@controllers([...])`
 * pour la couche données.
 *
 * ```ts
 * @entities([PostEntity, CommentEntity])
 * @controllers([PostController])
 * class Blog extends Module { … }
 * ```
 *
 * **Pourquoi ce décorateur existe** : l'inscription d'une entité est impérative
 * (`entityRegistry.register()`), et il n'y a aucune découverte automatique. Sans lui,
 * une application n'a **aucun endroit** où déclarer ses entités : elle dépend d'un
 * import à effet de bord, où un fichier simplement oublié donne une entité
 * silencieusement absente — l'erreur n'apparaît qu'au premier `getRepository()`, loin
 * de sa cause. Une liste, elle, se lit.
 *
 * **Phase `onRegister`, jamais `onBoot`** (piège) : les connecteurs se branchent à
 * `onBoot` et créent les tables à ce moment-là. Enregistrer les entités à `onBoot`,
 * comme le fait `@controllers`, en ferait une **course** avec le `connect()` : selon
 * l'ordre des écouteurs, la table n'existerait pas. `onRegister` est strictement
 * antérieur — sûr par construction.
 *
 * **Idempotent** : une entité déjà inscrite pour le même connecteur est ignorée (un
 * module peut être instancié deux fois dans un même processus — tests, rechargement).
 * Une **collision réelle** (deux entités différentes, même nom, même connecteur) reste
 * une erreur levée par le registre : c'est un conflit de modèle, pas un doublon bénin.
 *
 * @param list - descripteurs produits par `defineEntity()` (un seul ou un tableau).
 * @param options - connecteur cible commun.
 * @returns le décorateur de classe `Module`.
 */
export function entities(
  list: IEntityDefinition[] | IEntityDefinition,
  options: EntitiesOptions = {},
): <T extends Constructor<Module>>(constructor: T) => T {
  const definitions = Array.isArray(list) ? list : [list];
  return function <T extends Constructor<Module>>(constructor: T): T {
    class NewConstructorEntities extends constructor {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(...args: any[]) {
        super(...args);
        this.kernel?.once("onRegister", () => {
          this.initDecoratorEntities();
        });
      }

      /** Inscrit les entités déclarées dans le registre, avant toute connexion ORM. */
      initDecoratorEntities(): void {
        for (const definition of definitions) {
          const connector =
            definition.connector ?? options.connector ?? DEFAULT_CONNECTOR;
          if (entityRegistry.has(definition.name, connector)) {
            this.log(
              `ENTITY ${definition.name} (${connector}) déjà enregistrée — ignorée`,
              "DEBUG",
            );
            continue;
          }
          entityRegistry.register({ ...definition, connector } as IEntity);
          this.log(
            `ADD ENTITY : ${definition.name} (connector ${connector})`,
            "DEBUG",
          );
        }
      }
    }
    return NewConstructorEntities;
  };
}
