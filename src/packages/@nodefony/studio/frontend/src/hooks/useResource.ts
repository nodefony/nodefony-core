import { useCallback, useEffect, useRef, useState } from "react";

/** État réactif d'un chargement de données serveur. */
export interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Relance la requête (le résultat de toute requête plus ancienne est ignoré). */
  reload: () => void;
}

/**
 * useResource — pattern UNIQUE de chargement de données serveur dans Studio.
 *
 * Remplace le triptyque répété `useState(data/loading/error)` + `useEffect(fetch)`
 * éparpillé dans les pages (RoutesView, Dashboard…), en corrigeant deux pièges :
 *
 * - **Annulation / race** : une réponse arrivée après démontage OU après un
 *   changement de `fetcher` est ignorée (jeton de génération). Sans ça, une
 *   réponse périmée peut écraser une plus récente (RoutesView n'annulait pas).
 * - **StrictMode** : le double-montage de dev n'écrit qu'une fois (le 1er run est
 *   invalidé au cleanup) — pas de `setState` sur composant démonté.
 *
 * @param fetcher - fonction async renvoyant la donnée. DOIT être stable : si elle
 *   capture des variables, l'envelopper de `useCallback` (cf RoutesView).
 * @returns `{ data, loading, error, reload }`.
 */
export function useResource<T>(fetcher: () => Promise<T>): ResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Jeton de génération : seule la dernière requête lancée a le droit d'écrire.
  const genRef = useRef(0);

  const run = useCallback(() => {
    const gen = ++genRef.current;
    setLoading(true);
    setError(null);
    fetcher()
      .then((d) => {
        if (gen !== genRef.current) return;
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (gen !== genRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, [fetcher]);

  useEffect(() => {
    run();
    // Démontage / nouveau fetcher → invalide la requête en vol.
    return () => {
      genRef.current++;
    };
  }, [run]);

  return { data, loading, error, reload: run };
}
