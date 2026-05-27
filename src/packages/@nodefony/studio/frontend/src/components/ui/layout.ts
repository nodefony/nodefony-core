/**
 * Offsets de mise en page Studio — SOURCE DE VÉRITÉ UNIQUE.
 *
 * Tout dérive des variables CSS du shell (header global + barre debug) — JAMAIS
 * de « magic number » (250px, 110px…) dispersé dans les pages. Modèle docs-site :
 * un seul scroll de page (le contenu), des panneaux latéraux STICKY pleine
 * hauteur avec leur propre overflow.
 *
 * Règle absolue : tout `calc(100vh - …)` DOIT soustraire `--nodefony-debugbar-height`,
 * sinon la debug bar recouvre les widgets pleine hauteur. Aucun nouveau `calc(100vh)`
 * en dehors de ce fichier.
 */
const HEADER = "var(--app-shell-header-height, 56px)";
const DEBUGBAR = "var(--nodefony-debugbar-height, 0px)";
const GAP = "var(--mantine-spacing-md, 16px)";
/** Hauteur approx. d'un PageHeader sticky (titre + sous-titre + actions). */
const PAGE_HEADER = "76px";
/** Hauteur typique d'une bande de toolbar / filtres ou d'un strip Tabs.List sticky. */
const BAND = "48px";
/** Hauteur de la topbar d'un Modal Mantine fullScreen (titre + paddings). */
const MODAL_HEADER = "60px";

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

/**
 * Contenu plein viewport sous un PageHeader sticky (Card mih, panel principal).
 * Alias sémantique de `SIDEBAR_MAX_HEIGHT` — sidebar et contenu partagent la même
 * enveloppe verticale en mode docs-site.
 */
export const PAGE_CONTENT_HEIGHT = SIDEBAR_MAX_HEIGHT;

/**
 * Contenu plein viewport sous PageHeader + UNE bande supplémentaire (toolbar
 * de recherche d'un DataGrid, bande de filtres modules d'un ERD…).
 */
export const PAGE_CONTENT_HEIGHT_WITH_BAND = `calc(100vh - ${HEADER} - ${PAGE_HEADER} - ${BAND} - ${DEBUGBAR} - ${GAP} * 2)`;

/**
 * Contenu sous PageHeader + Tabs.List sticky DANS une Card paddée (Tabs.Panel
 * à scroll interne). Comprend les paddings supplémentaires de la Card.
 */
export const TABS_PANEL_HEIGHT = `calc(100vh - ${HEADER} - ${PAGE_HEADER} - ${BAND} - ${DEBUGBAR} - ${GAP} * 4)`;

/** Body d'un Modal Mantine fullScreen (sous la topbar du Modal). */
export const MODAL_FULLSCREEN_BODY = `calc(100vh - ${MODAL_HEADER})`;

/** Contenu DANS un Modal fullScreen, avec un peu de respiration. */
export const MODAL_FULLSCREEN_CONTENT = `calc(100vh - ${MODAL_HEADER} - ${GAP} * 2)`;
