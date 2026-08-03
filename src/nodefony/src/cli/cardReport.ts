/**
 * Composition de la CARTE DE VISITE d'une application — module PUR.
 *
 * Deux portes la servent, et c'est tout l'intérêt de vivre ici :
 * - la CLI (`nodefony card`, standalone 0-boot — `cli/card.ts`), qui répond même
 *   sur une application NON CONSTRUITE ou lancée sans `NODE_ENV` ;
 * - le module `@nodefony/devkit` (route HTTP + service), qui la dérive du Kernel
 *   en marche et connaît alors les modules réellement CHARGÉS.
 *
 * Pourquoi au cœur et non dans le module : une capacité qui doit répondre
 * **sans installation** ou **application cassée** ne peut pas dépendre d'un
 * module, par construction — c'est la règle que `check`, `env` et `inspect`
 * suivent déjà. Le module, lui, importe cette fonction : une seule composition,
 * deux portes, aucune divergence possible.
 */

/** Identité de l'application qui répond. */
export interface ICardAppInfo {
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
export interface ICardDoor {
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
export interface ICardVerb {
  /** Commande complète, prête à coller dans un terminal. */
  commande: string;
  /** Ce qu'elle répond. */
  pourquoi: string;
}

/**
 * D'où vient la liste de modules — et donc ce que la carte a le droit d'affirmer.
 *
 * `runtime` : l'application tourne, ce sont les modules CHARGÉS (le gating
 * `policy`/`when` a déjà eu lieu). `static` : rien n'a démarré, ce sont les
 * modules INSTALLÉS lus dans le `package.json` — un module installé peut très
 * bien ne pas être chargé. La distinction est rendue à l'écran : une carte qui
 * présenterait les deux du même mot mentirait la moitié du temps.
 */
export type CardSource = "runtime" | "static";

/** La carte de visite complète de l'application. */
export interface ICard {
  app: ICardAppInfo;
  /** Version du framework qui sert cette application. */
  nodefony: { version: string };
  /** Modules, triés — chargés ou installés selon {@link ICard.source}. */
  modules: string[];
  /** Ce que `modules` décrit réellement. */
  source: CardSource;
  /** Où aller, par valeur décroissante. */
  portes: ICardDoor[];
  /** Quoi lancer, par valeur décroissante. */
  verbes: ICardVerb[];
}

/**
 * État minimal dont {@link ICard} se dérive.
 *
 * INJECTÉ, jamais lu : c'est ce qui rend la construction de la carte éprouvable
 * sans Kernel ni serveur, et ce qui l'empêche d'inventer quoi que ce soit.
 */
export interface ICardInput {
  appName: string;
  appVersion: string;
  nodefonyVersion: string;
  environment: string;
  /** Noms courts des modules (la clé du conteneur, pas le nom npm). */
  modules: string[];
  /** Ce que `modules` décrit — défaut `runtime` (l'appel historique). */
  source?: CardSource;
}

/**
 * Construit la carte de visite d'une application à partir de son état.
 *
 * Fonction **PURE** : elle reçoit l'état, elle ne le lit pas. C'est ce qui la
 * rend éprouvable sans Kernel ni serveur — et ce qui garantit qu'elle ne peut
 * rien inventer : tout ce qu'elle rend vient de ce qu'on lui a passé.
 *
 * ## Pourquoi les commandes portent `npx`
 *
 * Le binaire `nodefony` vit dans les `node_modules` de l'application : `nodefony`
 * nu rend 127. Mesuré sur agent réel — il recopie la FORME qu'on lui montre, pas
 * la règle écrite à côté. Une seule commande nue suffit à l'envoyer dans le mur
 * au premier geste.
 *
 * @param input - l'état de l'application (injecté, jamais lu ici).
 * @returns la carte, prête à rendre en texte ({@link renderCard}) ou en JSON.
 */
export function buildCard(input: ICardInput): ICard {
  const modules = [...input.modules].sort();
  const has = (name: string): boolean => modules.includes(name);

  const portes: ICardDoor[] = [
    {
      titre: "Les instructions de cette application",
      ou: "AGENTS.md",
      pourquoi:
        "générateurs disponibles, table tâche → fichier, gates à passer. À lire AVANT d'écrire du code.",
    },
    {
      titre: "Le catalogue des briques",
      ou: "node_modules/nodefony/docs/catalogue.md",
      pourquoi:
        "quel module prendre pour quel besoin, et quand ne PAS le prendre.",
    },
    {
      titre: "La documentation des modules installés",
      ou: "node_modules/@nodefony/*/docs/",
      pourquoi:
        "elle est versionnée AVEC le code installé : elle ne peut pas décrire une autre version que la tienne.",
    },
  ];
  if (has("studio")) {
    portes.push({
      titre: "La console d'administration",
      ou: "/nodefony",
      pourquoi:
        "l'application en marche : routes montées, services, config résolue, sessions, journaux.",
    });
  }
  if (has("documentation")) {
    portes.push({
      titre: "L'index de documentation, en JSON",
      ou: "/nodefony/documentation/api/tree",
      pourquoi: "la même documentation, lisible par un programme.",
    });
  }

  const verbes: ICardVerb[] = [
    {
      commande: "npx nodefony check",
      pourquoi:
        "diagnostic STATIQUE : il ne lit que des fichiers, donc il répond même quand l'application ne démarre plus.",
    },
    {
      commande: "npx nodefony inspect routes --json",
      pourquoi:
        "ce qui est VRAIMENT monté, quand le code laisse croire autre chose. Sujets : routes, modules, services, config, stores, entities, graph.",
    },
    {
      commande: "npx nodefony create entity Produit nom:string prix:float",
      pourquoi:
        "l'entité, son service CRUD, son controller REST et ses tests. N'écris jamais à la main ce qu'un générateur produit.",
    },
    {
      commande: "npm test",
      pourquoi: "le premier diagnostic — avant de lire quoi que ce soit.",
    },
  ];

  return {
    app: {
      name: input.appName,
      version: input.appVersion,
      environment: input.environment,
    },
    nodefony: { version: input.nodefonyVersion },
    modules,
    source: input.source ?? "runtime",
    portes,
    verbes,
  };
}

/**
 * Rend la carte pour un HUMAIN (ou un agent qui lit un terminal).
 *
 * PURE : elle ne touche ni au kernel ni au système de fichiers, donc elle
 * s'éprouve seule. Écrite sur `stdout` par ses appelants plutôt que par le
 * journal — une carte de visite n'est pas un événement de log, et le préfixe
 * horodaté rendrait le copier-coller inutilisable.
 *
 * La ligne des modules DIT sa provenance : « chargés » n'est vrai que si
 * l'application tournait au moment de la lecture. Sans cette mention, une carte
 * lue à froid ferait croire que le gating `policy`/`when` a déjà eu lieu.
 *
 * @param card - la carte composée par {@link buildCard}.
 * @returns le texte complet, prêt à écrire tel quel.
 */
export function renderCard(card: ICard): string {
  const froid = card.source === "static";
  const lignes = [
    `${card.app.name} ${card.app.version} — ${card.app.environment} (nodefony ${card.nodefony.version})`,
    "",
    froid
      ? `Modules installés (${card.modules.length}) : ${card.modules.join(", ")}` +
        `\n  ⓘ l'application n'a pas démarré — installés ≠ chargés. Ce qui est vraiment` +
        `\n    monté : npx nodefony inspect modules`
      : `Modules chargés (${card.modules.length}) : ${card.modules.join(", ")}`,
    "",
    "Où aller :",
    ...card.portes.map((p) => `  ${p.ou}\n      ${p.titre} — ${p.pourquoi}`),
    "",
    "Quoi lancer :",
    ...card.verbes.map((v) => `  ${v.commande}\n      ${v.pourquoi}`),
    "",
  ];
  return lignes.join("\n");
}
