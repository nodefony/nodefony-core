/**
 * Le texte d'une source, tel que les contrôles de `doctor` doivent le lire.
 *
 * 🔴 Cette règle était écrite TROIS fois — `surface`, `readiness`, `wiring` —
 * et elle avait déjà divergé : deux copies coupaient à `//` sans condition,
 * la troisième protégeait le `//` d'une URL. Une `https://…` citée dans un
 * manifeste était donc amputée en `https:` chez deux contrôles sur trois, et
 * rien ne le disait. C'est la règle « 1 RÈGLE = 1 implémentation » du dépôt :
 * deux copies ne se contredisent jamais bruyamment, elles se contredisent en
 * silence, et chacune passe ses propres tests.
 *
 * @module
 */

/**
 * Le CODE d'une source : son texte privé de ses commentaires.
 *
 * Un contrôle qui lit le texte brut accuse la documentation qu'il croise. Le
 * cas est vécu, et il n'est pas théorique : le contrôleur écrit par le
 * générateur EXPLIQUE `@IsGranted` dans deux commentaires sans jamais
 * l'employer — le contrôle des briques manquantes y voyait une garde
 * d'autorisation, et `npm run verify` sortait en 1 sur une application qui
 * venait de naître. Un contrôle qui accuse sa propre documentation est un
 * contrôle qu'on désactive.
 *
 * Le `//` précédé d'un `:` est PRÉSERVÉ : c'est le séparateur d'une URL, pas
 * l'ouverture d'un commentaire. Sans cette réserve, `"https://exemple.test"`
 * devient `"https:` et tout motif qui lit cette valeur échoue sans expliquer
 * pourquoi.
 *
 * La lecture reste TEXTUELLE, et c'est assumé : ces contrôles diagnostiquent
 * une application qui ne démarre pas, donc rien ne s'évalue. On y perd les
 * cas tordus — un `//` dans une chaîne, un `/*` dans une expression
 * régulière — et l'on y gagne de répondre quand rien d'autre ne répond.
 *
 * @param source - le texte du fichier, tel qu'il a été lu sur le disque.
 * @returns le même texte, commentaires retirés.
 */
export function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:])\/\/.*$/gmu, "$1");
}
