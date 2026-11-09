import {
  BootConfigurationError,
  USER_CHANNEL_PREFIX,
  isOwnUserChannel,
  type IChannelAdmission,
  type IChannelPolicies,
} from "nodefony";
import type { IChannelPolicy } from "../../interfaces/IChannelPolicy";
import {
  isAdmissionClass,
  samePolicy,
} from "../../decorators/realtimeDecorators";
import type { IChannelAdmissionRule } from "./connectionAdmission";

/**
 * Politiques qui s'appliquent à un nom, résolues : la LECTURE, l'ÉCRITURE quand elle en diffère, et — quand la lecture porte `allow` — la règle d'admission prête à appeler.
 *
 * Satisfait {@link IChannelPolicies} : le hub la rend telle quelle au juge, sans
 * allocation.
 */
export interface IChannelPolicyEntry extends IChannelPolicies {
  readonly admission: IChannelAdmissionRule | null;
}

/**
 * Ce qu'UNE déclaration (nom exact ou motif) pose sur un nom, par sorte — et sa vue seule, calculée une fois.
 *
 * `read` et `write` sont `null` quand cette déclaration ne pose pas la sorte :
 * la résolution la cherche alors dans une déclaration plus générale
 * (ADR-0022 §6, décision 1 quater). `fallback` est le défaut fermé d'une action
 * sans politique : son écriture tant que rien d'exact ne déclare le nom et
 * qu'aucun motif ne pose d'écriture.
 */
export interface IPolicyDeclaration {
  readonly read: IChannelPolicy | null;
  readonly write: IChannelPolicy | null;
  readonly fallback: IChannelPolicy | null;
  /** Instance de la classe d'admission désignée par l'une des politiques, gardée pour une fusion ultérieure. */
  readonly instance: IChannelAdmission | undefined;
  /** Vue de cette déclaration seule, ou `null` si elle ne pose rien. */
  readonly self: IChannelPolicyEntry | null;
}

/** Déclaration portée par un MOTIF de nom (`chat:room:*`), compilée et pesée. */
export interface IPatternDeclaration extends IPolicyDeclaration {
  readonly source: string;
  readonly re: RegExp;
  /** Longueur du littéral (`*` retirés) : le plus spécifique d'abord. */
  readonly weight: number;
}

/**
 * Règle d'admission prête à appeler d'une politique, ou `null` sans `allow`.
 *
 * Une flèche se retient telle quelle. Une classe exige son instance — résolue au
 * démarrage, jamais ici : le hub n'a pas d'injecteur, et résoudre à la première
 * poignée de main laisserait sans politique un exemplaire qui n'émet que des
 * webhooks. La méthode est liée une fois, et la règle se construit une fois :
 * le `subscribe` n'alloue rien et n'appelle qu'une fonction.
 *
 * @throws BootConfigurationError La politique désigne une classe d'admission et
 *   aucune instance de CETTE classe n'est fournie.
 */
export function admissionRuleOf(
  name: string,
  policy: IChannelPolicy,
  admission: IChannelAdmission | undefined,
): IChannelAdmissionRule | null {
  const allow = policy.allow;
  if (allow === undefined) return null;
  const anonymous = policy.anonymous === true;
  if (!isAdmissionClass(allow)) return { allow, anonymous };
  if (!(admission instanceof allow)) {
    throw new BootConfigurationError(
      `canal temps réel « ${name} » : la classe d'admission ${allow.name} ` +
        `n'a pas été résolue au démarrage du noyau. Son contrôleur doit être ` +
        `déclaré par @controllers dans un module : c'est là que le framework ` +
        `l'inscrit et résout ses dépendances.`,
    );
  }
  return { allow: admission.allow.bind(admission), anonymous };
}

/**
 * Construit une déclaration et sa vue seule : lecture déclarée, sinon l'écriture, sinon le défaut d'action ; écriture gardée seulement si elle exige autre chose que la lecture.
 *
 * @param name - nom exact ou motif (pour les messages).
 * @param read - lecture déclarée, ou `null`.
 * @param write - écriture déclarée, ou `null`.
 * @param fallback - défaut fermé d'une action, ou `null`.
 * @param admission - instance de la classe d'admission quand la politique qui
 *   sert de lecture en désigne une.
 */
