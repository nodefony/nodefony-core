import type { IUser, IUserProvider } from "@nodefony/user";

/**
 * Annuaire de décor : tout identifiant y existe, avec l'`id` immuable
 * `u-<identifiant>`. C'est ce que lit `ApiKeyService.createForSubject` pour
 * lier la clé au compte (#139) — sans annuaire, la création refuse en 503.
 */
export function accountDirectory(): IUserProvider {
  return {
    loadUserByIdentifier: (identifier: string): Promise<IUser> =>
      Promise.resolve({
        id: `u-${identifier}`,
        identifier,
        roles: [],
        hasRole: () => false,
        isActive: () => true,
        isLocked: () => false,
      }),
  } as unknown as IUserProvider;
}
