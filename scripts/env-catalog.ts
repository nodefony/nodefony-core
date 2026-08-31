/**
 * Ce que les variables de DÉCOR DE BANC font — la seule part qu'aucun automate
 * ne sait rendre.
 *
 * ## Ce que ce fichier n'est pas
 *
 * Ce n'est pas la liste des variables : elle se relève sur le disque, et
 * `scripts/env-snapshot.ts` la produit gratuitement, exhaustivement, à chaque
 * appel. Une liste tenue à la main aurait des trous, et ne le dirait pas.
 *
 * C'est le **complément** que la lecture du code ne donne pas en un coup d'œil :
 * le rôle en une phrase, la grammaire des valeurs, et surtout **« absente ⇒
 * quoi ? »**. Sur ce dépôt, une variable de décor manquante ne lève jamais —
 * elle fait sauter un banc, et un banc sauté compte comme vert. C'est ce champ,
 * et lui seul, qui évite de conclure sur une preuve qui n'a pas eu lieu.
 *
 * ## La règle
 *
 * Une variable lue UNIQUEMENT sous un banc doit figurer ici, sinon le générateur
 * REFUSE ; une entrée que plus rien ne lit doit en sortir, sinon il refuse
 * aussi. Les deux sens comptent : une description orpheline envoie chercher une
 * variable qui n'existe plus.
 *
 * L'infra et les interrupteurs de coût ne sont **pas** ici : ils vivent dans
 * `vitest.gates.ts`, source unique du dépôt, et le générateur les y LIT.
 */

/** Ce qu'il faut savoir d'une variable de décor avant de lancer un banc. */
export interface IEnvDeclaration {
  /** Le rôle, en une phrase auto-suffisante. */
  what: string;
  /** Grammaire des valeurs acceptées, quand elle est bornée. */
  values?: string;
  /** Ce qui se passe quand elle est ABSENTE — le champ décisif. */
  absent: string;
  /** Décor auquel elle appartient : ce qui se pose ensemble se lit ensemble. */
  group: string;
}

/**
 * Les décors de banc, groupés par ce qu'on allume ensemble.
 *
 * Ordre alphabétique — l'ordre d'écriture n'a aucun sens ici, et un ordre
 * arbitraire fait perdre du temps à chaque relecture.
 */
