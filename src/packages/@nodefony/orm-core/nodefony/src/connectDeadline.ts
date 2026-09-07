/**
 * Le DÉLAI DE GARDE d'une connexion à une base — une commande n'attend jamais
 * sans fin.
 *
 * 🔴 Le cas est vécu, et il ne ressemble pas à une panne : `nodefony inspect
 * config` restait suspendu, sans un mot, sans erreur, sans reprendre la main.
 * Aucun driver ne borne l'établissement par défaut — `pg-pool` traite son
 * `connectionTimeoutMillis` à `0` comme « attendre indéfiniment » — et un
 * serveur qui accepte la connexion TCP sans jamais répondre (conteneur en
 * train de mourir, port relayé vers rien, réseau qui avale les paquets) laisse
 * l'appelant pendu.
 *
 * Une commande de diagnostic qui se bloque est pire qu'une commande qui
 * échoue : l'échec nomme une cause, le blocage n'apprend rien et fait douter
 * de l'outil plutôt que de l'infrastructure.
 *
 * @module
 */

/**
 * Le temps qu'on accorde à une base pour ACCEPTER une connexion, en
 * millisecondes.
 *
 * Dix secondes, et ce n'est pas un réglage de performance : c'est la frontière
 * entre « lent » et « ne répondra pas ». Un serveur local répond en quelques
 * millisecondes, un serveur infonuagique qui sort de veille en quelques
 * secondes ; au-delà, ce qui se passe n'est plus une lenteur, et le dire vaut
 * mieux que l'attendre.
 *
 * Volontairement NON configurable : le besoin n'est pas de choisir une durée,
 * c'est de n'attendre jamais sans fin. Une clé de configuration serait une
 * surface publique à porter pour toute une série majeure, au service d'un
 * réglage que personne n'a demandé.
 */
export const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Borne l'attente d'une promesse, et rejette avec une cause NOMMÉE au-delà.
 *
 * Le message importe autant que la borne : « délai dépassé » sans sujet
 * envoie chercher partout. Celui-ci dit ce qu'on attendait, de qui, et
 * combien de temps — c'est ce qui distingue un diagnostic d'un abandon.
 *
 * Le minuteur est `unref`é : il ne doit pas, à lui seul, retenir le processus
 * en vie une fois la réponse arrivée.
 *
 * @param work - la promesse à borner (établissement, ping…).
 * @param what - ce qu'on attend, à la première personne du sujet : « la
 *   réponse de postgres 127.0.0.1:5432 ».
 * @param ms - la borne, en millisecondes.
 * @returns la valeur de `work` si elle arrive à temps.
 * @throws Error quand la borne est atteinte — jamais de résolution silencieuse.
 */
export async function withConnectDeadline<T>(
  work: Promise<T>,
  what: string,
  ms: number = CONNECT_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `délai dépassé (${ms} ms) en attendant ${what} — le serveur a ` +
                `accepté la connexion sans répondre, ou n'a jamais répondu. ` +
                `Vérifier que le service visé est bien celui qui écoute, et ` +
                `qu'il est en état de servir.`,
            ),
          );
        }, ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
