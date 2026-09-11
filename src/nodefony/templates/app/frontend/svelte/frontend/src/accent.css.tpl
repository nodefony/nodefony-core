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
  /* Encre : la MÊME teinte, assez foncée pour être lue SUR le lavis.
     La couleur de marque ne se négocie pas ; sa luminosité, si — écrire
     `--nf-accent` sur `--nf-accent-wash` donnait 2,78:1, sous le seuil AA. */
  --nf-accent-ink: #a62c00;
  --nf-accent-glow: rgba(255, 62, 0, 0.35);
  --nf-accent-wash: rgba(255, 62, 0, 0.14);
  --nf-accent-line: rgba(255, 62, 0, 0.35);
  --nf-logo-anim: nf-float 4s ease-in-out infinite;
}
/* 🔴 L'encre du THÈME SOMBRE. La correction d'origine n'avait couvert qu'un
   seul des deux thèmes : sur fond sombre, le lavis devient foncé et cette
   encre-là, choisie pour être lue sur du clair, tombait à 2,26:1 — bien
   plus bas que le 2,78:1 qui avait motivé sa création. Mesuré sur une
   application générée, pas déduit du CSS.
   Sur un fond sombre il faut une encre CLAIRE : #ff4f17 → 4,84:1. */
@media (prefers-color-scheme: dark) {
  :root {
    --nf-accent-ink: #ff4f17;
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
