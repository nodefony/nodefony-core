/**
 * HOOKS React de gating par rôle — la face RÉACTIVE de la politique.
 *
 * Les NOMS de rôles et les tests purs vivent dans [`./roleNames`](./roleNames.ts),
 * qui ne dépend de rien d'autre que `nodefony/roles` ; ce fichier les réexporte
 * intégralement, si bien que `import { ROLE_DEV, useIsAdmin } from ".../roles"`
 * continue de marcher. La coupure n'est pas cosmétique : ce module importe les
 * **stores**, donc tout module chargé au top-level par un store ne doit PAS
 * passer par ici — sans quoi le graphe se referme en cycle
 * (`dashboards → roles → stores → AuthStore → dashboards`), invisible au
 * premier chargement et fatal au rechargement à chaud.
 *
 * Les hooks lisent `auth.roles` (observable MobX) : le composant appelant doit
 * être `observer` pour réagir au changement d'identité (c'est déjà le cas de
 * toutes les pages Studio).
 *
 * ⚠️ Le gating front = **AFFICHAGE seulement**. L'autorité reste le RBAC serveur.
 * Cf `RoleGuard` (page) et `RoleGate` (fragment).
 */
import { hasAnyRole, hasRole } from "nodefony/roles";
import { useAuth } from "../stores";
import { ROLE_NODEFONY_ADMIN } from "./roleNames";

// Surface publique inchangée — une seule DÉFINITION, dans `roleNames.ts`.
export * from "./roleNames";

/**
 * L'utilisateur courant est-il administrateur Studio ? Réactif (MobX) — le
 * composant appelant doit être `observer`. Raccourci de `useHasRole`, le test
 * de loin le plus fréquent (mode admin/self des consoles).
 */
export function useIsAdmin(): boolean {
  const auth = useAuth();
  return hasRole(auth.roles, ROLE_NODEFONY_ADMIN);
}

/** L'utilisateur courant possède-t-il `role` ? Réactif (MobX). */
export function useHasRole(role: string): boolean {
  const auth = useAuth();
  return hasRole(auth.roles, role);
}

/** L'utilisateur courant possède-t-il AU MOINS UN de `roles` ? Réactif (MobX). */
export function useHasAnyRole(roles: string[]): boolean {
  const auth = useAuth();
  return hasAnyRole(auth.roles, roles);
}
