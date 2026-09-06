/**
 * Le détail d'un `realtime:denied` — dit au développeur, tu à l'utilisateur.
 *
 * `RealtimeDeniedReason` est fermé et générique par construction : `forbidden`
 * ne dit pas si c'est un rôle qui manque ou le plancher de plateforme qui est
 * clos, et c'est ce qui l'empêche d'être un oracle. Le prix de cette prudence
 * est payé par le développeur : il reçoit un refus qu'il ne sait pas lire, et
 * il lui reste à deviner ce qu'il faut regarder.
 *
 * Cette fonction pose donc la phrase utile — **et seulement hors production**,
 * où la même phrase serait exactement l'oracle que `reason` refuse d'être.
 *
 * Isolée pour la même raison que {@link welcomeEnv}, dont elle copie la règle :
 * noyée dans la composition du refus, son inversion ne casserait aucun test et
 * livrerait le détail d'une politique aux visiteurs d'un serveur publié. Une
 * absence vaut production, jamais l'inverse.
 *
 * @param env - le mode du kernel serveur (`kernel.environment`), s'il est connu.
 * @param detail - la phrase à dire, déjà rédigée par l'appelant.
 * @returns le fragment à étaler dans le refus : `{ detail }` hors production,
 *   sinon un objet vide.
 */
export function deniedDetail(
  env: string | undefined | null,
  detail: string,
): { detail?: string } {
  if (!env || env === "production") return {};
  return { detail };
}
