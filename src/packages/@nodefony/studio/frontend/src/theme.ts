import {
  ActionIcon,
  Code,
  createTheme,
  darken,
  HoverCard,
  isVirtualColor,
  luminance,
  Modal,
  NavLink,
  Tabs,
  type MantineColorsTuple,
  type MantineTheme,
} from "@mantine/core";

/** Orange des AVERTISSEMENTS — remplace la teinte `orange` de Mantine. */
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

// Surfaces du schéma SOMBRE — celles de la barre de debug (noir bleuté, filets
// fins), au lieu des gris neutres de Mantine. Rôles tenus par la bibliothèque :
// 0 texte · 1 texte secondaire (`dimmed`) · 2 placeholder · 4 bordures ·
// 5 survol · 6 champs et boutons neutres · 7 fond de page et cartes ·
// 8 panneau de marque de la connexion (le `--nf-login-hero-bg` de login.css).
const nodefonyDark: MantineColorsTuple = [
  "#cfd3d8",
  "#a3a9b2",
  "#8a9099",
  "#5d646d",
  "#2a2e36",
  "#22262e",
  "#1c1f26",
  "#14161a",
  "#0f1114",
  "#0b0c0e",
];

const BASE = {
  defaultRadius: "md" as const,
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontFamilyMonospace:
    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  headings: { fontWeight: "600" },
};

/**
 * Construit le thème de Studio : UN thème figé, sombre et clair, que
 * l'application ne surcharge pas — la console garde la même identité dans
 * toutes les applications, et ses contrastes, mesurés une fois, restent vrais.
 *
 * `brand` est le bleu du logo, aplat de l'action principale dans les DEUX
 * schémas (`primaryShade` 6, `#0067ba` : blanc dessus 5,75:1). Les accents
 * écrits `color="brand"` le suivent. Les surfaces sombres sont celles de la
 * barre de debug (`nodefonyDark`), la même famille que la page /login
 * (`nodefony/login.css`) et le thème Keycloak.
 */
