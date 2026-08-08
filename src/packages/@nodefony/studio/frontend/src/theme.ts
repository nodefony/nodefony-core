import {
  createTheme,
  Modal,
  NavLink,
  type MantineColorsTuple,
} from "@mantine/core";

/** Palette de marque sélectionnable (réversible à chaud, persistée). */
export type StudioPalette = "orange" | "nodefony";

/** Orange signature historique. */
const nodefonyOrange: MantineColorsTuple = [
  "#fff5e6",
  "#ffe8cc",
  "#ffd199",
  "#ffb866",
  "#ffa040",
  "#ff8c1a",
  "#ff7a00",
  "#e66a00",
  "#cc5d00",
  "#b35100",
];

// Couleurs de marque extraites du logo officiel Nodefony (arcs).
const nodefonyBlue: MantineColorsTuple = [
  "#ebf3f9",
  "#c7def0",
  "#9ec5e5",
  "#73abd9",
  "#4792cd",
  "#217bc3",
  "#0067ba",
  "#00579c",
  "#00467e",
  "#003864",
];
const nodefonyGreen: MantineColorsTuple = [
  "#f0f5ef",
  "#d6e4d3",
  "#b8d0b3",
  "#98bb92",
  "#78a670",
  "#5c9452",
  "#448438",
  "#396f2f",
  "#2e5a26",
  "#25471e",
];
const nodefonyCyan: MantineColorsTuple = [
  "#ebf7fe",
  "#c7eafc",
  "#9edbfa",
  "#73cbf8",
  "#47bbf6",
  "#21acf4",
  "#00a0f2",
  "#0086cb",
  "#006da5",
  "#005683",
];

// `brand` = couleur de marque ACTIVE (alias dynamique). `primaryColor: "brand"`
// + tous les accents en dur écrits `color="brand"` → un seul point de bascule.
// Les autres clés restent dispo (orange réel pour les warnings, vert/cyan accents).
const brandTuple = (palette: StudioPalette): MantineColorsTuple =>
  palette === "nodefony" ? nodefonyBlue : nodefonyOrange;

const BASE = {
  defaultRadius: "md" as const,
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontFamilyMonospace:
    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  headings: { fontWeight: "600" },
};

/**
 * Construit le thème Studio pour une palette donnée.
 *
 * `nodefony` = primary bleu de marque (#0067ba) ; en **dark** on remonte le
 * `primaryShade` (index 4, plus clair) car le bleu de base est sombre et
 * manquerait de contraste sur fond sombre. `orange` = comportement historique.
 */
