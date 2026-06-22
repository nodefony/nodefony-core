/**
 * Source UNIQUE des rôles applicatifs Studio + hooks React de gating.
 *
 * Séparation **mécanisme / politique** :
 *  - le MÉCANISME (tests purs, isomorphes, 0 alloc) vit dans le core
 *    `nodefony/roles` (`hasRole`/`hasAnyRole`/`hasAllRoles`) — il ne connaît
 *    aucun nom de rôle ;
 *  - la POLITIQUE (les NOMS `ROLE_*`) est applicative → elle vit ICI. Toute
 *    page / guard / nav importe d'ICI, **jamais** une copie locale (la cause de
 *    la dérive : `ADMIN_ROLE` recopié dans trois modèles).
 *
 * Les hooks (`useIsAdmin`, …) lisent `auth.roles` (observable MobX) : le
 * composant appelant doit être `observer` pour réagir au changement d'identité
 * (c'est déjà le cas de toutes les pages Studio).
 *
 * ⚠️ Le gating front = **AFFICHAGE seulement** (cacher un menu/bouton n'empêche
 * pas d'appeler l'API). L'enforcement réel = RBAC serveur (403 sur le data
 * plane, déjà en place). Ne jamais cacher une donnée sensible derrière un gate
 * front : la défense est côté serveur. Cf `RoleGuard` (page) et `RoleGate` (fragment).
 */
import { hasAnyRole, hasRole } from "nodefony/roles";
import { useAuth } from "../stores";

/** Utilisateur authentifié de base (toute session valide). Self-service. */
export const ROLE_USER = "ROLE_USER";
/** Accès au dashboard de supervision (santé / charge runtime). */
export const ROLE_SUPERVISOR = "ROLE_SUPERVISOR";
/** Voir les infos dev (branche git, debug) — divulgation interne. */
export const ROLE_DEV = "ROLE_DEV";
/** Administration complète de Studio (consoles sécurité, gouvernance). */
export const ROLE_NODEFONY_ADMIN = "ROLE_NODEFONY_ADMIN";

/**
 * Rôles applicatifs connus de Studio — base de **suggestions** pour les
 * sélecteurs de rôles (création / édition d'utilisateur). PAS une contrainte :
 * un rôle est une simple chaîne, l'admin peut en assigner d'autres (saisie
 * libre) et c'est le RBAC serveur qui tranche. Ordre = du moins au plus
 * privilégié (lecture humaine).
 */
export const STUDIO_ROLES: readonly string[] = [
  ROLE_USER,
  ROLE_DEV,
  ROLE_SUPERVISOR,
  ROLE_NODEFONY_ADMIN,
];

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

/**
 * Filtre de visibilité unifié (nav, route `RoleGuard`, widget du catalogue) :
 *  1. un **administrateur Nodefony voit TOUT** (court-circuit) — c'est la règle
 *     « admin nodefony voit tout », posée ICI une seule fois plutôt que répétée
 *     sur chaque item / route / bloc ;
 *  2. sinon `required` absent ou vide ⇒ visible par tous (self-service) ;
 *  3. sinon intersection (au moins un rôle requis).
 *
 * PUR (aucun hook) → réutilisable hors React : `registry.ts` (catalogue),
 * helpers, tests. Les composants React passent par `isVisibleForRoles(req,
 * auth.roles)` en restant `observer`.
 */
export function isVisibleForRoles(
  required: readonly string[] | undefined,
  userRoles: string[],
): boolean {
  if (hasRole(userRoles, ROLE_NODEFONY_ADMIN)) return true;
  if (!required || required.length === 0) return true;
  return hasAnyRole(userRoles, required as string[]);
}

/**
 * Bundles de rôles RÉUTILISÉS par la navigation (`navConfig`), les routes
 * (`RoleGuard` dans `App.tsx`) et la politique du catalogue (`registry.ts`) —
 * **source unique** pour éviter la dérive entre « ce que cache le menu » et « ce
 * que garde la route ». `ROLE_NODEFONY_ADMIN` n'y figure jamais : il voit tout
 * via {@link isVisibleForRoles}. Lecture : à quel persona une surface s'adresse.
 */
export const VIEW_ROLES: Record<"devops" | "dev" | "ops" | "admin", string[]> =
  {
    /** Introspection + exploitation : développeur et superviseur. */
    devops: [ROLE_DEV, ROLE_SUPERVISOR],
    /** Outils de développement / introspection pure (data, system, archi). */
    dev: [ROLE_DEV],
    /** Exploitation / santé runtime (supervision, cluster). */
    ops: [ROLE_SUPERVISOR],
    /** Gouvernance — administrateur Nodefony uniquement. */
    admin: [ROLE_NODEFONY_ADMIN],
  };
