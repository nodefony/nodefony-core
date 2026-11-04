/**
 * Styles créés à l'exécution sous une CSP stricte (ADR-0024 §C2).
 *
 * `style-src 'self' 'nonce-…'` bloque tout `<style>` sans nonce, y compris
 * dans un Shadow DOM. Deux voies, une seule implémentation :
 *  - `adoptStyles` : feuille CONSTRUITE (`CSSStyleSheet` + `adoptedStyleSheets`),
 *    qui passe par le CSSOM — la politique ne la gouverne pas, aucun nonce requis ;
 *  - repli (navigateur sans feuille construite) : `<style>` signé du nonce que la
 *    page annonce (`<meta property="csp-nonce">`, cf `cspNonceMetaTag`).
 */

import { CSP_NONCE_META_PROPERTY } from "../runtime/cspNonce";

/** Racine qui accepte une feuille adoptée : le document ou un Shadow DOM. */
export type StyleRoot = Document | ShadowRoot;

/**
 * Nonce CSP de la page, ou `undefined` si elle n'en annonce aucun.
 *
 * Lu par la propriété `.nonce` — le navigateur masque l'attribut. Source : la
 * balise `<meta property="csp-nonce">` (convention partagée avec Vite) ; à
 * défaut, n'importe quel `<script>` signé de la page, car un document sert un
 * seul nonce : une barre ou un composant injecté dans une page qui n'a pas posé
 * la balise le retrouve quand même.
 *
 * @param doc - document à lire (défaut : `document`).
 * @returns le nonce, ou `undefined` hors navigateur ou sans nonce.
 */
export function readCspNonce(doc?: Document): string | undefined {
  const d = doc ?? (typeof document === "undefined" ? undefined : document);
  if (d === undefined) return undefined;
  const meta = d.querySelector<HTMLMetaElement>(
    `meta[property="${CSP_NONCE_META_PROPERTY}"]`,
  );
  const nonce =
    meta?.nonce || d.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
  return nonce || undefined;
}

/**
 * Applique une feuille de style à une racine sans la soumettre à `style-src`.
 *
 * Feuille construite quand le navigateur la connaît (rien à signer) ; sinon un
 * `<style>` signé du nonce de la page, posé dans `<head>` (document) ou dans la
 * racine (Shadow DOM). Ne déduplique pas : l'appelant garde sa garde « déjà
 * appliqué ». `replaceSync` refuse `@import` — une feuille qui en a besoin passe
 * par un `<link>`.
 *
 * @param css - texte de la feuille.
 * @param root - racine cible (défaut : `document`).
 * @returns la feuille construite, ou l'élément `<style>` du repli.
 */
export function adoptStyles(
  css: string,
  root?: StyleRoot,
): CSSStyleSheet | HTMLStyleElement {
  const target = root ?? document;
  if (
    typeof CSSStyleSheet === "function" &&
    "replaceSync" in CSSStyleSheet.prototype &&
    "adoptedStyleSheets" in target
  ) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
    return sheet;
  }
  const doc = target instanceof Document ? target : target.ownerDocument;
  const style = doc.createElement("style");
  const nonce = readCspNonce(doc);
  if (nonce) style.nonce = nonce;
  style.textContent = css;
  (target instanceof Document ? target.head : target).appendChild(style);
  return style;
}