export const BENCH_DECOR: Record<string, IEnvDeclaration> = {
  NF__SECURITY__RATELIMIT__ENABLED: {
    what: "Allume la limitation de débit du pare-feu pour les bancs qui l'attaquent.",
    values: '`"true"` — toute autre valeur laisse la limitation éteinte',
    absent:
      "Les cas qui prouvent le throttling sont SAUTÉS ; la suite reste verte sans avoir exercé la limitation.",
    group: "pare-feu — limitation de débit",
  },
  NF_ADOPT_FIXTURE: {
    what: "Fait exporter au module `test` la table applicative que le banc d'adoption doit trouver.",
    values:
      "`sqlite|postgres|mysql`, éventuellement suffixé `+slug`, `+paire`, `+orphelin` ou `+usurpe`",
    absent:
      "Le fichier d'entité s'importe et n'exporte AUCUNE table : l'adoption n'a rien à adopter, et une génération voit disparaître la table — ce qu'un outil de diff prend pour une suppression.",
    group: "banc d'adoption de base (migrations)",
  },
  NF_BCRYPT_COST: {
    what: "Coût bcrypt du banc de débit du hachage de mots de passe.",
    values: "entier — défaut 12",
    absent: "Le banc mesure au coût 12.",
    group: "banc bcrypt",
  },
  NF_BCRYPT_N: {
    what: "Nombre de hachages mesurés par le banc de débit bcrypt.",
    values: "entier — défaut 32",
    absent: "Le banc mesure 32 hachages.",
    group: "banc bcrypt",
  },
  NF_BENCH_ORM: {
    what: "Monte le décor du banc du cycle ORM dans le module `test` (routes, entités, amorçage).",
    values: "`1` — toute autre valeur laisse le décor absent",
    absent:
      "Les routes du banc ORM n'existent pas : un banc lancé sans elle rend des 404 qu'on prend pour une régression de routage.",
    group: "bancs du module test",
  },
  NF_BENCH_WS_BACKPRESSURE: {
    what: "Monte le point d'entrée WebSocket capable d'inonder une connexion, pour mesurer la contre-pression.",
    values: "`1` — toute autre valeur laisse le point d'entrée absent",
    absent:
      "Le point d'entrée n'existe pas — c'est voulu : offert en permanence, il serait une amplification à la demande de qui la réclame.",
    group: "bancs du module test",
  },
  NF_BENCH_WS_BYTES: {
    what: "Taille en octets de chaque trame émise par le banc de contre-pression WebSocket.",
    values: "entier — défaut 16384",
    absent: "Le banc émet des trames de 16 Kio.",
    group: "bancs du module test",
  },
  NF_BENCH_WS_FRAMES: {
    what: "Nombre de trames émises d'un bloc par le banc de contre-pression WebSocket.",
    values: "entier — défaut 400",
    absent: "Le banc émet 400 trames.",
    group: "bancs du module test",
  },
  NF_BROWSER_TEST_ACTION: {
    what: "Sélecteur de l'élément sur lequel le banc navigateur doit cliquer.",
    values: "sélecteur CSS",
    absent: "Le banc ne clique sur rien et se borne à constater l'affichage.",
    group: "banc navigateur (devkit)",
  },
  NF_BROWSER_TEST_API: {
    what: "Route de data plane que le banc navigateur interroge depuis la page.",
    values: "chemin absolu — défaut `/nodefony/kernel/api/info`",
    absent: "Le banc interroge la route d'information du kernel.",
    group: "banc navigateur (devkit)",
  },
  NF_BROWSER_TEST_BASE: {
    what: "Origine que le pilote local ouvre.",
    values: "URL — défaut `https://127.0.0.1:5152`",
    absent: "Le banc vise le serveur de développement en TLS local.",
    group: "banc navigateur (devkit)",
  },
  NF_BROWSER_TEST_BASE_CONTENEUR: {
    what: "Origine que le navigateur EN CONTENEUR doit ouvrir — elle diffère de l'origine locale, `127.0.0.1` n'y désignant pas l'hôte.",
    values: "URL",
    absent:
      "Le banc en conteneur retombe sur l'origine par défaut du conteneur ; viser le mauvais hôte rend un échec qui ressemble à une panne du produit.",
    group: "banc navigateur (devkit)",
  },
  NF_BROWSER_TEST_CHANNEL: {
    what: "Canal temps réel auquel la page doit s'abonner avec succès.",
    values: "nom de canal — défaut `nodefony:supervision`",
    absent: "Le banc éprouve le canal de supervision.",
    group: "banc navigateur (devkit)",
  },
  NF_BROWSER_TEST_CHANNEL_REFUSE: {
    what: "Canal dont l'abonnement doit être REFUSÉ — la moitié négative de la preuve.",
    values: "nom de canal — défaut `nodefony:syslog`",
    absent: "Le banc éprouve le refus sur le canal du journal système.",
    group: "banc navigateur (devkit)",
  },
  NF_BROWSER_TEST_CONTAINER: {
    what: "Nom du conteneur qui porte le navigateur, quand la voie conteneur est choisie.",
    values: "nom docker — défaut `nodefony-browser`",
    absent: "Le banc s'adresse au conteneur nommé `nodefony-browser`.",
    group: "banc navigateur (devkit)",
  },
  NF_BROWSER_TEST_EXPECT: {
    what: "Texte qui doit apparaître à l'écran pour que la page soit tenue pour peuplée.",
    values: "texte — défaut « Santé du framework »",
    absent:
      "Le banc attend le titre par défaut ; mesurer avant que l'écran soit peuplé est l'erreur qui fait conclure faux.",
    group: "banc navigateur (devkit)",
  },
  NF_BROWSER_TEST_LOGIN: {
    what: "Chemin du formulaire d'authentification.",
    values: "chemin absolu — défaut `/nodefony/login`",
    absent: "Le banc s'authentifie par l'écran d'administration.",
    group: "banc navigateur (devkit)",
  },
  NF_BROWSER_TEST_PAGE: {
    what: "Page authentifiée que le banc ouvre et mesure.",
    values: "chemin absolu — défaut `/nodefony/supervision`",
    absent: "Le banc ouvre l'écran de supervision.",
    group: "banc navigateur (devkit)",
  },
  NF_BROWSER_TEST_PAGE_PUBLIQUE: {
    what: "Page atteignable SANS session, pour distinguer un refus d'autorisation d'une panne.",
    values: "chemin absolu — défaut : la page d'authentification",
    absent: "Le banc prend la page d'authentification comme page publique.",
    group: "banc navigateur (devkit)",
  },
  NF_BROWSER_TEST_PAGE_SOCKET: {
    what: "Page depuis laquelle le socket est ouvert — il hérite de ses cookies et de son origine.",
    values: "chemin absolu — défaut `/nodefony`",
    absent: "Le socket est ouvert depuis la racine de l'administration.",
    group: "banc navigateur (devkit)",
  },
  NF_BROWSER_TEST_PASSWORD: {
    what: "Mot de passe du compte qui doit être ACCEPTÉ.",
    values: "chaîne — défaut `secret`",
    absent: "Le banc utilise le mot de passe de développement.",
    group: "banc navigateur (devkit)",
  },
  NF_BROWSER_TEST_PASSWORD_REFUSE: {
    what: "Mot de passe du compte dont l'accès doit être REFUSÉ.",
    values: "chaîne — défaut `secret`",
    absent:
      "Le banc utilise le mot de passe de développement pour le cas négatif.",
    group: "banc navigateur (devkit)",
  },
  NF_BROWSER_TEST_SOCKET: {
    what: "Point d'entrée du socket temps réel éprouvé depuis la page.",
    values: "chemin absolu — défaut `/nodefony/studio/api/realtime`",
    absent: "Le banc ouvre le socket de la console d'administration.",
    group: "banc navigateur (devkit)",
  },
  NF_BROWSER_TEST_USER: {
    what: "Identifiant du compte qui doit être ACCEPTÉ.",
    values: "chaîne — défaut `admin`",
    absent: "Le banc s'authentifie en administrateur.",
    group: "banc navigateur (devkit)",
  },
  NF_BROWSER_TEST_USER_REFUSE: {
    what: "Identifiant du compte dont l'accès à la page protégée doit être REFUSÉ.",
    values: "chaîne — défaut `user`",
    absent: "Le banc éprouve le refus avec un compte sans privilège.",
    group: "banc navigateur (devkit)",
  },
  NF_CLI_READY_TIMEOUT_MS: {
    what: "Délai accordé au démarrage d'un kernel avant que le banc de la ligne de commande abandonne.",
    values: "millisecondes — défaut 80 000",
    absent:
      "Le banc attend 80 s ; sur une machine lente ou froide, c'est ce délai qui décide, pas le produit.",
    group: "banc de la ligne de commande",
  },
  NF_CLI_TIMEOUT_MS: {
    what: "Délai total d'un cas du banc de la ligne de commande.",
    values: "millisecondes — défaut 120 000",
    absent: "Le banc borne chaque cas à 2 min.",
    group: "banc de la ligne de commande",
  },
  NF_DB_OUTAGE_MONGO_CONTAINER: {
    what: "Nom du conteneur MongoDB que le banc a le droit d'ARRÊTER pour éprouver une coupure réelle.",
    values: "nom docker",
    absent:
      "Le banc de coupure MongoDB est SAUTÉ — le produit n'est jamais mis à l'épreuve d'une base qui tombe.",
    group: "coupure réelle de base",
  },
  NF_DB_OUTAGE_MYSQL_CONTAINER: {
    what: "Nom du conteneur MySQL que le banc a le droit d'ARRÊTER pour éprouver une coupure réelle.",
    values: "nom docker",
    absent: "Le banc de coupure MySQL est SAUTÉ.",
    group: "coupure réelle de base",
  },
  NF_DB_OUTAGE_PG_CONTAINER: {
    what: "Nom du conteneur PostgreSQL que le banc a le droit d'ARRÊTER pour éprouver une coupure réelle.",
    values: "nom docker",
    absent: "Le banc de coupure PostgreSQL est SAUTÉ.",
    group: "coupure réelle de base",
  },
  NF_MCP_TEST_BASE: {
    what: "Origine de la porte MCP éprouvée par le banc.",
    values: "URL — défaut `https://127.0.0.1:5152`",
    absent: "Le banc vise le serveur de développement en TLS local.",
    group: "banc MCP (devkit)",
  },
  NF_MCP_TEST_RESOURCE_BASE: {
    what: "Origine attendue dans le document de ressource protégée (RFC 9728) — elle diffère de l'origine d'appel.",
    values: "URL — défaut `http://localhost:5151`",
    absent: "Le banc attend l'origine en clair du serveur de développement.",
    group: "banc MCP (devkit)",
  },
  NF_PERF_COUNT: {
    what: "Nombre de messages publiés par la mesure de débit du banc cluster temps réel.",
    values: "entier — défaut 5000",
    absent: "La mesure porte sur 5000 messages.",
    group: "banc cluster temps réel",
  },
  NF_RT_CHANNEL: {
    what: "Canal temps réel sur lequel les exemplaires du banc cluster se parlent.",
    values: "nom de canal — défaut `nodefony:rt:e2e`",
    absent:
      "Les exemplaires partagent le canal par défaut : deux bancs lancés en même temps se mélangent, et le verdict dépend du voisin.",
    group: "banc cluster temps réel",
  },
  NF_WS_RUPTURE_CAP: {
    what: "Plafond de connexions simultanées que la sonde de rupture WebSocket s'autorise.",
    values: "entier — défaut 8000",
    absent:
      "La sonde s'arrête à 8000 : elle mesure alors SON plafond, pas celui du produit — le vrai plafond exige de relever cette borne.",
    group: "sonde de rupture WebSocket",
  },
  NF_WS_RUPTURE_STEP: {
    what: "Pas d'augmentation des connexions entre deux paliers de la sonde de rupture.",
    values: "entier — défaut 1000",
    absent: "La sonde progresse par paliers de 1000 connexions.",
    group: "sonde de rupture WebSocket",
  },
};
