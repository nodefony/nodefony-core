import type {
  IDevkitCard,
  IDevkitCardInput,
  IDevkitDoor,
  IDevkitVerb,
} from "../interfaces/IDevkitService";

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
 */
export function buildCard(input: IDevkitCardInput): IDevkitCard {
  const modules = [...input.modules].sort();
  const has = (name: string): boolean => modules.includes(name);

  const portes: IDevkitDoor[] = [
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

  const verbes: IDevkitVerb[] = [
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
    portes,
    verbes,
  };
}
