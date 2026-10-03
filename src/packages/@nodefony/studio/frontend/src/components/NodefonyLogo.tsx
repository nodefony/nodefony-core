/**
 * Logo officiel Nodefony (arcs bleu/vert/cyan, PNG 41×64, transparent : lisible
 * sur thème clair comme sombre).
 *
 * Importé depuis le paquet `nodefony` — SOURCE UNIQUE du logo, que le site de
 * documentation, les rapports, le thème Keycloak et les applications générées
 * reprennent aussi. Aucune copie dans ce fichier.
 *
 * Un import d'URL ordinaire : en développement, l'URL que Vite rend
 * (`/_vite/<famille>/@fs/…`) est relative à la page, servie par Nodefony, qui
 * la relaie vers Vite (`@nodefony/frontend`, `devBasePath`) ; en production,
 * elle sort du build sous le `publicPath` de la console.
 */
import logoUrl from "nodefony/assets/nodefony-logo.png";

/** URL du logo — le favicon de la console la reprend (`main.tsx`). */
export const NODEFONY_LOGO_URL: string = logoUrl;

/** Affiche le logo Nodefony. `height` en px (largeur auto, ratio conservé). */
export function NodefonyLogo({ height = 28 }: { height?: number }) {
  return (
    <img
      src={NODEFONY_LOGO_URL}
      alt="Nodefony"
      height={height}
      style={{ height, width: "auto", display: "block" }}
      draggable={false}
    />
  );
}

export default NodefonyLogo;