export function declarationOf(
  name: string,
  read: IChannelPolicy | null,
  write: IChannelPolicy | null,
  fallback: IChannelPolicy | null,
  admission: IChannelAdmission | undefined,
): IPolicyDeclaration {
  const policy = read ?? write ?? fallback;
  const self: IChannelPolicyEntry | null =
    policy === null
      ? null
      : {
          policy,
          write:
            read !== null && write !== null && !samePolicy(read, write)
              ? write
              : null,
          admission: admissionRuleOf(name, policy, admission),
        };
  return { read, write, fallback, instance: admission, self };
}

/**
 * Politique INTÉGRÉE du canal personnel `user:<id>` (ADR-0022 §6, D1) — connexion authentifiée, admise sur SON canal seulement.
 *
 * Constante de module : elle ne s'inscrit nulle part, donc aucun `clear()`,
 * aucun ordre de démarrage, aucun oubli ne peut la retirer. Elle sert de REPLI
 * de LECTURE aux noms `user:…` : seule une déclaration qui vise `user:`
 * (nom exact, ou motif dont le littéral commence par `user:`) la remplace — un
 * motif attrape-tout (`*`) ne retire pas la garde « son canal seulement ».
 */
export const USER_CHANNEL_DECLARATION: IPolicyDeclaration = Object.freeze({
  read: Object.freeze({ authenticated: true, allow: isOwnUserChannel }),
  write: null,
  fallback: null,
  instance: undefined,
  self: Object.freeze({
    policy: Object.freeze({ authenticated: true, allow: isOwnUserChannel }),
    write: null,
    admission: Object.freeze({ allow: isOwnUserChannel, anonymous: false }),
  }),
});

/**
 * Résout les politiques d'un nom (ADR-0022 §6, décision 1 quater) : la LECTURE appartient à la déclaration la plus spécifique qui déclare quelque chose sur ce nom ; l'ÉCRITURE vient de la plus spécifique qui déclare une écriture.
 *
 * L'ordre de spécificité : le nom exact, puis les motifs du plus spécifique au
 * plus général. Pourquoi deux règles et non une :
 * - la LECTURE reste à la déclaration propriétaire du nom (déclarée, sinon
 *   héritée de sa propre écriture) : une commande `task:start` déclarée par
 *   `@RealtimeInbound` sous une famille `task:*` à `allow` ne devient pas un
 *   canal à membres, et une écriture exacte ne voit pas sa lecture s'ouvrir par
 *   un motif plus général ;
 * - l'ÉCRITURE descend jusqu'au motif qui en déclare une : elle s'ajoute à la
 *   lecture (une trame entrante exige les deux), elle ne peut que durcir — une
 *   écriture de famille (`mix:*` réservée) n'est plus perdue sur un nom exact
 *   qui ne déclare que sa lecture.
 *
 * Ensuite : un nom `user:…` sans déclaration qui le vise garde la politique
 * intégrée du canal personnel (un motif qui ne vise pas `user:` est ignoré) ;
 * une action sans politique (nom exact qui ne déclare rien) prend la lecture du
 * motif qui la couvre et le défaut fermé pour écriture — un motif de lecture
 * public ne l'ouvre donc pas.
 *
 * Rend la vue d'une déclaration quand une seule suffit (aucune allocation) ;
 * n'alloue que si l'écriture vient d'une autre déclaration que la lecture.
 *
 * @param name - nom résolu.
 * @param exact - déclaration exacte de ce nom, ou `undefined`.
 * @param patterns - motifs, triés du plus spécifique au plus général, ou `null`.
 * @returns les politiques, ou `null` si aucune ne couvre le nom.
 */
export function resolveDeclaredPolicies(
  name: string,
  exact: IPolicyDeclaration | undefined,
  patterns: readonly IPatternDeclaration[] | null,
): IChannelPolicyEntry | null {
  const declares = (d: IPolicyDeclaration): boolean =>
    d.read !== null || d.write !== null;
  let owner: IPolicyDeclaration | null =
    exact !== undefined && declares(exact) ? exact : null;
  let writeFrom: IPolicyDeclaration | null =
    exact !== undefined && exact.write !== null ? exact : null;
  const isUser = name.startsWith(USER_CHANNEL_PREFIX);
  // Les motifs ne coûtent QUE s'il en existe, et seulement tant que le
  // propriétaire ou l'écriture restent à trouver.
  if ((owner === null || writeFrom === null) && patterns !== null) {
    for (const pattern of patterns) {
      if (isUser && !pattern.source.startsWith(USER_CHANNEL_PREFIX)) continue;
      if (!pattern.re.test(name)) continue;
      if (owner === null && declares(pattern)) owner = pattern;
      if (writeFrom === null && pattern.write !== null) writeFrom = pattern;
      if (owner !== null && writeFrom !== null) break;
    }
  }
  // Le défaut fermé d'une action est son ÉCRITURE quand le nom exact ne
  // déclare rien et qu'aucun motif ne pose d'écriture.
  let write = writeFrom?.write ?? null;
  if (write === null && exact !== undefined && !declares(exact)) {
    write = exact.fallback;
  }
  let own = owner?.self ?? null;
  if (own === null) {
    if (isUser) own = USER_CHANNEL_DECLARATION.self;
    else return exact?.self ?? null; // défaut d'action seul, sinon rien
    if (own === null) return null; // impossible : la vue intégrée existe
  }
  const distinct =
    write === null || samePolicy(own.policy, write) ? null : write;
  if (distinct === own.write) return own;
  return { policy: own.policy, write: distinct, admission: own.admission };
}

