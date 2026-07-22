import { nodefonyError } from "nodefony";

/**
 * Cloison des clés Redis **par application**.
 *
 * ── Le problème ────────────────────────────────────────────────────────────
 * Un serveur Redis se mutualise très naturellement : c'est peu coûteux, et la
 * `database` (0 par défaut) donne l'illusion d'une séparation. Elle n'en est pas
 * une — elle ne cloisonne ni le pub/sub, ni quoi que ce soit dès lors que deux
 * applications utilisent le même index, ce qui est le cas par défaut.
 *
 * Or les clés étaient nommées en dur : `nf:sess:<id>`, `nf:tok:<id>`,
 * `nf:wac:<id>`. Deux applications côte à côte écrivaient donc dans le même
 * espace, et l'écran Sessions de l'une **listait les sessions de l'autre** — son
 * balayage `nf:sess:*` ne pouvait pas faire la différence. Ce ne sont pas des
 * messages qui fuyaient, ce sont des identités.
 *
 * ── La cloison ─────────────────────────────────────────────────────────────
 * Même règle que `backplane.namespace` côté temps réel, où la même classe de
 * défaut a déjà été corrigée : une cloison explicite, sinon le nom de
 * l'application. Sans cloison résolue, le préfixe historique est conservé — une
 * application seule sur son Redis n'a rien à séparer, et son espace de clés ne
 * doit pas changer sous ses pieds.
 *
 * ── Ce que la cloison sépare, et ce qu'elle NE sépare PAS ──────────────────
 * Elle sépare des **applications**, jamais les instances d'une même application.
 * La distinction est vitale : c'est elle qui décide si une session survit au
 * load-balancer.
 *
 * ```
 *   10 pods de « boutique »   →  nf:boutique:sess:<id>    ← un seul espace
 *   « intranet » à côté       →  nf:intranet:sess:<id>    ← espace disjoint
 * ```
 *
 * La cloison est dérivée de `kernel.projectName`, c'est-à-dire du nom de
 * l'application **dans son code** : tous ses pods calculent donc la même. Un
 * utilisateur connecté via le pod 3 est reconnu par le pod 7 — le partage des
 * sessions entre instances est justement ce qu'on attend d'un store Redis, et il
 * reste intact.
 *
 * C'est pourquoi la cloison n'est SURTOUT pas dérivée de quelque chose de propre
 * à l'instance (nom d'hôte, PID) : ce serait donner à chaque pod son propre
 * espace de sessions, donc déconnecter l'utilisateur à chaque requête qui change
 * de pod. Le backplane temps réel, lui, dérive bien un `originId` par instance —
 * mais pour un tout autre usage (ne pas se réémettre à soi-même).
 *
 * Corollaire à connaître : deux DÉPLOIEMENTS de la même application
 * (préproduction et production) portent le même nom, donc la même cloison. S'ils
 * partagent un Redis, il faut leur poser un `keyNamespace` explicite — la même
 * règle que `backplane.namespace`.
 *
 * ── Pourquoi l'application en TÊTE ─────────────────────────────────────────
 * `nf:<app>:sess` plutôt que `nf:sess:<app>`. Les deux cloisonnent aussi bien,
 * mais seul le premier laisse un opérateur voir — ou purger — une application
 * entière d'un seul motif (`nf:boutique:*`). Un namespace placé en fin de préfixe
 * éparpille les clés d'une même application sous chaque type de donnée.
 */

/** Caractères admis dans une cloison — alignés sur `backplane.namespace`. */
const NAMESPACE_PATTERN = /^[\w.-]+$/;

/**
 * Compose le préfixe de clés d'un store, cloisonné par application.
 *
 * @param base - préfixe historique du store (`nf:sess`, `nf:tok`, `nf:wac`).
 * @param namespace - cloison de l'application ; vide ou absente → pas de cloison.
 * @returns `nf:<namespace>:<type>` si une cloison est posée, `base` sinon.
 * @throws nodefonyError si la cloison contient autre chose que des caractères de
 *   mot, `.` ou `-`. Le `:` est le séparateur de clé : l'accepter permettrait de
 *   fabriquer un préfixe recouvrant celui d'une autre application, et un `*` de
 *   transformer un balayage en filet dérivant.
 */
export function resolveKeyPrefix(base: string, namespace?: string): string {
  const ns = namespace?.trim();
  if (!ns) return base;
  if (!NAMESPACE_PATTERN.test(ns)) {
    throw new nodefonyError(
      `Cloison de clés Redis invalide : "${ns}". Caractères autorisés : ` +
        `lettres, chiffres, "_", "." et "-" — ni ":" (séparateur de clé) ni "*" ` +
        `(joker de balayage), qui permettraient à une application d'atteindre ` +
        `l'espace de clés d'une autre.`,
    );
  }
  // `nf:sess` → `nf:<ns>:sess` : la cloison s'insère après la marque, avant le
  // type. La base est toujours de la forme `marque:type` (cf stores).
  const separator = base.indexOf(":");
  if (separator === -1) return `${base}:${ns}`;
  const mark = base.slice(0, separator);
  const type = base.slice(separator + 1);
  return `${mark}:${ns}:${type}`;
}
