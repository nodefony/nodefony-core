import type { ReactNode } from "react";

/**
 * Styles « temps réel » PARTAGÉS du PATRON sondes+hub. Injectés UNE seule fois dans
 * `<head>` (flag de garde) ; CSS pur → 0 re-render. Réutilisé par tout panneau
 * d'observabilité Studio (ORM, Supervision, sécurité…). À appeler une fois au montage :
 * `useEffect(ensureLiveStyles, [])`.
 *
 * **Ergonomie « temps réel CALME »** (cf skill `nodefony-studio-dev`) : on NE met PAS de
 * mouvement permanent en périphérie. Donc :
 *  - `.nf-live-dot` : « respiration » d'**opacité** (compositor, 0 paint), pas un pulse de
 *    `box-shadow` (paint répété = clignotement) ; signal « live » discret, petite surface.
 *  - `.nf-live-card` : anneau d'accent **STATIQUE** (plus de halo qui bat en boucle — un
 *    glow infini sur une carte = bruit visuel anti-calme).
 *  - `.nf-flash` : flash **one-shot** bref sur changement SIGNIFIANT (re-clé), petite surface.
 *  - `@media (prefers-reduced-motion: reduce)` : on coupe toute animation (a11y vestibulaire).
 */
let injected = false;
export function ensureLiveStyles(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-nf-live", "");
  el.textContent = `
@keyframes nf-live-breathe{0%,100%{opacity:.5}50%{opacity:1}}
.nf-live-dot{width:8px;height:8px;border-radius:50%;background:var(--mantine-color-teal-6);animation:nf-live-breathe 2.4s ease-in-out infinite;flex:0 0 auto}
.nf-live-card{box-shadow:inset 0 0 0 1px rgba(18,184,134,.22)}
@keyframes nf-flash{0%{background:rgba(18,184,134,.28)}100%{background:transparent}}
.nf-flash{animation:nf-flash .9s ease-out;border-radius:4px}
@media (prefers-reduced-motion: reduce){
.nf-live-dot{animation:none;opacity:.85}
.nf-flash{animation:none;background:transparent}
}
`;
  document.head.appendChild(el);
}

export interface FlashValueProps {
  /** Clé de changement : flashe quand elle change (re-clé → l'anim CSS rejoue). */
  value: string | number;
  children: ReactNode;
}

/**
 * FlashValue — flashe brièvement quand `value` change (live = « ce qui bouge »).
 * Repose sur la classe `.nf-flash` injectée par {@link ensureLiveStyles}. Aucun
 * re-render hors changement de `value` (React remplace le span via la `key`).
 */
export function FlashValue({ value, children }: FlashValueProps) {
  return (
    <span key={String(value)} className="nf-flash">
      {children}
    </span>
  );
}
