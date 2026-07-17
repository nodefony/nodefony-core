import "reflect-metadata";
import Injector from "./injector";
import type { ServiceConstructor } from "../Kernel";

/** Entrée d'un `@services([...])` : un constructeur, ou un chemin à charger. */
export type ServiceEntry = string | ServiceConstructor;

/**
 * Nom sous lequel un constructeur est enregistré au registre `@injectable`, ou
 * `null` s'il ne l'est pas.
 *
 * @remarks Recherche inversée (valeur → clé) : `@injectable(nom)` n'écrit sa clé
 *   nulle part sur la classe — seul le registre la connaît. C'est une
 *   conséquence du divorce registre/container ; le jour où le token sera la
 *   classe, cette fonction disparaîtra.
 */
const registeredNameOf = (ctor: ServiceConstructor): string | null => {
  const registry = Injector.injectables;
  for (const name of Object.keys(registry)) {
    if (registry[name] === ctor) return name;
  }
  return null;
};

/**
 * Noms des services dont un constructeur dépend, tels que le DI les résoudra :
 * `@inject("nom")` (priorité) puis l'auto-injection par type (`design:paramtypes`,
 * résolue sur le nom de classe).
 */
const declaredDependencyNames = (ctor: ServiceConstructor): string[] => {
  const explicit: (string | undefined)[] =
    Reflect.getMetadata("inject:services", ctor) || [];
  const paramTypes: unknown[] =
    Reflect.getMetadata("design:paramtypes", ctor) || [];

  const names: string[] = [];
  for (const name of explicit) if (name) names.push(name);
  for (const type of paramTypes) {
    const name = (type as { name?: string } | undefined)?.name;
    // Un paramètre n'est auto-injecté que si son type est ENREGISTRÉ — sinon il
    // reçoit un argument positionnel et ne crée aucune dépendance.
    if (name && Injector.isRegistered(name)) names.push(name);
  }
  return names;
};

/**
 * Réordonne les services d'un `@services([...])` selon leurs dépendances
 * **déclarées**, pour que l'ordre d'écriture cesse de compter.
 *
 * `@services` instancie séquentiellement et pose chaque instance au container :
 * un service réclamé par un autre doit donc exister AVANT lui, sinon le DI le
 * reconstruit sans argument et son constructeur casse. Faire reposer ça sur
 * l'ordre d'une liste écrite à la main est un piège : déplacer `HttpKernel` de
 * trois lignes dans `@nodefony/http` suffisait à rendre 499 sur chaque requête.
 * Les dépendances étant déjà déclarées (`@inject` / `design:paramtypes`), l'ordre
 * correct se **calcule** — c'est ce que font Symfony (container compilé) et
 * NestJS (résolution du graphe).
 *
 * Tri topologique **stable** : à contrainte égale, l'ordre d'écriture est
 * conservé — un `@services` déjà correct sort inchangé.
 *
 * Ne touche pas aux entrées dont les dépendances sont inconnaissables sans les
 * charger (chemins `string`) ni aux constructeurs hors registre : elles gardent
 * leur position relative.
 *
 * @param entries - la liste telle qu'écrite dans `@services([...])`.
 * @returns la même liste, réordonnée ; jamais une entrée perdue ou dupliquée.
 * @throws Si les dépendances déclarées forment un cycle (message nommant le cycle).
 */
export function orderServicesByDependencies(
  entries: readonly ServiceEntry[],
): ServiceEntry[] {
  if (entries.length < 2) return [...entries];

  // Nom registre → index, pour ne créer d'arête qu'entre services de CETTE liste.
  const indexByName = new Map<string, number>();
  entries.forEach((entry, i) => {
    if (typeof entry === "string") return;
    const name = registeredNameOf(entry);
    if (name !== null && !indexByName.has(name)) indexByName.set(name, i);
  });

  // dependsOn[i] = indices dont i dépend (doivent être instanciés AVANT i).
  const dependsOn: Set<number>[] = entries.map(() => new Set<number>());
  let hasEdge = false;
  entries.forEach((entry, i) => {
    if (typeof entry === "string") return;
    for (const depName of declaredDependencyNames(entry)) {
      const j = indexByName.get(depName);
      if (j === undefined || j === i) continue;
      dependsOn[i].add(j);
      hasEdge = true;
    }
  });

  // Aucune dépendance intra-liste → l'ordre écrit fait déjà foi.
  if (!hasEdge) return [...entries];

  // Kahn stable : à chaque tour, le plus petit index encore disponible.
  const remaining = new Set(entries.map((_, i) => i));
  const ordered: ServiceEntry[] = [];
  while (remaining.size > 0) {
    let picked = -1;
    for (const i of remaining) {
      let ready = true;
      for (const dep of dependsOn[i]) {
        if (remaining.has(dep)) {
          ready = false;
          break;
        }
      }
      if (ready) {
        picked = i;
        break; // `remaining` itère dans l'ordre d'insertion → stabilité.
      }
    }
    if (picked === -1) {
      const cycle = [...remaining]
        .map((i) => {
          const e = entries[i];
          return typeof e === "string" ? e : e.name;
        })
        .join(" → ");
      throw new Error(
        `Circular service dependency in @services([...]): ${cycle}. ` +
          `Services are instantiated in dependency order; a cycle has no valid order.`,
      );
    }
    ordered.push(entries[picked]);
    remaining.delete(picked);
  }
  return ordered;
}
