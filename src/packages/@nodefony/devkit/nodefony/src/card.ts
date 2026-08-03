/**
 * La composition de la carte vit désormais dans le CŒUR
 * (`nodefony` → `src/cli/cardReport.ts`) ; ce fichier n'en est plus que le point
 * d'entrée historique du module.
 *
 * Pourquoi elle a déménagé : la carte doit répondre sur une application **non
 * construite** et dans un terminal **sans `NODE_ENV`** — deux situations où
 * aucun module n'est chargé, celui-ci compris. Une capacité qui doit tenir sans
 * installation ne peut pas dépendre d'un module : c'est la règle que `check`,
 * `env` et `inspect` suivent déjà, et elle est inscrite au `CLAUDE.md` de ce
 * paquet (« y déplacer une capacité qui doit marcher sans installation ou
 * application cassée » est justement ce qu'il interdit).
 *
 * Ce qui reste ici : la porte **HTTP**, servie par `DevkitService` quand le
 * Kernel tourne — elle seule connaît les modules réellement CHARGÉS. Une
 * composition, deux portes, aucune divergence possible.
 */
export { buildCard, renderCard } from "nodefony";
