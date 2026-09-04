/**
 * Le mode MOTEUR quand rien ne le dit — source UNIQUE.
 *
 * Cette règle était écrite à CINQ endroits (`Kernel.environment`, le dernier
 * terme de `Kernel.resolveRuntimeEnv`, `CliDefaultOptions.environment`,
 * `Cli.environment`, et le `??` du constructeur de `Cli`). Cinq copies d'une
 * même décision divergent en silence, et elles avaient déjà divergé : le kernel
 * se déclarait en `production` pendant que la cascade `.env` ne chargeait NI
 * `.env.production` NI `.env.development`, l'application tournant donc dans un
 * mode dont elle n'avait pas la configuration.
 *
 * Module sans aucune dépendance, à côté de `loadEnv` : il est importé par le
 * cœur (`Kernel`), par la couche CLI (`Cli`) et par le lanceur (`bin/nodefony`),
 * qui n'ont pas le droit de se connaître entre eux.
 *
 * @module
 */

import type { EnvironmentType } from "../types/globals";

/**
 * Mode retenu lorsque ni l'environnement ni la commande n'en désignent un.
 *
 * 🔴 **`development`, et c'est un choix de SÛRETÉ.** Le raisonnement, parce
 * qu'il se reprendra le jour où quelqu'un voudra l'inverser :
 *
 * Ce défaut ne s'applique QUE si `NODE_ENV` est absent ET que la commande
 * n'exprime aucune intention. Or aucun serveur ne démarre dans cet état : les
 * trois lanceurs posent leur mode eux-mêmes (`ProdCommand`, `DevCommand`,
 * `ClusterCommand`), et il n'existe pas d'autre façon d'en lancer un. Le défaut
 * ne gouverne donc que les commandes UTILITAIRES — `inspect`, `check`, `env`,
 * `security:*` — tapées, dans leur écrasante majorité, sur un poste de
 * développement. Le défaut doit protéger le cas où l'information manque, et
 * l'information manque là.
 *
 * ⚠️ **Ce n'est pas le « 12-factor » qui le justifie** : sa section Config
 * déconseille au contraire les *environment groups* comme `NODE_ENV`, et rien
 * n'oblige un orchestrateur à le poser. Ce qui garantit le mode en production
 * ici est FACTUEL, pas doctrinal — l'image générée pose
 * `ENV NODE_ENV=production`, et les lanceurs déclarent leur intention. Ce qui
 * relève vraiment du 12-factor est la PRÉCÉDENCE : l'ambiant l'emporte sur
 * l'intention de la commande.
 *
 * Risque résiduel, nommé plutôt que masqué : une commande utilitaire lancée sur
 * un déploiement de production SANS `NODE_ENV` et HORS image officielle partira
 * en `development`. Le symétrique — le poste de développement traité comme la
 * production — est ce qui a réellement cassé trois fois : un jeton émis contre
 * la mauvaise configuration, une inspection montrant les modules de production
 * sur une machine de développement, et un contrôle de banc comparant deux
 * applications distinctes. Aucun n'a levé la moindre erreur.
 */
export const DEFAULT_ENGINE_ENVIRONMENT: EnvironmentType = "development";

/**
 * Le défaut à retenir SELON que `NODE_ENV` a été posé ou non.
 *
 * 🔴 **Poser `NODE_ENV` est un ACTE DE DÉPLOIEMENT ; ne rien poser est l'état
 * d'un poste de développement.** C'est toute la distinction, et l'ignorer a
 * failli coûter cher : une première version de cette règle rendait
 * `development` dès que `NODE_ENV` ne désignait aucun mode moteur — donc pour
 * `staging`, `canary`, `prod-eu`, `test`. Un déploiement de pré-production
 * aurait chargé les modules `policy:"dev"` (console d'administration, outillage
 * de développement) et détaillé ses traces. La suite de tests l'a arrêté.
 *
 * Les valeurs non-moteur ne sont donc PAS traitées comme une absence : elles
 * nomment un déploiement, et un déploiement tourne comme la production. Seule
 * l'absence TOTALE de la variable désigne un poste de développement.
 *
 * Une chaîne vide compte comme POSÉE — on ne peut pas distinguer « vidée par
 * erreur » de « vidée exprès », et le choix conservateur ne coûte qu'une
 * commande utilitaire, là où l'inverse expose une console d'administration.
 *
 * @param nodeEnv - `process.env.NODE_ENV` tel quel, `undefined` s'il est absent.
 * @returns le mode à retenir quand rien d'autre ne le désigne.
 */
export function defaultEngineEnvironment(
  nodeEnv: string | undefined,
): EnvironmentType {
  return nodeEnv === undefined ? DEFAULT_ENGINE_ENVIRONMENT : "production";
}

/**
 * Le mode qu'une ligne de commande EXPRIME — détecté avant tout kernel.
 *
 * Pourquoi en amont : commander ne parse la sous-commande qu'au démarrage du
 * kernel, si bien que `this.environment` reste indéfini pendant les premières
 * lignes du boot. Plusieurs branches en dépendent, et elles ratent sans cette
 * pré-détection. Une commande non reconnue rend `undefined`, et le défaut
 * reprend la main.
 *
 * 🔴 **Seuls les mots de COMMANDE sont examinés — ceux qui précèdent la première
 * option.** La version précédente balayait l'argv ENTIER : n'importe quel mot,
 * où qu'il soit, décidait du mode. `nodefony doctor --env production` faisait
 * ainsi basculer tout le processus en production — il chargeait `.env.production`
 * et les modules de production pour répondre à une question sur le poste, et le
 * catalogue de l'application, refusant de se construire, retombait en silence
 * sur une version périmée. Un argument de valeur n'est pas une intention.
 *
 * Vit ici plutôt que dans le binaire : ce module est la source unique de « quel
 * mode », il est importable, et une règle qu'on ne peut pas importer est une
 * règle qu'on ne peut pas éprouver.
 *
 * @param argv - les arguments APRÈS le binaire (`process.argv.slice(2)`).
 * @returns le mode exprimé par la commande, ou `undefined` si elle n'en exprime aucun.
 */
export function detectEnvironmentFromArgv(
  argv: string[],
): EnvironmentType | undefined {
  for (const a of argv) {
    // La première option clôt les mots de commande : tout ce qui suit est un
    // drapeau ou la VALEUR d'un drapeau, jamais une intention de mode.
    // `break` et non `return` : la sortie unique reste en bas de la fonction.
    if (a.startsWith("-")) break;
    if (a === "development" || a === "dev") return "development";
    // `start` est un ALIAS de `production` (`ProdCommand.alias("start")`) : sans
    // lui, `nodefony start` n'exprimait AUCUNE intention et ne devait son mode
    // qu'au défaut de classe du Kernel. Il tombait du bon côté par accident —
    // un accident qui disparaît le jour où ce défaut change. Un alias qui lance
    // un serveur DOIT être détecté ici.
    if (a === "production" || a === "prod" || a === "start")
      return "production";
    // `cluster` est un runtime PROD (master + workers). Sans cette détection,
    // l'unique Kernel naissait en `development` (env non résolu au constructeur)
    // alors que les workers tournent en production → env incohérent.
    if (a === "cluster") return "production";
  }
  return undefined;
}
