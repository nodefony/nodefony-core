# Politique de sécurité — Nodefony

Merci de prendre le temps de signaler un problème de sécurité. Ce document dit **par où passer**, ce
sur quoi porte l'engagement, et à quoi vous pouvez raisonnablement vous attendre.

## Signaler une faille

**N'ouvrez pas d'issue publique, de discussion ni de pull request pour une faille de sécurité.**
Une issue est indexée en quelques minutes : la publier, c'est armer tout le monde avant que le
correctif existe.

Deux canaux privés, par ordre de préférence :

1. **GitHub — signalement privé de vulnérabilité** (recommandé) :
   onglet **Security** du dépôt [`nodefony/nodefony-core`](https://github.com/nodefony/nodefony-core/security)
   → _Report a vulnerability_. L'échange reste privé, et c'est de là que part l'avis publié (GHSA)
   et la demande de CVE une fois le correctif disponible.
2. **Courriel** : `ccamensuli@gmail.com`, avec `[SECURITY]` en objet — si le canal GitHub vous est
   inaccessible.

### Ce qui rend un rapport exploitable

- La **version** concernée (`npm ls nodefony`) et la version de Node.js.
- Le **chemin d'attaque** : qui peut le déclencher, depuis où, et avec quels droits au départ
  (anonyme ? utilisateur authentifié ? administrateur ?). C'est ce qui décide de la gravité.
- Une **reproduction minimale** : requête HTTP brute, trame WebSocket, extrait de configuration.
  Une application témoin de vingt lignes vaut mieux qu'une description.
- L'**impact** observé, pas seulement supposé : lecture de données d'autrui, contournement
  d'authentification, exécution de code, déni de service.
- Si vous avez un correctif en tête, dites-le — mais **envoyez-le par le canal privé**, jamais en
  pull request publique : un patch public raconte la faille.

## À quoi vous attendre

Nodefony est un projet **libre, développé bénévolement par une seule personne** (licence CeCILL-B).
Autant l'annoncer franchement plutôt que promettre des délais d'éditeur :

| Étape                                    | Objectif                                                              |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Accusé de réception                      | 5 jours ouvrés                                                        |
| Première évaluation (gravité, périmètre) | 14 jours                                                              |
| Correctif                                | selon la gravité et la difficulté — le calendrier est dit, pas promis |
| Avis public (GHSA) + version corrigée    | ensemble, jamais l'un avant l'autre                                   |

Il n'y a **pas de programme de primes** (pas de bug bounty) : aucune récompense financière. Les
personnes qui le souhaitent sont **créditées** dans l'avis publié et dans le message de commit.

**Divulgation coordonnée.** L'usage est de publier ensemble le correctif et l'avis. Si le correctif
tarde, l'échéance raisonnable est de **90 jours** après l'accusé de réception ; si vous prévoyez de
publier, prévenez — un accord vaut mieux qu'une surprise de part et d'autre.

## Versions concernées

| Version                                              | État                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `10.x` (branche TypeScript)                          | en préparation, **pas encore publiée sur npm** — les rapports sont bienvenus                      |
| `nodefony` ≤ `7.x` (framework JavaScript historique) | **dépréciée** — plus aucun correctif, de sécurité ou autre ; la réécriture TypeScript la remplace |

Les paquets couverts par cette politique, une fois publiés, sont ceux du dépôt :
`nodefony`, `@nodefony/http`, `@nodefony/framework`, `@nodefony/security`, `@nodefony/user`,
`@nodefony/realtime`, `@nodefony/frontend`, `@nodefony/studio`, `@nodefony/orm-core`,
`@nodefony/drizzle`, `@nodefony/mongoose`, `@nodefony/redis`, `@nodefony/documentation`.

## Périmètre — ce qui est une faille, et ce qui n'en est pas

Ce dépôt est **auto-hébergé** : sa racine est une _application de démonstration_ qui sert à éprouver
le framework en marche. Ce qui vaut pour cette application de test ne vaut pas pour le framework
distribué, et plusieurs constats attendus n'en sont donc pas des vulnérabilités :

- **Les comptes de développement** (`nodefony/security/devUsers.ts`, mots de passe en clair) : ils
  appartiennent à l'application de démonstration et ne sont créés qu'en environnement de
  développement. Ils ne sont dans aucun paquet publié.
- **Les modules marqués `policy: "dev"`** (`@nodefony/test`, `@nodefony/test-frontend-react`) : le
  noyau les écarte hors développement. Une route de test joignable en développement est voulue.
- **Les surfaces d'outillage derrière un drapeau explicite**, comme la route de banc activée par
  `NF_BENCH_ROUTE=1` : absente sans le drapeau.
- **Les maquettes de la couche IA** (`@nodefony/agent`, `@nodefony/llm`, `@nodefony/memory`,
  `@nodefony/rag`, `@nodefony/vector`, en version `0.0.0`) : des explorations privées qui donnent
  une direction, non publiées et destinées à être réécrites. Elles ne sont dans aucune version
  distribuée.
- **Une application mal configurée** : pare-feu laissé ouvert, secret de session laissé au défaut,
  console d'administration exposée sur Internet, `trust proxy` accordé à un réseau non maîtrisé.
  La documentation en porte la responsabilité — un défaut dangereux **est** en revanche un bug de
  sécurité, dites-le.
- Un **résultat de scanner automatique** sans chemin d'attaque démontré, un en-tête manquant sans
  conséquence établie, ou une attaque supposant déjà un accès administrateur.

En revanche, tout ce qui suit est **dans le périmètre**, et mérite un signalement :

- contournement d'authentification ou d'autorisation (pare-feu, zones, `@IsGranted`, rôles) ;
- fuite d'une session, d'un jeton, d'une clé d'API, ou franchissement d'isolation entre deux
  requêtes, deux sessions, deux connexions temps réel ou deux locataires (multi-tenant) ;
- injection (SQL, commande, traversée de chemin, prototype), y compris via un identifiant de canal
  temps réel ou un paramètre de route ;
- désérialisation, téléversement de fichier ou rendu de gabarit menant à une exécution de code ;
- déni de service **déclenchable par un anonyme à faible coût** (une trame malformée qui fait tomber
  le processus, une fuite de mémoire non bornée) ;
- non-respect d'une norme dont découle un contrôle de sécurité (RFC HTTP/1.1, HTTP/2, WebSocket,
  cookies, CORS) ;
- **secret imprimé dans les journaux** ou renvoyé dans une réponse d'erreur ;
- valeur par défaut du framework dangereuse pour une application qui ne l'a pas surchargée.

## Dépendances tierces

Une faille dans une bibliothèque tierce se signale **en amont**, chez elle. Écrivez-nous tout de même
si Nodefony l'expose d'une façon particulière (version épinglée, appel qui contourne une protection
de l'amont), ou si la mise à jour demande un changement de notre côté.

## Bonne foi

Chercher et signaler des failles sur ce projet est bienvenu, tant que vous vous en tenez à **vos
propres installations** : pas de test sur une instance qui ne vous appartient pas, pas d'accès à des
données d'autrui, pas de dégradation de service, et le canal privé le temps du correctif. Un rapport
fait dans cet esprit ne donnera jamais lieu à une plainte de notre part.
