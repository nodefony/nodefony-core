/**
 * Logo officiel Nodefony (arcs bleu/vert/cyan, PNG 41×64, transparent : lisible
 * sur thème clair comme sombre).
 *
 * Importé depuis le paquet `nodefony` — SOURCE UNIQUE du logo, que le site de
 * documentation, les rapports, le thème Keycloak et les applications générées
 * reprennent aussi. Vite l'émet comme un fichier du bundle : aucune copie ici.
 */
import logoUrl from "nodefony/assets/nodefony-logo.png";

/** URL du logo dans le bundle — le favicon de la console la reprend (`main.tsx`). */
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
