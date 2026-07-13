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
  "@types/node": "^26.1.1",
  "@typescript-eslint/eslint-plugin": "^8.63.0",
  "@typescript-eslint/parser": "^8.63.0",
  "@typescript/native-preview": "^7.0.0-dev.0",
  eslint: "^10.6.0",
  "eslint-config-prettier": "^10.1.8",
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
