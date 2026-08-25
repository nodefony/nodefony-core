import { ADMIN_DEFAULT_ROLE } from "./adminRbac";

/**
 * Qui appelle le plan d'administration, tel qu'il se PRÉSENTE.
 *
 * Ce type existe pour une raison précise : les portes sans HTTP (commande
 * `inspect`, serveur MCP) fabriquaient un administrateur au lieu de porter une
 * identité. Le contrôle de rôle s'appliquait donc à un sujet inventé, et tout
 * porteur d'un jeton accepté obtenait la lecture d'administration complète.
 *
 * L'identité se PASSE, elle ne se déduit pas : chaque porte doit dire au nom de
 * qui elle appelle, et le compilateur l'y oblige.
 */
export interface IAdminCaller {
  /** L'utilisateur, quand la porte en connaît un. */
  user: unknown | null;
  /** Ses rôles RÉELS — c'est sur eux que le contrôle d'accès tranche. */
  roles: readonly string[];
  /**
   * Qui c'est, en clair. Sert au refus et au journal : « rôle X requis » sans
   * dire À QUI il manquait oblige à deviner quelle porte a été empruntée.
   */
  label: string;
}

/**
 * L'opérateur qui lance une commande sur sa propre application.
 *
 * Il possède déjà le processus : il lit les sources, il édite la configuration,
 * il peut arrêter le serveur. Lui refuser la lecture d'administration
 * n'ajouterait aucune barrière — il lui suffirait d'ouvrir un fichier — mais
 * rendrait la commande inutile. Le rôle est donc accordé ; ce qui compte, c'est
 * que ce soit ÉNONCÉ ici plutôt que fabriqué en silence au fond d'une lecture.
 *
 * @returns l'appelant à présenter depuis une commande locale.
 */
export function localOperatorCaller(): IAdminCaller {
  return {
    user: null,
    roles: [ADMIN_DEFAULT_ROLE],
    label: "opérateur local (CLI)",
  };
}

/**
 * Scope d'un jeton ouvrant la LECTURE du plan d'administration.
 *
 * Trois valeurs suffisent pour tout le plan (celle-ci, {@link ADMIN_SCOPE_WRITE},
 * et l'absence de scope pour la topologie) : un scope par endpoint se périmerait
 * à chaque ajout, et la granularité fine existe déjà pour les API d'une
 * application, portée par `@RequireScope` sur ses routes.
 */
export const ADMIN_SCOPE_READ = "admin:read";

/** Scope d'un jeton ouvrant les MUTATIONS du plan d'administration. */
export const ADMIN_SCOPE_WRITE = "admin:write";

/**
 * Traduit les scopes d'un jeton en rôles Nodefony.
 *
 * ⚠️ Les deux scopes mènent aujourd'hui au MÊME rôle, et ce n'est pas un
 * raccourci : le contrôle d'accès du plan d'administration est uniforme — tous
 * les endpoints exigent `ROLE_NODEFONY_ADMIN`, lectures comme mutations.
 * Distinguer ici produirait un théâtre d'autorisation : deux scopes séparés qui
 * ouvrent exactement la même chose, et une promesse que le code ne tient pas.
 * La séparation deviendra réelle quand `IAdminEndpoint.role` se différenciera.
 *
 * Un jeton qui ne porte aucun de ces scopes n'obtient **aucun rôle** : la
 * vérification d'audience (RFC 8707) prouve que le jeton vise cette ressource,
 * elle ne dit rien de ce que son porteur a le droit d'y faire.
 *
 * ## Rôle et scope — la doctrine, et l'asymétrie qui reste
 *
 * Autorisation effective = **droits de l'utilisateur ∧ portée déléguée au
 * porteur**. Un scope borne ce qu'un TIERS peut faire au nom de quelqu'un ; en
 * session directe (cookie, Studio) il n'y a pas de tiers, donc rien à borner et
 * le rôle suffit. Dès qu'un JETON entre en jeu, il y a délégation, et les deux
 * doivent mordre — c'est ce que fait cette fonction, avec
 * {@link refusedAdminScopes} qui borne l'autre bout : porter le rôle ne suffit
 * pas à obtenir le scope, porter le scope ne suffit pas à avoir le rôle.
 *
 * ⚠️ **Dette nommée, non fermée** : un jeton présenté sur la porte HTTP
 * (`ExternalJwtAuthenticator`, `subjectPolicy: "require"`) est rattaché à un
 * compte local et hérite des rôles de ce compte **sans** intersection avec ses
 * scopes — les routes du plan d'administration sont montées par le broker, donc
 * ne portent aucun `@RequireScope`. Le même porteur obtient donc plus par HTTP
 * que par MCP. Fermer cela suppose que la provenance de l'identité (session ou
 * jeton) voyage jusqu'au contrôle de rôle, ce qu'elle ne fait pas aujourd'hui.
 *
 * ⚠️ Et ce n'est pas du moindre privilège : le plan d'administration n'a qu'UN
 * rôle, qui ouvre tous ses endpoints. « Fail-closed » — pas de laissez-passer
 * par défaut — n'est pas « Zero Trust ». La granularité réelle suppose que
 * `IAdminEndpoint.role` se différencie ; tant qu'il ne l'est pas, découper les
 * scopes plus finement ne serait qu'un décor.
 *
 * @param scopes - scopes accordés par le serveur d'autorisation.
 * @returns les rôles à présenter, éventuellement aucun.
 */
export function rolesFromScopes(scopes: readonly string[]): string[] {
  return scopes.includes(ADMIN_SCOPE_READ) || scopes.includes(ADMIN_SCOPE_WRITE)
    ? [ADMIN_DEFAULT_ROLE]
    : [];
}

/**
 * Les scopes d'administration demandés que ce porteur **ne peut pas** obtenir.
 *
 * Réciproque de {@link rolesFromScopes}, et indispensable avec elle : si un
 * scope ouvre le plan d'administration, alors l'émetteur ne peut pas le signer
 * sur simple demande. Sans cette borne, « tout jeton vaut administrateur »
 * devient « tout jeton QUI DEMANDE vaut administrateur » — le trou change de
 * forme, pas de taille.
 *
 * Ne juge QUE les scopes d'administration du framework. Les scopes d'une
 * application (`shop:read`, `billing:export`) ne regardent pas Nodefony : c'est
 * à elle de dire qui peut les obtenir.
 *
 * @param requested - scopes demandés au grant (RFC 6749 §3.3).
 * @param roles - rôles du porteur, tels que son compte les porte.
 * @returns les scopes à REFUSER — vide si la demande est légitime.
 */
export function refusedAdminScopes(
  requested: readonly string[],
  roles: readonly string[],
): string[] {
  if (roles.includes(ADMIN_DEFAULT_ROLE)) return [];
  return requested.filter(
    (scope) => scope === ADMIN_SCOPE_READ || scope === ADMIN_SCOPE_WRITE,
  );
}
