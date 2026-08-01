import { defineNodefonyRolldownConfig } from "nodefony/bundler";

/**
 * Build du module — socle rolldown PARTAGÉ du framework (`nodefony/bundler`),
 * exactement comme l'app : `preserveModules` (l'arborescence source est
 * reproduite dans `dist/`), plateforme node, ESM.
 *
 * `externalDeps` externalise tout ce que le module DÉCLARE (peerDependencies +
 * dependencies) : `nodefony`, `@nodefony/*` et `zod` ne sont pas recopiés dans
 * le bundle — ils sont résolus au runtime depuis les node_modules de l'app.
 * Le Kernel charge ensuite `dist/index.js` par le nom du paquet
 * (manifeste `modules` de `nodefony.config.ts`).
 */
export default defineNodefonyRolldownConfig({ externalDeps: true });
