/**
 * Extraction du jeton d'un en-tête `Authorization: Bearer …` — sans expression
 * régulière, et volontairement.
 *
 * Le motif d'origine, `/^bearer\s+(.+)$/i`, était dupliqué dans deux
 * authentificateurs et **quadratique** : `\s+` suivi de `(.+)` laisse le moteur
 * essayer chaque point de découpage entre les deux quantificateurs. Un client
 * anonyme envoyant `Bearer ` suivi de milliers d'espaces faisait donc brûler du
 * temps processeur à chaque requête — sur la boucle d'événements, qui est
 * unique. Aggravant : le test de support s'exécute AVANT toute authentification,
 * donc le coût se paie pour un porteur qui n'a rien prouvé, et la taille
 * d'en-tête tolérée par Node (16 Kio) suffit largement à le rendre sensible.
 *
 * Ici, tout est linéaire : une comparaison de préfixe, un saut d'espaces, une
 * découpe. Aucun retour arrière n'est possible parce qu'il n'y a pas d'automate.
 *
 * **Séparateur restreint à l'espace et à la tabulation** : c'est ce que la
 * RFC 9110 §5.6.3 autorise entre le schéma et ses paramètres (`OWS`). `\s`
 * acceptait retours à la ligne et espaces Unicode — plus permissif que la norme,
 * pour aucun bénéfice.
 *
 * ## Pourquoi au CŒUR, et pas dans le module de sécurité
 *
 * Deux couches lisent le même en-tête sans pouvoir se voir : les
 * authentificateurs de `@nodefony/security`, et la porte MCP, dont le protocole
 * vit ici. Une frontière de paquets aurait imposé une copie — or une copie de
 * cette fonction ne diverge pas bruyamment : elle diverge sur un cas limite
 * (`Bearer …`, `Bearer` sans séparateur) que chaque copie continue de
 * passer dans ses propres tests. La règle « 1 règle = 1 implémentation » veut
 * donc qu'elle vive au niveau que les deux peuvent atteindre — le plus bas.
 *
 * Elle est ici, et non dans un dossier `mcp/`, parce qu'elle ne doit rien à ce
 * protocole : c'est de la sémantique HTTP, lue à chaque requête entrante.
 */

/** Le schéma, en minuscules — comparé sans allouer de version normalisée. */
const SCHEME = "bearer";

/**
 * Rend le jeton porté par un en-tête `Authorization`, ou `null`.
 *
 * @param header - la valeur brute de l'en-tête (peut être absente ou d'un autre
 *          schéma — les deux rendent `null`, jamais une exception).
 * @returns le jeton débarrassé de ses espaces de tête et de queue, ou `null` si
 *          l'en-tête n'est pas un `Bearer` valide ou ne porte aucun jeton.
 */
export function bearerToken(header: unknown): string | null {
  if (typeof header !== "string" || header.length <= SCHEME.length) return null;
  // Comparaison insensible à la casse bornée aux 6 premiers caractères : le
  // schéma est de longueur connue, il n'y a rien à chercher.
  if (header.slice(0, SCHEME.length).toLowerCase() !== SCHEME) return null;

  let i = SCHEME.length;
  const first = header.charCodeAt(i);
  // Au moins UN séparateur — sinon `bearertoken` passerait pour un porteur.
  if (first !== 0x20 && first !== 0x09) return null;
  while (i < header.length) {
    const c = header.charCodeAt(i);
    if (c !== 0x20 && c !== 0x09) break;
    i++;
  }

  // `trimEnd` seul : la tête vient d'être consommée par la boucle ci-dessus.
  const token = header.slice(i).trimEnd();
  return token.length > 0 ? token : null;
}
