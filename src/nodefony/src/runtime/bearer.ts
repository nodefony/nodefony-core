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
 * Ce que porte un en-tête `Authorization` — et surtout ce qu'il NE porte pas.
 *
 * 🔴 Les trois façons de ne pas présenter de jeton ne se valent pas, et les
 * confondre a rendu inatteignable la tolérance anonyme d'une porte protégée :
 * un client dont la variable d'environnement n'est pas substituée envoie
 * `Authorization: Bearer ` — un en-tête PRÉSENT qui n'affirme rien. Traité
 * comme malformé, il recevait `400` là où le même client, muet, recevait les
 * outils publics : la porte punissait plus sévèrement celui qui n'a rien à dire
 * que celui qui se tait. Distinguer coûte un champ ; ne pas distinguer coûte la
 * capacité entière.
 */
export type BearerHeader =
  /** Aucun en-tête, ou vide : le client n'a rien affirmé. */
  | { kind: "absent" }
  /** Schéma `Bearer` reconnu, mais aucun jeton derrière — rien affirmé non plus. */
  | { kind: "empty" }
  /** Un autre schéma, ou `Bearer` collé à sa valeur : le client s'y prend mal. */
  | { kind: "other" }
  /** Un jeton est présenté — reste à le juger. */
  | { kind: "token"; token: string };

/**
 * Lit un en-tête `Authorization` et dit ce qu'il porte.
 *
 * @param header - la valeur brute de l'en-tête (absente, d'un autre schéma, ou
 *          vide — aucun de ces cas ne lève).
 * @returns le verdict de lecture ; jamais une exception.
 */
export function readBearerHeader(header: unknown): BearerHeader {
  if (typeof header !== "string" || header.length === 0)
    return { kind: "absent" };
  if (header.length < SCHEME.length) return { kind: "other" };
  // Comparaison insensible à la casse bornée aux 6 premiers caractères : le
  // schéma est de longueur connue, il n'y a rien à chercher.
  if (header.slice(0, SCHEME.length).toLowerCase() !== SCHEME) {
    return { kind: "other" };
  }

  let i = SCHEME.length;
  // `Bearer` SEUL — schéma nu, sans le moindre séparateur : rien n'est porté.
  if (i === header.length) return { kind: "empty" };
  const first = header.charCodeAt(i);
  // Au moins UN séparateur — sinon `bearertoken` passerait pour un porteur.
  if (first !== 0x20 && first !== 0x09) return { kind: "other" };
  while (i < header.length) {
    const c = header.charCodeAt(i);
    if (c !== 0x20 && c !== 0x09) break;
    i++;
  }

  // `trimEnd` seul : la tête vient d'être consommée par la boucle ci-dessus.
  const token = header.slice(i).trimEnd();
  return token.length > 0 ? { kind: "token", token } : { kind: "empty" };
}

/**
 * Rend le jeton porté par un en-tête `Authorization`, ou `null`.
 *
 * Projection de {@link readBearerHeader} pour les appelants que la NUANCE ne
 * regarde pas — un authentificateur qui cherche un porteur et passe la main s'il
 * n'y en a pas. Une porte qui doit RÉPONDRE (401 ? 400 ? anonyme ?) lit le
 * verdict complet : sans lui, elle ne peut pas distinguer « rien présenté » de
 * « mal présenté », et elle tranche donc toujours du mauvais côté pour l'un des
 * deux.
 *
 * @param header - la valeur brute de l'en-tête (peut être absente ou d'un autre
 *          schéma — les deux rendent `null`, jamais une exception).
 * @returns le jeton débarrassé de ses espaces de tête et de queue, ou `null` si
 *          l'en-tête n'est pas un `Bearer` valide ou ne porte aucun jeton.
 */
export function bearerToken(header: unknown): string | null {
  const lu = readBearerHeader(header);
  return lu.kind === "token" ? lu.token : null;
}
