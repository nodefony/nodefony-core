// Le drizzle-orm **du dépôt**, côté PostgreSQL — celui dont vient le schéma.
//
// Même raison d'être que `repo-drizzle-sqlite.mjs`, qui porte l'explication
// complète et le coût mesuré : un spécificateur nu écrit dans
// `bench-frameworks/` atteint le `node_modules` de ce dossier, alors que le
// schéma vient du `dist` du module test et atteint celui de la racine. Deux
// instances de drizzle, et `is()` perd son chemin rapide sur chaque colonne de
// chaque ligne, sans une erreur ni un avertissement.
//
// Le pilote `pg` passe par ici lui aussi. Il n'est pas dupliqué aujourd'hui
// (absent de `bench-frameworks/node_modules`, donc déjà résolu depuis la
// racine) — mais rien ne le garantit demain, et une installation locale le
// ferait diverger en silence de celui que le produit exécute.
export { drizzle } from "drizzle-orm/node-postgres";
export { eq, sql, getTableColumns, is, Column } from "drizzle-orm";
export { Pool } from "pg";
