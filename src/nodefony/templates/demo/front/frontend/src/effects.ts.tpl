import { useEffect, useState } from "react";

/**
 * Les deux comportements animés de l'accueil, tous deux bornés. Le reste
 * (fil de lecture, apparition des blocs, ombre de la barre) est du CSS
 * piloté par le défilement, dans `demo.css`.
 */

/**
 * Lumière qui suit le pointeur sur les cartes : UN écouteur délégué sur le
 * document, au plus un calcul par image. La feuille lit `--mx`/`--my`.
 */
export function usePointerLight(selector: string): void {
  useEffect(() => {
    let frame = 0;
    let target: HTMLElement | null = null;
    let x = 0;
    let y = 0;
    const paint = () => {
      frame = 0;
      if (target === null) return;
      const box = target.getBoundingClientRect();
      target.style.setProperty("--mx", `${x - box.left}px`);
      target.style.setProperty("--my", `${y - box.top}px`);
    };
    const onMove = (event: PointerEvent) => {
      const found =
        event.target instanceof Element ? event.target.closest(selector) : null;
      target = found instanceof HTMLElement ? found : null;
      x = event.clientX;
      y = event.clientY;
      if (target !== null && frame === 0) frame = requestAnimationFrame(paint);
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, [selector]);
}

/**
 * Touche → index de l'onglet visé, relatif à l'onglet courant (patron WAI-ARIA
 * « tabs » : flèches, Début, Fin). Partagé par tous les onglets de la démo.
 *
 * @param key - `event.key` de la touche pressée
 * @param index - index de l'onglet qui a le focus
 * @param count - nombre d'onglets
 * @returns l'index visé, ou `null` si la touche ne déplace pas
 */
export function tabTargetIndex(
  key: string,
  index: number,
  count: number,
): number | null {
  switch (key) {
    case "ArrowRight":
      return (index + 1) % count;
    case "ArrowLeft":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * Section en cours de lecture, pour la marquer dans la navigation : UN
 * observateur, déclenché quand une section traverse le milieu de l'écran.
 *
 * @param ids - identifiants des sections suivies
 * @returns l'identifiant de la section courante, ou `null` au-dessus de la première
 */
export function useCurrentSection(ids: readonly string[]): string | null {
  const [current, setCurrent] = useState<string | null>(null);
  const key = ids.join(" ");
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setCurrent(entry.target.id);
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const id of key.split(" ")) {
      const section = document.getElementById(id);
      if (section !== null) observer.observe(section);
    }
    return () => observer.disconnect();
  }, [key]);
  return current;
}
