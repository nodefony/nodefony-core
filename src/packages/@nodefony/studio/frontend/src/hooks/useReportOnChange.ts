import { useEffect, useEffectEvent } from "react";

/**
 * Remonte une valeur au parent CHAQUE FOIS qu'elle change — et seulement alors.
 *
 * Le patron qu'il remplace, recopié sept fois, écartait le rappel des
 * dépendances de l'effet (« onData = setState, stable ») : vrai le jour où on
 * l'écrit, faux le jour où le parent passe une fonction fléchée — l'effet
 * appelle alors une version FIGÉE du rappel, sans un mot. `useEffectEvent`
 * lit toujours le rappel du dernier rendu, sans relancer l'effet quand seul
 * le rappel change.
 *
 * @param value - la valeur suivie ; l'effet part quand elle change (`Object.is`).
 * @param report - le rappel du parent, appelé avec la valeur ; absent, rien ne part.
 */
export function useReportOnChange<T>(
  value: T,
  report: ((value: T) => void) | undefined,
): void {
  const emit = useEffectEvent((v: T) => {
    report?.(v);
  });
  useEffect(() => {
    emit(value);
  }, [value]);
}
