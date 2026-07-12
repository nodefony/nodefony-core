/**
 * Config @nodefony/studio. Surcharge `module-frontend` (@nodefony/frontend).
 */
const config = {
  /**
   * Molette de livraison de l'UI Studio (`resolveUiDelivery`, @nodefony/http) :
   * - `auto`   : Vite si possible (dev + sources + @nodefony/frontend),
   *              sinon assets pré-buildés shippés dans le paquet npm.
   * - `static` : force le pré-buildé (`dist/frontend/`, produit au publish).
   * - `vite`   : force le dev-server HMR (repo self-hosted / contrib).
   */
  ui: "auto" as "auto" | "static" | "vite",
  /**
   * Pas d'auto-mount du `public/` sous `/studio/` par server-static : les assets
   * Studio sont servis sous `/_assets/studio/` (Vite en dev, PrebuiltUi en
   * static). `public/dist` est l'outDir du flux Vite — jamais servi tel quel.
   */
  publicMount: false as const,
  "module-frontend": {
    // HTTPS Vite avec certs Nodefony — évite mixed-content quand la page
    // est servie par server-https (5152).
    https: true,
  },
};

export default config;
