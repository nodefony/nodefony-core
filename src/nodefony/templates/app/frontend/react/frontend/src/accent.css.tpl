/*
 * Accent React — sa couleur et l'animation de son logo.
 *
 * La mise en page et la palette de la démonstration vivent dans
 * `showcase.css`, PARTAGÉE par les trois vitrines : seules ces variables
 * changent d'un framework à l'autre.
 *
 * Pourquoi un fichier CSS et non le bloc de styles du composant : Angular
 * renomme les `@keyframes` déclarés dans `styles: [...]` (encapsulation de
 * vue) — l'animation nommée par la variable ne serait alors plus trouvée.
 * Les trois vitrines utilisent donc le même mécanisme, un import CSS que
 * Vite injecte globalement.
 */

:root {
  --nf-accent: #149eca;
  --nf-accent-glow: rgba(97, 218, 251, 0.35);
  --nf-accent-wash: rgba(97, 218, 251, 0.14);
  --nf-accent-line: rgba(97, 218, 251, 0.35);
  --nf-logo-anim: nf-spin 16s linear infinite;
}
@keyframes nf-spin { to { transform: rotate(360deg); } }
