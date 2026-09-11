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
/* 🔴 L'encre du THÈME SOMBRE. La correction d'origine n'avait couvert qu'un
   seul des deux thèmes : sur fond sombre, le lavis devient foncé et cette
   encre-là, choisie pour être lue sur du clair, tombait à 2,41:1 — bien
   plus bas que le 2,78:1 qui avait motivé sa création. Mesuré sur une
   application générée, pas déduit du CSS.
   Sur un fond sombre il faut une encre CLAIRE (la couleur de marque elle-même) : #41b883 → 5,80:1. */
@media (prefers-color-scheme: dark) {
  :root {
    --nf-accent-ink: #41b883;
  }
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
