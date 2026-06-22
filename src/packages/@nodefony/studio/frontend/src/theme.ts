import { createTheme, Modal, type MantineColorsTuple } from "@mantine/core";

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
    components: {
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
