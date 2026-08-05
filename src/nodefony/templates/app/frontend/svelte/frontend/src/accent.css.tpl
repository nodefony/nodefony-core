/*
 * Accent Svelte — sa couleur et l'animation de son logo.
 *
 * La mise en page et la palette de la démonstration vivent dans
 * `showcase.css`, PARTAGÉE par les vitrines : seules ces variables
 * changent d'un framework à l'autre.
 *
 * Pourquoi un fichier CSS et non le bloc de styles du composant : Angular
 * renomme les `@keyframes` déclarés dans `styles: [...]` (encapsulation de
 * vue) — l'animation nommée par la variable ne serait alors plus trouvée.
 * Toutes les vitrines utilisent donc le même mécanisme, un import CSS que
 * Vite injecte globalement.
 */

:root {
  --nf-accent: #ff3e00;
  --nf-accent-glow: rgba(255, 62, 0, 0.35);
  --nf-accent-wash: rgba(255, 62, 0, 0.14);
  --nf-accent-line: rgba(255, 62, 0, 0.35);
  --nf-logo-anim: nf-float 4s ease-in-out infinite;
}
@keyframes nf-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
