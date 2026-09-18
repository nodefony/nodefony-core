/**
 * **Ce qui n'a rien à faire dans un artefact publié** — tarball npm ou image de
 * conteneur.
 *
 * La règle porte sur des NOMS, et c'est délibéré : ce n'est pas un scanner de
 * secrets par contenu (c'est le métier de `gitleaks`, qui lit l'arbre et son
 * historique). Ce sont des noms connus du produit et de l'écosystème — une liste
 * courte, donc une alerte qu'on ne prend jamais l'habitude d'ignorer.
 *
 * Cette règle vivait dans les scripts de publication du dépôt du framework,
 * c'est-à-dire nulle part pour qui installe Nodefony depuis npm : une
 * application ne pouvait pas contrôler sa propre image. Elle est ici, dans le
 * produit, pour que la commande `nodefony image:check` la porte partout.
 */

/**
 * Fichiers qui n'ont rien à faire dans un tarball publié.
 *
 * `files` du `package.json` est une liste d'autorisation, donc la fuite est
 * improbable — mais « improbable » n'est pas « vérifié », et un secret publié
 * est public pour toujours : npm n'autorise le retrait que 72 heures, et un
 * secret est compromis à la seconde où il est en ligne.
 *
 * Le motif vise des noms de fichiers ENTIERS, pas des fragments : une page de
 * documentation nommée `environment.md` ou un module `keys.js` sont légitimes,
 * et les signaler entraînerait l'habitude d'ignorer cette alerte.
 *
 * 🔴 `keyset.json` est dans la liste parce qu'un secret ne se reconnaît PAS à
 * son extension. C'est le trousseau JWT que `JwtKeystore` écrit sous
 * `var/keys/` hors production — une clé privée Ed25519 dans un fichier qui a
 * l'air d'une configuration. Toute la liste dit la même chose : ce sont des
 * NOMS connus du produit, pas une heuristique sur les suffixes.
 *
 * @param files - les chemins à juger, sans `/` initial
 * @returns ceux qui interdisent la publication
 */
export function detectSuspectFiles(files: string[]): string[] {
  const SUSPECT =
    /(^|\/)(\.env(\.[\w-]+)?|\.npmrc|\.netrc|id_rsa|id_ed25519|keyset\.json|[\w.-]+\.(pem|p12|pfx|key|keystore)|secrets?\.(json|ya?ml|toml))$/i;
  const GIT = /(^|\/)\.git\//;
  return files.filter((file) => SUSPECT.test(file) || GIT.test(file));
}

/**
 * La MÊME règle, appliquée à l'inventaire d'une image de conteneur.
 *
 * L'image publiée était le seul artefact que rien ne regardait : la
 * `10.0.0-alpha.4` embarquait `nodefony/config/certificates/server/privkey.pem`,
 * une clé RSA que tous ses déploiements auraient partagée. Deux correctifs ont
 * fermé le chemin connu — le `.dockerignore` généré exclut la matière
 * cryptographique, et l'application n'en fabrique plus en production —, mais
 * aucun ne REGARDE ce qui part. Un fichier ajouté au gabarit, un `.dockerignore`
 * amputé, et le défaut revient sans que personne le voie.
 *
 * Le motif est celui des tarballs, sciemment : une seule liste de ce qui ne doit
 * pas sortir, deux artefacts à garder. Trois tolérances l'en séparent, et
 * chacune évite un rouge que le lecteur apprendrait à ignorer :
 *
 * - **`node_modules/`** — un `.pem` y est une donnée de test de la dépendance
 *   qui l'apporte. Le `.npmrc` de npm lui-même vit sous
 *   `usr/local/lib/node_modules/npm/`, dans l'image de base.
 * - **`.env` NU, et lui seul** — c'est une convention du framework : ce fichier
 *   est commité, il porte le catalogue des variables et des défauts non
 *   secrets ; les secrets vivent dans `.env.local`, que le `.gitignore` et le
 *   `.dockerignore` écartent tous deux. `.env.local`, `.env.production` et
 *   toute autre forme suffixée restent fatals. La tolérance est bornée à la
 *   racine de l'image ou du répertoire de travail : sans cette borne, elle
 *   couvrait `app/.gemini/.env`, où `nodefony ai:mcp` écrit le JETON PORTEUR du
 *   serveur MCP — le contrôle laissait donc passer le secret le plus facile à
 *   publier d'une application Nodefony, au nom d'un fichier qui n'en porte
 *   aucun.
 * - **les magasins de certificats PUBLICS du système** — `etc/ssl/cert.pem` sur
 *   Alpine, `etc/ssl/certs/*` sur Debian : ce sont les autorités de
 *   certification apportées par l'image de base, et les signaler apprendrait à
 *   ignorer l'alerte le jour où elle vaut. La tolérance est bornée deux fois,
 *   parce qu'un magasin voisin porte l'inverse : elle ne couvre que les
 *   répertoires de CERTIFICATS — jamais `etc/ssl/private/`, qui est très
 *   exactement l'endroit où une clé privée de serveur se range —, et seulement
 *   les extensions d'un certificat. Une `.key` sous `etc/ssl/certs/` reste
 *   fatale : elle n'a rien à y faire.
 *
 * @param files - tous les chemins de toutes les COUCHES, sans `/` initial
 * @returns les chemins qui interdisent la publication
 */
export function detectSuspectImageFiles(files: string[]): string[] {
  const DEPENDENCY = /(^|\/)node_modules\//;
  const BARE_ENV = /^([^/]+\/)?\.env$/;
  // `ssl[^/]*` couvre le `ssl1.1` d'Alpine sans ouvrir `etc/ssl/private/`.
  const PUBLIC_TRUST_STORE =
    /^(etc\/ssl[^/]*\/(certs?\.pem|certs\/)|etc\/pki\/tls\/certs\/|etc\/ca-certificates\/|usr\/(local\/)?share\/ca-certificates\/|usr\/lib\/ssl\/certs\/)/;
  const CERTIFICATE = /\.(pem|crt|cer)$/i;
  return detectSuspectFiles(
    files.filter(
      (file) =>
        !DEPENDENCY.test(file) &&
        !BARE_ENV.test(file) &&
        !(PUBLIC_TRUST_STORE.test(file) && CERTIFICATE.test(file)),
    ),
  );
}
