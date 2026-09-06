/**
 * Catalogue UNIQUE des versions npm émises par les scaffolds (`create app`,
 * `create front`, lots suivants) — la SEULE table à toucher quand une dep
 * tierce bouge. Les paquets `nodefony`/`@nodefony/*` n'y figurent PAS : leurs
 * versions sont dynamiques (`it.nodefonyVersion` = la version du paquet qui
 * scaffolde) → une release du framework ne réécrit AUCUN template.
 *
 * Anti-dérive : `create.test.ts` compare ce catalogue aux versions RÉELLES du
 * monorepo (racine + core) — bumper une dep du repo sans répercuter ici fait
 * échouer le banc, jamais une divergence silencieuse.
 */
export const SCAFFOLD_VERSIONS: Record<string, string> = {
  // ── Backend / outillage (template package.json de l'app) ──
  zod: "^4.4.3",
  // Runtime des helpers TypeScript (`importHelpers`) — dépendance d'un paquet
  // PUBLIABLE : un module local d'application ne l'émet pas, son bundler inline.
  tslib: "2.8.1",
  // Le code GÉNÉRÉ importe `drizzle-orm/<dialecte>-core` en direct (l'entité est
  // du Drizzle natif) : c'est donc une dépendance DE L'APPLICATION, pas seulement
  // du module ORM. Sans elle, la résolution ne tient que par le hissage npm des
  // dépendances transitives — qui n'a pas lieu quand les paquets nodefony sont
  // liés en `file:` (`--link`) : npm les installe dans le checkout, pas à la
  // racine de l'app, et le typecheck échoue sur un import introuvable.
  // Version ÉPINGLÉE comme dans le monorepo : en 0.x la mineure porte les
  // ruptures, et le repository dépend de comportements fins (cf `limit(-1)`).
  "drizzle-orm": "0.45.2",
  // ── Les trois pilotes de base, et pourquoi l'APPLICATION les déclare ──
  //
  // `@nodefony/drizzle` les porte en dépendance de pair OPTIONNELLE : la
  // bibliothèque sait parler aux trois et n'en impose aucun — une application
  // PostgreSQL n'a aucune raison de compiler un binaire natif SQLite, et
  // c'était pourtant le cas (161 Mo d'image, un `node-gyp` pour rien).
  //
  // Mais « optionnel pour la bibliothèque » ne veut pas dire « optionnel pour
  // l'app » — même raison que `@node-rs/argon2` ci-dessous : l'application, elle,
  // OUVRE une base, et une seule. Le scaffold pose donc le pilote du dialecte
  // CHOISI, et lui seul. Sans cette déclaration, npm n'avertit personne de son
  // absence et l'application meurt au premier accès.
  "better-sqlite3": "13.0.3",
  pg: "8.23.0",
  mysql2: "3.24.3",
  // L'outil qui ÉCRIT les migrations, piloté par `nodefony orm:generate`. Aucun
  // code ne l'importe : c'est une dépendance de DÉVELOPPEMENT, et elle n'a rien
  // à faire dans une image de production, qui APPLIQUE des migrations déjà
  // écrites. Épinglée pour la même raison que `drizzle-orm` : en 0.x la mineure
  // porte les ruptures, et le format du journal qu'il écrit est lu par
  // l'applicateur du framework.
  "drizzle-kit": "0.31.10",
  // Le binding natif du hachage de mots de passe. `@nodefony/user` le déclare
  // en peerDependency OPTIONNELLE — et il a raison : son code l'importe
  // dynamiquement, une app qui ne hache jamais rien n'en a pas besoin. Mais le
  // DÉFAUT du framework est `argon2id` (RFC 9106) et le provisionnement seede
  // un compte au boot : l'application, elle, en a toujours besoin. « Optionnel
  // pour la bibliothèque » ne veut pas dire « optionnel pour l'app ».
  // Sans cette ligne, une application fraîchement générée démarre en
  // développement et MEURT en production — `Cannot find package
  // '@node-rs/argon2'`, échec critique du boot, sur le chemin par défaut.
  "@node-rs/argon2": "^2.0.2",
  "@types/node": "^26.4.0",
  "@typescript/native-preview": "^7.0.0-dev.0",
  oxlint: "^1.75.0",
  prettier: "^3.9.5",
  rolldown: "^1.2.7",
  typescript: "^6.0.3",
  vitest: "^5.0.0",
  // ── Frontend (consommées par FRONTEND_PARAMS) ──
  vite: "^8.1.4",
  react: "^19.2.7",
  "react-dom": "^19.2.7",
  "@vitejs/plugin-react": "^6.0.3",
  "@types/react": "^19.2.17",
  "@types/react-dom": "^19.2.3",
  vue: "^3.5.39",
  "@vitejs/plugin-vue": "^6.0.7",
  svelte: "^5.56.8",
  "@sveltejs/vite-plugin-svelte": "^7.3.0",
  "@angular/core": "^22.1.5",
  "@angular/common": "^22.1.5",
  "@angular/platform-browser": "^22.1.5",
  "@analogjs/vite-plugin-angular": "^2.7.1",
  "@angular/build": "^22.1.7",
  "@angular/compiler-cli": "^22.1.5",
};

/** Sous-ensemble du catalogue (helper des tables par framework). */
export function pick(...names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const v = SCAFFOLD_VERSIONS[n];
    if (!v) {
      throw new Error(`version absente du catalogue scaffold : ${n}`);
    }
    out[n] = v;
  }
  return out;
}
