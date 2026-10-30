/**
 * channelPattern — grammaire des MOTIFS de noms, commune aux canaux de la socket
 * (politiques de canal du hub) et aux abonnements webhook (ADR-0023 W1).
 *
 * Un motif est un nom où `*` désigne n'importe quelle suite de caractères, y compris
 * vide : `commande:*`, `*:créée`, `login.*`, `*`. Tout le reste est LITTÉRAL — le motif
 * est échappé en entier avant que `*` ne devienne `.*`, si bien qu'un `.` reste un point
 * et qu'un `(` reste une parenthèse : une déclaration anodine ne devient jamais une
 * expression régulière. La correspondance est ancrée aux deux bouts.
 *
 * Une seule implémentation, au cœur, parce que `@nodefony/realtime` et
 * `@nodefony/security` ne se connaissent pas : deux copies divergeraient en silence.
 * Compiler coûte une expression régulière — à faire à l'enregistrement, jamais par
 * événement.
 */

/**
 * Nombre maximal de `*` dans un motif de canal ou d'abonnement webhook — au-delà, le motif est refusé.
 *
 * Un motif en demande un, deux au pire ; au-delà, la mise en correspondance coûte cher
 * sur des noms que le client choisit.
 */
export const MAX_CHANNEL_PATTERN_WILDCARDS = 3;

/**
 * Compile un motif de la grammaire commune aux canaux et aux webhooks en expression régulière ancrée, ou rend `null` s'il porte trop de `*`.
 *
 * @param source - le motif tel que l'auteur l'écrit (`commande:*`, `login.*`, `*`).
 * @returns l'expression `^…$` où chaque `*` vaut `.*`, ou `null` au-delà de
 *   {@link MAX_CHANNEL_PATTERN_WILDCARDS} étoiles.
 */
export function compileChannelPattern(source: string): RegExp | null {
  if (countWildcards(source) > MAX_CHANNEL_PATTERN_WILDCARDS) return null;
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escaped.split("\\*").join(".*")}$`, "u");
}

/**
 * Compte les `*` d'un motif — pour nommer la cause d'un refus de {@link compileChannelPattern}.
 *
 * @param source - le motif.
 * @returns le nombre d'étoiles.
 */
export function countWildcards(source: string): number {
  return source.split("*").length - 1;
}
