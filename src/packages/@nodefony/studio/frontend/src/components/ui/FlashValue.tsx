import type { ReactNode } from "react";

/**
 * Styles « temps réel » PARTAGÉS du PATRON sondes+hub (flash sur ce qui bouge +
 * point pulsant « live »). Injectés UNE seule fois dans `<head>` (flag de garde) ;
 * l'animation est en CSS pur → 0 re-render. Réutilisé par tout panneau
 * d'observabilité Studio (ORM, Supervision, sécurité…) pour rendre visible « ce
 * qui bouge » sans coût JS. À appeler une fois au montage de la page :
 * `useEffect(ensureLiveStyles, [])`.
 */
let injected = false;
export function ensureLiveStyles(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-nf-live", "");
  el.textContent = `
@keyframes nf-live-pulse{0%{box-shadow:0 0 0 0 rgba(18,184,134,.5)}70%{box-shadow:0 0 0 5px rgba(18,184,134,0)}100%{box-shadow:0 0 0 0 rgba(18,184,134,0)}}
.nf-live-dot{width:8px;height:8px;border-radius:50%;background:var(--mantine-color-teal-6);animation:nf-live-pulse 1.6s ease-out infinite;flex:0 0 auto}
@keyframes nf-live-glow{0%,100%{box-shadow:0 0 0 0 rgba(18,184,134,0)}50%{box-shadow:0 0 0 3px rgba(18,184,134,.16)}}
.nf-live-card{animation:nf-live-glow 2.4s ease-in-out infinite}
@keyframes nf-flash{0%{background:rgba(18,184,134,.32)}100%{background:transparent}}
.nf-flash{animation:nf-flash .9s ease-out;border-radius:4px}
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
