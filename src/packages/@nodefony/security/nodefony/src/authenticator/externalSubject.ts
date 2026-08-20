/**
 * Comment le sujet d'un émetteur donné entre dans l'espace de noms local.
 *
 * - `prefixed` — l'identifiant local est composé de l'émetteur ET du sujet.
 * - `subject` — le sujet est pris tel quel (l'espace de noms est maîtrisé).
 */
export type ExternalSubjectMapping = "prefixed" | "subject";

/**
 * Séparateur entre l'émetteur et le sujet.
 *
 * `#` est choisi parce qu'un identifiant d'émetteur ne peut PAS en contenir :
 * la RFC 8414 §2 interdit le fragment dans un `issuer`. La composition est donc
 * **injective** — deux paires `(iss, sub)` distinctes ne peuvent jamais produire
 * le même identifiant local, et c'est précisément la propriété qui empêche un
 * émetteur d'usurper le sujet d'un autre.
 */
const SEPARATOR = "#";

/**
 * Compose l'identifiant local qui désigne le sujet d'un émetteur externe.
 *
 * 🔴 **Un `sub` seul ne désigne personne.** OpenID Connect Core §2 ne garantit
 * son unicité et sa non-réattribution que *dans l'espace de son émetteur*.
 * Chercher un compte local directement par `sub` verse donc des identifiants
 * étrangers dans l'espace local : il suffit d'un annuaire où l'utilisateur
 * choisit son identifiant — beaucoup le permettent — pour présenter
 * `sub: "admin"` et se voir rattacher au compte local du même nom.
 *
 * C'est pour cela que `prefixed` est le défaut et que `subject` se déclare :
 * le mode sûr ne doit rien demander, le mode qui fait confiance doit être écrit.
 *
 * @param issuer - émetteur VÉRIFIÉ, sous sa forme canonique (jamais la valeur
 *   brute lue dans le jeton — elle est choisie par le porteur)
 * @param subject - sujet du jeton (`sub`)
 * @param mapping - politique déclarée pour CET émetteur
 * @returns l'identifiant à chercher dans l'annuaire local
 */
export function localIdentifierFor(
  issuer: string,
  subject: string,
  mapping: ExternalSubjectMapping,
): string {
  if (mapping === "subject") return subject;
  return `${issuer}${SEPARATOR}${subject}`;
}
