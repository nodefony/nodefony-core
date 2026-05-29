/**
 * Validation du `Host` entrant contre les domaines que CE serveur accepte de
 * servir (vhosts). Pendant « domaine » du `trustProxy` (qui, lui, filtre par IP).
 *
 * Deux notions distinctes dans Nodefony — ne pas confondre :
 * - **kernel-level (`domainAlias`)** : quels vhosts le serveur sert. Host inconnu
 *   → 401 (cf `HttpKernel.checkValidDomain`). C'est ce module.
 * - **route-level (`@Domain`)** : restreindre UNE route à un sous-ensemble de
 *   vhosts déjà servis. Match → 403 (cf `Route.matchHostname`).
 *
 * Fonctions PURES (config → `RegExp[]`, puis `RegExp[]` + host → booléen) :
 * compilation faite UNE fois au boot, le test par requête est un simple
 * `RegExp.test` sur des regexps pré-compilées (zéro allocation hot-path).
 */

/**
 * Valeur de configuration `kernel.domainAlias` :
 * - `string` : un ou plusieurs patterns séparés par espace ou virgule
 *   (`"app.example.com, *.cdn.example.com"`).
 * - `(string | RegExp)[]` : liste de patterns (string compilée, `RegExp` reprise telle quelle).
 * - `Record<string, string | RegExp>` : map nommée (la clé est ignorée, seule la valeur compte).
 */
export type DomainAlias =
  | string
  | (string | RegExp)[]
  | Record<string, string | RegExp>;

/**
 * Compile le domaine principal + ses alias en une liste de `RegExp`.
 *
 * Le domaine principal est TOUJOURS ancré (`^domain$`) : seul un Host
 * exactement égal passe. Les alias string sont compilés via `new RegExp(pattern, "u")`
 * (le pattern est fourni par la config serveur, pas par le client — pas une
 * entrée non fiable). Les `RegExp` déjà construites sont reprises telles quelles.
 *
 * @param domain - domaine principal du serveur (`kernel.domain`), ancré exact.
 * @param alias - alias additionnels (`kernel.domainAlias`), optionnel.
 * @returns liste de `RegExp` à tester contre le `Host` entrant.
 */
export function compileDomainAlias(
  domain: string,
  alias?: DomainAlias,
): RegExp[] {
  const out: RegExp[] = [new RegExp(`^${domain}$`, "u")];
  if (!alias) {
    return out;
  }
  if (typeof alias === "string") {
    // Patterns séparés par espace ou virgule. Les tokens vides sont ignorés :
    // `new RegExp("")` = /(?:)/ matche TOUT → trou de sécurité (vhost wildcard
    // implicite). Garde explicite.
    for (const part of alias.split(/[ ,]+/u)) {
      if (part) {
        out.push(new RegExp(part, "u"));
      }
    }
    return out;
  }
  // Array ou objet : on ne s'intéresse qu'aux valeurs.
  const values = Array.isArray(alias) ? alias : Object.values(alias);
  for (const ele of values) {
    if (typeof ele === "string") {
      if (ele) {
        out.push(new RegExp(ele, "u"));
      }
    } else if (ele instanceof RegExp) {
      out.push(ele);
    }
  }
  return out;
}

/**
 * Teste un `Host` entrant contre la liste de `RegExp` pré-compilée.
 *
 * @param regAlias - sortie de {@link compileDomainAlias}.
 * @param domain - `Host` de la requête (`context.domain`).
 * @returns `true` dès le premier match (court-circuit), `false` sinon.
 */
export function isDomainAllowed(regAlias: RegExp[], domain: string): boolean {
  for (const reg of regAlias) {
    if (reg.test(domain)) {
      return true;
    }
  }
  return false;
}
