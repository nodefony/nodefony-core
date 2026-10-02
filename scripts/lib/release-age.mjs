/**
 * Délai de décantation — la contrainte qu'une application générée impose à
 * l'installation, vue depuis le dépôt qui publie.
 *
 * Les gabarits écrivent `min-release-age` (npm), `minimumReleaseAge` (pnpm,
 * bun) : le gestionnaire de l'utilisateur refuse toute version publiée depuis
 * moins de {@link RELEASE_AGE_DAYS} jours. Le framework en est exempté, PAS ses
 * dépendances tierces. Si une version que nous exigeons — dans le catalogue du
 * scaffold ou dans les dépendances d'un paquet publié — est trop jeune et
 * qu'aucune plus ancienne ne satisfait la plage, l'installation de
 * l'utilisateur échoue (`ETARGET`, `ERR_PNPM_NO_MATURE_MATCHING_VERSION`),
 * pendant que le dépôt, lui, reste vert.
 *
 * Module PUR : il reçoit les dates du registre, il ne les lit pas.
 */
import semver from "semver";

/**
 * Délai en jours. COPIE de `RELEASE_AGE_DAYS`
 * (`src/nodefony/src/cli/packageManager.ts`) — un script `.mjs` ne peut pas
 * importer la source TypeScript du cœur, et le `dist` n'existe pas encore quand
 * la garde tourne. L'égalité des deux est confrontée par `release-age.test.mjs`.
 */
export const RELEASE_AGE_DAYS = 3;

/**
 * Paquets exemptés du délai. COPIE de `RELEASE_AGE_EXCLUDES` (même fichier
 * source, même confrontation) : ce sont les nôtres, publiés ensemble.
 */
export const RELEASE_AGE_EXCLUDES = [
  "nodefony",
  "@nodefony/*",
  "create-nodefony",
];

/**
 * Dit si un paquet est exempté — même lecture que les gestionnaires : nom exact,
 * ou portée entière pour un motif `@portée/*`.
 *
 * @param name - nom du paquet.
 * @returns vrai si le délai ne s'applique pas à lui.
 */
export function isReleaseAgeExempt(name) {
  return RELEASE_AGE_EXCLUDES.some((pattern) =>
    pattern.endsWith("/*")
      ? name.startsWith(pattern.slice(0, -1))
      : name === pattern,
  );
}

/**
 * Dit si l'installateur trouvera une version MÛRE pour cette plage.
 *
 * La règle est celle des gestionnaires : parmi les versions publiées qui
 * satisfont la plage, ne retenir que celles antérieures à la date limite. Une
 * plage satisfaite par une version ancienne passe — l'installateur la prendra,
 * avec un retard, pas une panne.
 *
 * @param times - carte version → date ISO de publication (champ `time` du
 *        document complet du registre).
 * @param spec - plage déclarée (`^5.0.3`, `8.23.1`).
 * @param cutoffMs - date limite (`Date.now() - délai`), en millisecondes.
 * @returns `null` si une version mûre existe ; sinon la plus jeune version
 *          satisfaisante et sa date — ce qu'il faut attendre, ou redescendre.
 *          `undefined` quand la plage ne se lit pas (on ne tranche pas).
 */
export function immatureRange(times, spec, cutoffMs) {
  if (!semver.validRange(spec)) return undefined;
  const satisfying = Object.keys(times ?? {}).filter(
    (v) => semver.valid(v) && semver.satisfies(v, spec),
  );
  if (satisfying.length === 0) return undefined;
  if (satisfying.some((v) => Date.parse(times[v]) < cutoffMs)) return null;
  const youngest = satisfying.sort(semver.compare)[0];
  return { version: youngest, publishedAt: times[youngest] };
}
