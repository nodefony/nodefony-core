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
  /* Encre : la MÊME teinte, assez foncée pour être lue SUR le lavis.
     La couleur de marque ne se négocie pas ; sa luminosité, si — écrire
     `--nf-accent` sur `--nf-accent-wash` donnait 2,78:1, sous le seuil AA. */
  --nf-accent-ink: #a30024;
  --nf-accent-glow: rgba(221, 0, 49, 0.28);
  --nf-accent-wash: rgba(221, 0, 49, 0.1);
  --nf-accent-line: rgba(221, 0, 49, 0.3);
  --nf-logo-anim: nf-pulse 4s ease-in-out infinite;
}
/* 🔴 L'encre du THÈME SOMBRE. La correction d'origine n'avait couvert qu'un
   seul des deux thèmes : sur fond sombre, le lavis devient foncé et cette
   encre-là, choisie pour être lue sur du clair, tombait à 2,15:1 — bien
   plus bas que le 2,78:1 qui avait motivé sa création. Mesuré sur une
   application générée, pas déduit du CSS.
   Sur un fond sombre il faut une encre CLAIRE : #e84f71 → 4,82:1. */
@media (prefers-color-scheme: dark) {
  :root {
    --nf-accent-ink: #e84f71;
  }
}
@keyframes nf-pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.07);
  }
}
