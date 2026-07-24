/*
 * Accent Angular — sa couleur et l'animation de son logo.
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
  --nf-accent: #dd0031;
  --nf-accent-glow: rgba(221, 0, 49, 0.28);
  --nf-accent-wash: rgba(221, 0, 49, 0.1);
  --nf-accent-line: rgba(221, 0, 49, 0.3);
  --nf-logo-anim: nf-pulse 4s ease-in-out infinite;
}
@keyframes nf-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.07); }
}