/** Échantillon d'un motif : son littéral, chaque `*` vidé — un nom qu'il couvre toujours. */
function sampleOf(pattern: IPatternDeclaration): string {
  return pattern.source.split("*").join("");
}

/**
 * Deux déclarations peuvent-elles s'appliquer au MÊME nom ? Exact : le même nom, ou couvert par le motif ; deux motifs : l'un couvre l'échantillon de l'autre.
 *
 * Prudente : elle répond « oui » dès qu'un nom commun est plausible — elle sert à
 * refuser un démarrage ambigu, jamais à ouvrir un accès.
 */
function couldOverlap(
  a: { readonly name: string; readonly pattern: IPatternDeclaration | null },
  b: { readonly name: string; readonly pattern: IPatternDeclaration | null },
): boolean {
  if (a.pattern === null && b.pattern === null) return a.name === b.name;
  if (a.pattern === null) return b.pattern?.re.test(a.name) === true;
  if (b.pattern === null) return a.pattern.re.test(b.name);
  return (
    a.pattern.re.test(sampleOf(b.pattern)) ||
    b.pattern.re.test(sampleOf(a.pattern))
  );
}

/**
 * Défaut de l'ensemble des déclarations qui refuse le démarrage, ou `null` : une ÉCRITURE à `allow` qui s'appliquerait sous une lecture différente (son `allow` ne serait évalué nulle part), ou — face à un verrou qui ne juge pas l'écriture — une écriture qui diffère d'une lecture qu'elle peut rencontrer.
 *
 * Cold path (inscription d'une politique, pose du verrou) : toutes les paires.
 *
 * @param exact - déclarations exactes, par nom.
 * @param patterns - déclarations par motif.
 * @param writeJudged - le verrou en place sait juger l'écriture (ou aucun verrou).
 * @returns le message du refus, ou `null`.
 */
export function policyDeclarationsDefect(
  exact: ReadonlyMap<string, IPolicyDeclaration> | null,
  patterns: readonly IPatternDeclaration[] | null,
  writeJudged: boolean,
): string | null {
  const all: Array<{
    readonly name: string;
    readonly pattern: IPatternDeclaration | null;
    readonly decl: IPolicyDeclaration;
  }> = [];
  if (exact !== null) {
    for (const [name, decl] of exact) all.push({ name, pattern: null, decl });
  }
  for (const pattern of patterns ?? []) {
    all.push({ name: pattern.source, pattern, decl: pattern });
  }
  for (const writer of all) {
    const write = writer.decl.write;
    if (write === null) continue;
    for (const reader of all) {
      const read = reader.decl.read;
      if (read === null || samePolicy(read, write)) continue;
      if (reader !== writer && !couldOverlap(writer, reader)) continue;
      if (write.allow !== undefined) {
        return (
          `canal temps réel « ${writer.name} » : « allow » est posé sur ` +
          `l'écriture du canal « ${writer.name} », qui rencontre une lecture ` +
          `différente (« ${reader.name} ») — il ne s'applique qu'à la lecture ` +
          `(demandé au subscribe). Le poser sur @RealtimeChannel ; l'écriture se ` +
          `garde par authenticated, roles ou scopes.`
        );
      }
      if (!writeJudged) {
        return (
          `canal temps réel « ${writer.name} » : il déclare une politique ` +
          `d'ÉCRITURE distincte de sa lecture, et le verrou des trames posé sur ` +
          `le hub ne sait pas la juger (il ne déclare pas « judgesWrite ») — ` +
          `l'écriture resterait ouverte. Aligner @nodefony/security sur la ` +
          `version de @nodefony/realtime.`
        );
      }
    }
  }
  return null;
}
