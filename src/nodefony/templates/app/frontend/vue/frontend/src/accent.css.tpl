/*
 * Accent Vue — sa couleur et l'animation de son logo.
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
  --nf-accent: #41b883;
  /* Encre : la MÊME teinte, assez foncée pour être lue SUR le lavis.
     La couleur de marque ne se négocie pas ; sa luminosité, si — écrire
     `--nf-accent` sur `--nf-accent-wash` donnait 2,78:1, sous le seuil AA. */
  --nf-accent-ink: #17714b;
  --nf-accent-glow: rgba(66, 184, 131, 0.35);
  --nf-accent-wash: rgba(66, 184, 131, 0.14);
  --nf-accent-line: rgba(66, 184, 131, 0.35);
  --nf-logo-anim: nf-float 4s ease-in-out infinite;
}
@keyframes nf-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-6px);
  }
}
