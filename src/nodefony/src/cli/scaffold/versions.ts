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
  // Le code GÉNÉRÉ importe `drizzle-orm/<dialecte>-core` en direct (l'entité est
  // du Drizzle natif) : c'est donc une dépendance DE L'APPLICATION, pas seulement
  // du module ORM. Sans elle, la résolution ne tient que par le hissage npm des
  // dépendances transitives — qui n'a pas lieu quand les paquets nodefony sont
  // liés en `file:` (`--link`) : npm les installe dans le checkout, pas à la
  // racine de l'app, et le typecheck échoue sur un import introuvable.
  // Version ÉPINGLÉE comme dans le monorepo : en 0.x la mineure porte les
  // ruptures, et le repository dépend de comportements fins (cf `limit(-1)`).
  "drizzle-orm": "0.45.2",
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
  "@types/node": "^26.1.1",
  "@typescript/native-preview": "^7.0.0-dev.0",
  oxlint: "^1.75.0",
  prettier: "^3.9.5",
  rolldown: "^1.1.5",
  typescript: "^6.0.3",
  vitest: "^4.1.10",
  // ── Frontend (consommées par FRONTEND_PARAMS) ──
  vite: "^8.1.4",
  react: "^19.2.7",
  "react-dom": "^19.2.7",
  "@vitejs/plugin-react": "^6.0.3",
  "@types/react": "^19.2.17",
  "@types/react-dom": "^19.2.3",
  vue: "^3.5.39",
  "@vitejs/plugin-vue": "^6.0.7",
  "@angular/core": "^22.0.6",
  "@angular/common": "^22.0.6",
  "@angular/platform-browser": "^22.0.6",
  "@analogjs/vite-plugin-angular": "^2.6.3",
  "@angular/build": "^22.0.6",
  "@angular/compiler-cli": "^22.0.6",
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
