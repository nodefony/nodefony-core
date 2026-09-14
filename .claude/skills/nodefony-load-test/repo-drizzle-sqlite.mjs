// Le drizzle-orm et le pilote SQLite **du dépôt** — ceux dont vient le schéma.
//
// 🔴 POURQUOI CE FICHIER EXISTE, ET POURQUOI IL N'EST PAS DANS `bench-frameworks/`.
//
// Un spécificateur nu se résout depuis le dossier du fichier qui l'écrit. Un
// `import "drizzle-orm"` écrit dans `bench-frameworks/` atteint donc
// `bench-frameworks/node_modules/drizzle-orm` ; le schéma, lui, est importé du
// `dist` du module test, qui atteint `<racine>/node_modules/drizzle-orm`. Même
// version, **deux instances** — et drizzle en souffre en silence :
//
//   is(valeur, type) teste `valeur instanceof type` d'abord. À travers deux
//   copies ce test échoue TOUJOURS, et la fonction se rabat sur la remontée de
//   la chaîne de prototypes en comparant `entityKind`. Mesuré : 0,019 µs par
//   appel sur une seule copie, 0,143 µs à travers deux — ×7,6, sans erreur,
//   sans avertissement, pour un résultat identique.
//
//   `mapResultRow` appelle `is()` trois fois par colonne. Sur 74 colonnes et
//   21 lignes, cela fait ~4 660 appels par requête : le camp qui charge deux
//   copies paie ~0,5 ms de plus par requête que celui qui n'en charge qu'une.
//   C'est l'ordre de grandeur de l'écart que ce banc a publié comme un
//   résultat — voir #402.
//
// Ce fichier vit UN cran au-dessus de `bench-frameworks/`, dans un dossier sans
// `node_modules` : ses spécificateurs nus remontent donc jusqu'à la racine du
// dépôt, exactement comme le fait le schéma. Un camp qui importe d'ici partage
// l'instance du schéma — ce qu'a toute application réelle, qui n'installe
// drizzle qu'une fois.
export { drizzle } from "drizzle-orm/better-sqlite3";
export { eq, sql, getTableColumns, is, Column } from "drizzle-orm";
export { default as Database } from "better-sqlite3";
