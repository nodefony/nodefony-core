/**
 * API publique de `DevkitService` (injectable, nom `devkit`).
 *
 * L'interface est le CONTRAT : ce que les autres modules (et Studio) peuvent
 * appeler. Tout ce qui n'est pas ici est un détail d'implémentation, libre de
 * changer.
 */
export interface IDevkitService {
  /** Snapshot de lecture — état courant du service. */
  status(): { ready: boolean };

  /**
   * Carte de visite de l'application, DÉRIVÉE de l'état du Kernel.
   *
   * Le module ne stocke rien en propre : ce qu'il rend est recalculé à la
   * lecture. Une carte mise en cache mentirait au premier module ajouté.
   */
  getCard(): IDevkitCard;
}

/** Identité de l'application qui répond. */
export interface IDevkitAppInfo {
  /** Nom de l'application. */
  name: string;
  /** Version déclarée par son `package.json`. */
  version: string;
  /** Environnement de run (`development`, `production`, `staging`…). */
  environment: string;
}

/**
 * Une PORTE : un endroit où aller chercher la suite.
 *
 * Volontairement plat et ORDONNÉ (un tableau, pas un objet indexé) : ce qui est
 * lu en premier est ce qui compte, et un lecteur qui s'arrête au milieu garde le
 * plus utile. Mesuré au banc : un agent lit la tête d'un fichier, pas sa fin.
 */
export interface IDevkitDoor {
  /** Ce que la porte ouvre, en quelques mots. */
  titre: string;
  /** URL servie, ou chemin de fichier relatif à la racine de l'application. */
  ou: string;
  /** Pourquoi y aller — la raison, pas la description. */
  pourquoi: string;
}

/**
 * Un VERBE : une commande à lancer.
 *
 * ⚠️ Toujours préfixée `npx` — le binaire vit dans les `node_modules` de
 * l'application, et `nodefony` nu rend 127.
 */
export interface IDevkitVerb {
  /** Commande complète, prête à coller dans un terminal. */
  commande: string;
  /** Ce qu'elle répond. */
  pourquoi: string;
}

/** La carte de visite complète de l'application. */
export interface IDevkitCard {
  app: IDevkitAppInfo;
  /** Version du framework qui sert cette application. */
  nodefony: { version: string };
  /** Modules chargés, triés. */
  modules: string[];
  /** Où aller, par valeur décroissante. */
  portes: IDevkitDoor[];
  /** Quoi lancer, par valeur décroissante. */
  verbes: IDevkitVerb[];
}

/**
 * État minimal dont {@link IDevkitCard} se dérive.
 *
 * INJECTÉ, jamais lu : c'est ce qui rend la construction de la carte éprouvable
 * sans Kernel ni serveur, et ce qui l'empêche d'inventer quoi que ce soit.
 */
export interface IDevkitCardInput {
  appName: string;
  appVersion: string;
  nodefonyVersion: string;
  environment: string;
  /** Noms courts des modules chargés (la clé du conteneur, pas le nom npm). */
  modules: string[];
}
