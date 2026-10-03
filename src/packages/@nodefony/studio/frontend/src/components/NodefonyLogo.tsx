/**
 * Logo officiel Nodefony (arcs bleu/vert/cyan, vectoriel, transparent : net à
 * toute taille et sur écran haute densité, lisible sur thème clair comme sombre).
 *
 * Importé depuis le paquet `nodefony` — SOURCE UNIQUE du logo, que le site de
 * documentation, les rapports, le thème Keycloak et les applications générées
 * reprennent aussi. Aucune copie dans ce fichier.
 *
 * Un import d'URL ordinaire : en développement, l'URL que Vite rend
 * (`/_vite/<famille>/@fs/…`) est relative à la page, servie par Nodefony, qui
 * la relaie vers Vite (`@nodefony/frontend`, `devBasePath`) ; en production,
 * Vite l'inline en data-URI (moins de 4 Ko) — c'est le BUILD qui le fait, la
 * source n'en porte aucune copie.
 */
import logoUrl from "nodefony/assets/nodefony-logo.svg";

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