export function buildStudioTheme() {
  return createTheme({
    ...BASE,
    colors: {
      orange: nodefonyOrange,
      nodefonyBlue,
      nodefonyGreen,
      nodefonyCyan,
      brand: nodefonyBlue,
      dark: nodefonyDark,
    },
    primaryColor: "brand",
    primaryShade: { light: 6, dark: 6 },
    // Le texte posé SUR un aplat de couleur est choisi par Mantine selon la
    // luminance du fond (clair ou foncé), au lieu d'être blanc par défaut.
    //
    // Pourquoi : un aplat de couleur CLAIRE (un badge `yellow`, une teinte
    // basse d'une famille) sous du texte blanc tombe sous le seuil AA. Plutôt
    // que de corriger chaque site d'appel, le texte s'adapte au fond — une
    // seule ligne, valable pour tous les aplats.
    autoContrast: true,
    components: {
      // Entrée de menu ACTIVE — le fond descend d'un cran dans la MÊME famille
      // de bleu (`brand.7`), plus profond que le `primaryShade`.
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
        // Même exigence de taille de cible que pour `ActionIcon` (WCAG 2.5.8) :
        // les en-têtes de section du portail de documentation, écrits en `xs`,
        // tombaient à 23 px de haut — un pixel sous le seuil, invisible à l'œil
        // et bien réel pour qui vise. Les entrées ordinaires font déjà 33 px :
        // la règle ne change rien pour elles, elle ferme le cas compact.
        // Par `styles` et non `vars` : le résolveur de variables exige une
        // valeur pour CHAQUE état, or il n'existe pas de chaîne signifiant
        // « laisse la valeur par défaut » — et poser une variable vide
        // écraserait ce que la bibliothèque calcule pour l'état inactif.
        styles: (_theme, props) =>
          props.active
            ? {
                root: {
                  color: "var(--mantine-color-white)",
                  minHeight: "24px",
                },
                label: { color: "var(--mantine-color-white)" },
              }
            : { root: { minHeight: "24px" } },
      }),
      // Onglet ACTIF en `pills` — même règle que le `NavLink` : l'aplat descend
      // à `brand.7` au lieu du `primaryShade`. Le libellé blanc sur `brand.4`
      // (`#4792cd`) mesurait **3,35:1** (axe-core, tableau de bord ORM), et
      // `autoContrast` ne corrige pas ce cas : Mantine classe ce bleu parmi
      // les teintes FONCÉES (luminance sous son seuil de 0,3) et garde le
      // blanc. Borné au variant `pills` et à la couleur par défaut : en
      // `default`, la même teinte colore un simple soulignement, qui doit au
      // contraire rester CLAIR pour se voir sur fond sombre ; et un appelant
      // qui choisit sa couleur la garde.
      Tabs: Tabs.extend({
        vars: (_theme, props) => ({
          root: {
            "--tabs-color":
              props.variant === "pills" && props.color === undefined
                ? "var(--mantine-color-brand-7)"
                : undefined,
          },
        }),
      }),
      // Code EN LIGNE : il se coupe au lieu de défiler. Mantine pose
      // `overflow: auto` sur tout `<Code>` ; un nom long (une variable
      // `NF__HTTP__…`) dans une cellule devient alors une zone qui défile sans
      // pouvoir recevoir le focus — axe-core : `scrollable-region-focusable`,
      // 23 fois sur l'écran de configuration, et du contenu hors d'atteinte au
      // clavier. Couper le mot rend tout visible ; le code en BLOC garde son
      // défilement (il est fait pour ça).
      Code: Code.extend({
        styles: (_theme, props) =>
          props.block ? {} : { root: { overflowWrap: "anywhere" } },
      }),
      // Toute commande à icône seule doit pouvoir être ATTEINTE — WCAG 2.2,
      // critère 2.5.8 « Target Size (Minimum) », 24 × 24 px.
      //
      // Mesuré par la sonde d'accessibilité : 40 cibles trop petites sur un seul
      // écran, dont 36 fois le MÊME bouton — l'épinglage d'une entrée de menu, en
      // taille `xs`, soit 18 × 18. Une main qui tremble, un écran tactile, un
      // trackpad : la commande existe et reste hors de portée.
      //
      // La zone grandit, PAS l'icône : `min-width`/`min-height` élargissent la
      // surface cliquable sans toucher à `--ai-size`, qui gouverne le dessin. Le
      // menu garde donc exactement la même densité visuelle. Poser la règle ici
      // plutôt que sur chaque site d'appel, c'est ce qui la rend vraie pour les
      // écrans qu'on n'a pas encore écrits — et le motif est le même que celui du
      // `NavLink` ci-dessus : la règle manquait, ce n'était pas une négligence locale.
      ActionIcon: ActionIcon.extend({
        styles: {
          root: { minWidth: "24px", minHeight: "24px" },
        },
      }),
      // Cartes au survol : atteignables au TOUCHER, et lisibles jusqu'au bout.
      //
      // Mantine 9.7 a changé deux défauts du `HoverCard`, et Studio le monte en dix
      // endroits — dont `DocHint`, lui-même posé sur presque chaque écran :
      //  • `events.touch` passe à `false` — un appui sur tablette n'ouvre plus
      //    rien. L'aide contextuelle, qui ne vit QUE dans ces cartes, devenait
      //    inatteignable sans souris. On le rétablit.
      //  • `interactive` apparaît, à `false` — la carte ne survit au trajet du
      //    pointeur vers elle que par le délai de fermeture (120 à 150 ms), une
      //    course qu'on perd en visant un lien d'une fiche `DocHint` : mesuré au
      //    navigateur, traverser lentement les 16 px qui séparent la puce de
      //    mode de sa carte la FERME. À `true`, la bibliothèque trace un couloir
      //    de sécurité (`safePolygon`) entre la cible et la carte : la même
      //    traversée la laisse ouverte.
      // Le reste du nouveau comportement est un gain qu'on garde tel quel :
      // ouverture au focus clavier, fermeture par `Échap` ou un appui dehors.
      HoverCard: HoverCard.extend({
        defaultProps: { events: { touch: true }, interactive: true },
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

/** Le thème de Studio. */
export const studioTheme = buildStudioTheme();

/**
 * Surcharge des variables CSS Mantine — **contraste du texte secondaire** dans
 * les DEUX schémas, et des **liens** en sombre.
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
 * `gray-7` (`#495057`) atteint ~7,4:1 sur blanc ; `dark-1` (`#a3a9b2`) ~7:1 sur
 * le fond sombre. Dans les deux cas le texte reste nettement en retrait du texte
 * principal : le rôle visuel de « secondaire » est préservé.
 */
/** Seuil WCAG AA du texte courant, avec une marge contre l'arrondi. */
const AA_TEXT = 4.6;

/** Rapport de contraste WCAG entre deux couleurs (luminances de Mantine). */
function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Première teinte de la famille, à partir de `from`, lisible sur `background`.
 *
 * On reste dans la MÊME famille (une teinte plus profonde, jamais une autre
 * couleur) ; si même la plus sombre échoue, on l'assombrit par pas.
 *
 * @returns une référence de variable (`var(--mantine-color-x-8)`) ou une
 *   couleur calculée, et `null` quand la teinte par défaut passe déjà.
 */
function readableShade(
  name: string,
  tuple: readonly string[],
  background: string,
  from: number,
): string | null {
  for (const [i, shade] of tuple.entries()) {
    if (i < from) continue;
    if (contrastRatio(shade, background) >= AA_TEXT) {
      return i === from ? null : `var(--mantine-color-${name}-${i})`;
    }
  }
  const darkest = tuple.at(-1);
  if (darkest === undefined) return null;
  for (let k = 0.1; k <= 0.8; k += 0.1) {
    const c = darken(darkest, k);
    if (contrastRatio(c, background) >= AA_TEXT) return c;
  }
  return null;
}

/**
 * Texte coloré lisible en schéma CLAIR, pour TOUTES les couleurs du thème.
 *
 * Mantine rend en clair `c="<couleur>"` à la teinte 6 (`--…-text` = `filled`),
 * et le texte des variants `light` (badges, alertes) à la teinte 9 sur un fond
 * à la teinte 1. Pour les teintes vives, c'est sous le seuil — mesuré par
 * axe-core en clair sur le tableau de bord ORM et la supervision : titre
 * « Studio » en `nodefonyCyan` à **2,87:1**, badges `yellow` à **2,68:1**,
 * `teal` et `orange` à **4,3:1**. Le défaut n'existe pas en sombre : il
 * n'apparaissait qu'en basculant de thème.
 *
 * Réglé ICI plutôt qu'au site d'appel : chaque couleur reçoit la première
 * teinte de sa propre famille qui passe le seuil, les couleurs déjà conformes
 * ne bougent pas, et un écran à venir en hérite sans y penser.
 */
function readableLightColors(theme: MantineTheme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, tuple] of Object.entries(theme.colors)) {
    if (isVirtualColor(tuple)) continue;
    const text = readableShade(name, tuple, "#ffffff", 6);
    if (text) out[`--mantine-color-${name}-text`] = text;
    const light = readableShade(name, tuple, tuple[1], 9);
    if (light) out[`--mantine-color-${name}-light-color`] = light;
  }
  return out;
}

export const studioCssVariablesResolver = (theme: MantineTheme) => ({
  variables: {},
  light: {
    "--mantine-color-dimmed": "var(--mantine-color-gray-7)",
    ...readableLightColors(theme),
  },
  dark: {
    "--mantine-color-dimmed": "var(--mantine-color-dark-1)",
    // Liens : l'ACCENT de la barre de debug et de la page /login (`#3aa0ff`),
    // ~6:1 sur une carte et ~6,6:1 sur le fond. Un lien est du texte sur le
    // fond, pas un aplat : la teinte par défaut `brand.4` (`#4792cd`) restait
    // sous le seuil AA en 12 px (mesuré par axe-core, tableau de bord ORM).
    "--mantine-color-anchor": "#3aa0ff",
  },
});
