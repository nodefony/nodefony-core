/**
 * Rôles GÉRÉS par un fournisseur d'identité — ceux que sa table de
 * correspondance accorde, par opposition aux rôles donnés à la main.
 *
 * La colonne `roles` reste l'ensemble EFFECTIF : aucun lecteur des rôles
 * (pare-feu, voters, console) n'a à connaître la distinction. Ce qui la
 * permet, c'est la trace, dans `metadata`, de ce que chaque fournisseur a
 * accordé la dernière fois : au calcul suivant, on retire exactement cela, et
 * l'on ajoute ce qu'il accorde maintenant.
 */

/** Clé de `metadata` : `{ [fournisseur]: rôles accordés au dernier calcul }`. */
export const PROVIDER_ROLES_KEY = "providerRoles";

/**
 * Rôles que `provider` a accordés au dernier calcul, lus dans `metadata`.
 *
 * @param metadata - métadonnées du compte (forme libre, lue défensivement).
 * @param provider - nom du fournisseur.
 * @returns les rôles gérés par ce fournisseur — vide s'il n'en gère aucun.
 */
export function readProviderRoles(
  metadata: unknown,
  provider: string,
): string[] {
  if (typeof metadata !== "object" || metadata === null) return [];
  const all = (metadata as Record<string, unknown>)[PROVIDER_ROLES_KEY];
  if (typeof all !== "object" || all === null || Array.isArray(all)) return [];
  if (!Object.hasOwn(all, provider)) return [];
  const roles = (all as Record<string, unknown>)[provider];
  return Array.isArray(roles)
    ? roles.filter((r): r is string => typeof r === "string")
    : [];
}

/**
 * Rôles gérés par CHAQUE fournisseur, lus dans `metadata` — pour l'affichage.
 *
 * Seule la clé `providerRoles` est lue, et seuls ses tableaux de chaînes
 * passent : des NOMS de rôles, rien d'autre de `metadata`.
 *
 * @param metadata - métadonnées du compte (forme libre).
 * @returns `{ fournisseur: rôles }`, vide si aucun fournisseur ne gère de rôle.
 */
export function projectProviderRoles(
  metadata: unknown,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (typeof metadata !== "object" || metadata === null) return out;
  const all = (metadata as Record<string, unknown>)[PROVIDER_ROLES_KEY];
  if (typeof all !== "object" || all === null || Array.isArray(all)) return out;
  for (const provider of Object.keys(all)) {
    out[provider] = readProviderRoles(metadata, provider);
  }
  return out;
}

/**
 * Métadonnées réécrites avec les rôles que `provider` gère désormais — les
 * autres clés (profil, autres fournisseurs) sont conservées.
 *
 * @param metadata - métadonnées actuelles.
 * @param provider - nom du fournisseur.
 * @param roles - rôles qu'il gère maintenant.
 * @returns un NOUVEL objet (l'entrée n'est pas modifiée).
 */
export function writeProviderRoles(
  metadata: unknown,
  provider: string,
  roles: readonly string[],
): Record<string, unknown> {
  const base =
    typeof metadata === "object" &&
    metadata !== null &&
    !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const previous = base[PROVIDER_ROLES_KEY];
  const all =
    typeof previous === "object" &&
    previous !== null &&
    !Array.isArray(previous)
      ? (previous as Record<string, unknown>)
      : {};
  return {
    ...base,
    [PROVIDER_ROLES_KEY]: { ...all, [provider]: [...roles] },
  };
}

/** Résultat d'un recalcul. */
export interface IProviderRolesReconciliation {
  /** Ensemble effectif à écrire dans `roles`. */
  readonly roles: string[];
  /** `true` si `roles` OU la trace des rôles gérés doit être réécrite. */
  readonly changed: boolean;
}

/**
 * Recalcule l'ensemble effectif : rôles actuels − ceux que le fournisseur
 * gérait, ∪ ceux qu'il accorde maintenant.
 *
 * Un rôle donné à la main survit donc à chaque calcul. Seule ambiguïté
 * assumée : un rôle à la fois donné à la main ET accordé par le fournisseur
 * devient géré — le retirer dans l'annuaire le retire aussi ici.
 *
 * @param current - rôles effectifs du compte.
 * @param previous - rôles que le fournisseur gérait au dernier calcul.
 * @param next - rôles qu'il accorde maintenant (déjà traduits).
 * @returns l'ensemble effectif, ordre local conservé, et s'il faut écrire.
 */
export function reconcileProviderRoles(
  current: readonly string[],
  previous: readonly string[],
  next: readonly string[],
): IProviderRolesReconciliation {
  const dropped = new Set(previous);
  const roles = current.filter((r) => !dropped.has(r));
  const kept = new Set(roles);
  for (const role of next) {
    if (!kept.has(role)) {
      roles.push(role);
      kept.add(role);
    }
  }
  return {
    roles,
    changed: !sameSet(roles, current) || !sameSet(previous, next),
  };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}
