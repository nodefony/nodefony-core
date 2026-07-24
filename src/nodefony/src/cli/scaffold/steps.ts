/**
 * Étapes qui SUIVENT l'écriture d'un scaffold.
 *
 * Le moteur (`engine.ts`) est pur : il écrit des fichiers et s'arrête là. Mais
 * du code écrit n'est pas encore du code qui tourne — il reste à installer les
 * dépendances, construire, vérifier les types. Ces étapes sont donc décrites
 * ICI, une fois, et exécutées par chaque front à sa façon : le CLI hérite du
 * terminal de l'utilisateur, Studio streame chaque ligne sur un canal temps
 * réel. Les deux manières de LES MONTRER sont légitimement différentes ; ce qui
 * ne doit pas diverger, c'est CE QU'ELLES SONT.
 *
 * La commande de chaque étape est figée côté serveur. Un front n'envoie jamais
 * qu'un identifiant d'étape, jamais une ligne de commande : c'est ce qui sépare
 * « piloter un générateur » de « exécuter du shell à distance ».
 */

/** Étapes possibles, dans leur ordre d'exécution naturel. */
export const SCAFFOLD_STEPS = ["install", "build", "typecheck"] as const;

export type TScaffoldStep = (typeof SCAFFOLD_STEPS)[number];

/** Arguments passés à `npm` pour chaque étape. */
export const SCAFFOLD_STEP_COMMANDS: Record<TScaffoldStep, readonly string[]> =
  {
    install: ["install"],
    build: ["run", "build"],
    typecheck: ["run", "typecheck"],
  };

/** Ce que chaque étape apporte — affiché avant de la lancer. */
export const SCAFFOLD_STEP_LABELS: Record<TScaffoldStep, string> = {
  install:
    "installe les dépendances (pour un module, c'est aussi ce qui pose le lien de workspace qui le rend chargeable)",
  build: "construit le code que le kernel chargera (`dist/`)",
  typecheck: "vérifie les types sans rien émettre",
};

/** Une étape connue ? (garde des entrées venues du réseau). */
export function isScaffoldStep(value: unknown): value is TScaffoldStep {
  return (
    typeof value === "string" &&
    (SCAFFOLD_STEPS as readonly string[]).includes(value)
  );
}
