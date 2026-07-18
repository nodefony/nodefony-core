/**
 * Dérive une URL Redis de test pointant une **base dédiée** au fichier appelant.
 *
 * Pourquoi : les bancs d'intégration purgent leur base (`flushDb`) pour partir
 * d'une ardoise propre. Si deux fichiers partagent la même base et s'exécutent en
 * parallèle (défaut vitest), le `flushDb` de l'un efface le seed de l'autre — les
 * tests passent en isolation et échouent en suite, le pire des symptômes (on
 * soupçonne le code, le coupable est le banc). Une base par fichier supprime la
 * cause au lieu de sérialiser toute la suite.
 *
 * Redis expose 16 bases (0-15) par défaut ; réserver les hautes aux tests laisse
 * les basses au développement local.
 *
 * @param db - index de base (0-15) — UNIQUE par fichier de test.
 * @returns l'URL scopée, ou `null` si `REDIS_TEST_URL` n'est pas défini (pas
 *   d'infra → au fichier de décider s'il skippe ou bascule sur un double).
 */
export function redisTestUrl(db: number): string | null {
  const base = process.env.REDIS_TEST_URL;
  if (!base) return null;
  const url = new URL(base);
  url.pathname = `/${db}`;
  return url.toString();
}
