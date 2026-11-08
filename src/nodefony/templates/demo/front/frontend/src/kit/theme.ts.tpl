/**
 * Le thème de la démo : SOMBRE par défaut, clair au choix du visiteur, et
 * ce choix retenu par le navigateur (`localStorage`) — un réglage
 * d'affichage n'a rien à faire en session serveur, et un visiteur n'en a pas
 * toujours une.
 *
 * Guide pour un agent : brique du KIT. La feuille lit `data-theme` sur
 * `<html>` (jetons `:root[data-theme="dark"]`) ; `applyTheme()` le pose
 * AVANT le premier rendu (appelé à l'import de `App.tsx`), sans quoi la
 * page clignoterait en clair. Le stockage peut manquer (navigation privée,
 * données bloquées) : le thème marche alors pour la page, sans mémoire.
 */

export type DemoTheme = "dark" | "light";

/** La clé du choix dans `localStorage`. */
export const THEME_KEY = "nodefony-demo-theme";

/** Le thème retenu, sinon le sombre. */
export function readTheme(): DemoTheme {
  try {
    return window.localStorage.getItem(THEME_KEY) === "light"
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}

/**
 * Pose le thème sur la page, et le retient quand `remember` est vrai.
 *
 * @param theme - le thème à afficher
 * @param remember - le garder pour les visites suivantes
 */
export function applyTheme(theme: DemoTheme, remember = false): void {
  document.documentElement.dataset.theme = theme;
  if (!remember) return;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Stockage indisponible : le choix vaut pour cette page seulement.
  }
}
