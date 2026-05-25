/**
 * Offsets de mise en page Studio — SOURCE DE VÉRITÉ UNIQUE.
 *
 * Tout dérive des variables CSS du shell (header global + barre debug) — JAMAIS
 * de « magic number » (250px, 110px…) dispersé dans les pages. Modèle docs-site :
 * un seul scroll de page (le contenu), des panneaux latéraux STICKY pleine
 * hauteur avec leur propre overflow.
 */
const HEADER = "var(--app-shell-header-height, 56px)";
const DEBUGBAR = "var(--nodefony-debugbar-height, 0px)";
const GAP = "var(--mantine-spacing-md, 16px)";
/** Hauteur approx. d'un PageHeader sticky (titre + sous-titre + actions). */
const PAGE_HEADER = "76px";

/** Top d'un élément collé sous le header global. */
export const STICKY_TOP = HEADER;

/**
 * Top d'un panneau sticky placé SOUS un PageHeader lui-même sticky (sinon le
 * panneau se colle au même niveau et passe DERRIÈRE le PageHeader opaque).
 */
export const CONTENT_STICKY_TOP = `calc(${HEADER} + ${PAGE_HEADER})`;

/** Hauteur max d'un panneau latéral sticky (sidebar nav / sommaire). */
export const SIDEBAR_MAX_HEIGHT = `calc(100vh - ${HEADER} - ${PAGE_HEADER} - ${DEBUGBAR} - ${GAP} * 2)`;

/** Marge d'ancre : un titre cible ne passe pas sous l'en-tête sticky au saut. */
export const HEADING_SCROLL_MARGIN = `calc(${HEADER} + ${GAP} * 3)`;
