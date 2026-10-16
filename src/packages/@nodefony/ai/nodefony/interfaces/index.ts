// Contrats publics des services du module — un fichier `I<Nom>.ts` par service,
// ré-exporté ici en `export type`. Aucun service aujourd'hui : la porte MCP se
// définit par `defineMcpGate`, elle ne vit pas dans le conteneur.
// Barrel vide gardé à sa place (structure de module) : sans `export`, le
// fichier ne serait pas un module ES.
// oxlint-disable-next-line unicorn/require-module-specifiers -- barrel vide voulu
export {};