export function buildStudioTheme(palette: StudioPalette = "nodefony") {
  return createTheme({
    ...BASE,
    colors: {
      orange: nodefonyOrange,
      nodefonyBlue,
      nodefonyGreen,
      nodefonyCyan,
      brand: brandTuple(palette),
    },
    primaryColor: "brand",
    primaryShade:
      palette === "nodefony" ? { light: 6, dark: 4 } : { light: 6, dark: 5 },
    // Le texte posé SUR un aplat de couleur est choisi par Mantine selon la
    // luminance du fond (clair ou foncé), au lieu d'être blanc par défaut.
    //
    // Pourquoi : la couleur de MARQUE ne se négocie pas — c'est la teinte qui
    // fait la ligne graphique. Mais en schéma sombre, `primaryShade: 4` rend
    // `#4792cd`, un bleu assez clair : du texte blanc dessus donne **3,35:1**
    // (mesuré sur le NavLink actif), sous le seuil AA. Le réflexe serait de
    // foncer le bleu — ce serait changer la marque pour un problème de texte.
    // `autoContrast` inverse la charge : le bleu reste `#4792cd`, c'est le
    // texte qui s'adapte. Une seule ligne, valable pour tous les aplats.
    autoContrast: true,
    components: {
      // Entrée de menu ACTIVE — le fond descend d'un cran dans la MÊME famille
      // de bleu (`brand.7`) au lieu du `primaryShade` (index 4 en sombre).
      //
      // Pourquoi : `brand.4` rend `#4792cd`, un bleu assez clair ; le libellé
      // blanc que Mantine pose dessus donne **3,35:1**, sous le seuil AA — c'est
      // l'entrée active du menu, donc l'élément le plus lu de l'écran. Et
      // `autoContrast` ne l'atteint pas : il arbitre le texte des aplats de
      // variant, pas la couleur de fond propre du NavLink.
      //
      // La teinte de marque est préservée — `brand.7` est le même bleu, plus
      // profond (`#00579c` pour la palette nodefony) : on corrige la LUMINOSITÉ,
      // jamais la couleur. Le blanc y passe largement le seuil.
      //
      // ⚠️ Le fond ne suffit PAS : il faut poser le texte AVEC lui.
      //
      // `color` gouverne `--nl-bg`, mais la couleur du libellé vient du
      // `variant` — et le variant par défaut de la bibliothèque rend une
      // nuance FONCÉE. Sur un aplat foncé, cela donne du bleu sur du bleu :
      // mesuré à **1,62:1** en schéma clair (axe-core), quand le seuil AA est
      // à 4,5. Le défaut n'existait qu'en clair, parce qu'en sombre la même
      // variable rend une nuance claire — d'où une palette qui paraît saine
      // tant qu'on ne regarde qu'un seul thème.
      //
      // Les sites d'appel qui passent `variant="filled"` n'étaient pas
      // touchés : c'est bien la RÈGLE qui manquait ici, pas une négligence
      // locale. On la pose donc une fois, pour tous les menus.
      NavLink: NavLink.extend({
        defaultProps: { color: "brand.7" },
        // Par `styles` et non `vars` : le résolveur de variables exige une
        // valeur pour CHAQUE état, or il n'existe pas de chaîne signifiant
        // « laisse la valeur par défaut » — et poser une variable vide
        // écraserait ce que la bibliothèque calcule pour l'état inactif.
        styles: (_theme, props) =>
          props.active
            ? {
                root: { color: "var(--mantine-color-white)" },
                label: { color: "var(--mantine-color-white)" },
              }
            : {},
      }),
      // Fenêtres (Modal) à deux tons, esprit bulles d'aide (DocHint) — sens
      // OPPOSÉ selon le schéma (validé visuellement) :
      //  • CLAIR  : en-tête teinté (gris) sur corps BLANC.
      //  • SOMBRE : en-tête plus CLAIR sur corps plus sombre.
      // Exprimé via `light-dark()` (le couple `default`/`default-hover` donnait un
      // corps « tout blanc » peu lisible en clair). Cohérent sur toutes les
      // fenêtres (détail comme confirmations).
      Modal: Modal.extend({
        styles: {
          content: {
            backgroundColor:
              "light-dark(var(--mantine-color-white), var(--mantine-color-dark-6))",
          },
          header: {
            backgroundColor:
              "light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5))",
            borderBottom: "1px solid var(--mantine-color-default-border)",
          },
        },
      }),
    },
  });
}

/** Thème par défaut (palette Nodefony). */
export const studioTheme = buildStudioTheme();

/**
 * Surcharge des variables CSS Mantine — **contraste du texte secondaire**, dans
 * les DEUX schémas.
 *
 * `c="dimmed"` est le style du texte de second plan (en-têtes de groupes du
 * menu, légendes, métadonnées). Il passait sous le seuil WCAG AA de 4,5:1 des
 * deux côtés, et c'est de loin le premier poste de violations — parce qu'un
 * réglage de palette se répète sur chaque écran :
 *
 * | Schéma  | Rendu Mantine        | Ratio mesuré | Violations   |
 * | ------- | -------------------- | ------------ | ------------ |
 * | clair   | `#868e96` sur blanc  | **3,32:1**   | 34 (sur 65)  |
 * | sombre  | `#828282` sur `#242424` | **4,03:1** | 32 (sur 33)  |
 *
 * Les deux mesures viennent d'audits Lighthouse en PRODUCTION (pages
 * supervision et documentation). Le schéma sombre avait d'abord été écarté sur
 * l'idée qu'un gris clair sur fond sombre passe forcément : il s'en fallait de
 * peu, mais il ne passait pas — un contraste se mesure, il ne se déduit pas de
 * l'impression visuelle.
 *
 * Correctif : monter d'un cran la luminosité utile, sans changer de teinte.
 * `gray-7` (`#495057`) atteint ~7,4:1 sur blanc ; `dark-1` (`#A6A7AB`) ~6:1 sur
 * le fond sombre. Dans les deux cas le texte reste nettement en retrait du texte
 * principal : le rôle visuel de « secondaire » est préservé.
 */
export const studioCssVariablesResolver = () => ({
  variables: {},
  light: {
    "--mantine-color-dimmed": "var(--mantine-color-gray-7)",
  },
  dark: {
    "--mantine-color-dimmed": "var(--mantine-color-dark-1)",
  },
});
