/**
 * Logo officiel Nodefony (arcs bleu/vert/cyan, PNG 41×64, transparent : lisible
 * sur thème clair comme sombre).
 *
 * Importé depuis le paquet `nodefony` — SOURCE UNIQUE du logo, que le site de
 * documentation, les rapports, le thème Keycloak et les applications générées
 * reprennent aussi. Aucune copie dans ce fichier.
 *
 * 🔴 `?inline`, et pas un import d'URL : en développement, la page est servie
 * par Nodefony et le module par Vite, sur une AUTRE origine. Une URL d'asset
 * rendue par Vite (`/@fs/…`) se résout contre l'origine de la PAGE → 404, logo
 * absent. Inliné au build, le logo ne dépend d'aucune origine — dev comme prod.
 */
import logoUrl from "nodefony/assets/nodefony-logo.png?inline";

/** Le logo, inliné par Vite — le favicon de la console le reprend (`main.tsx`). */
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
