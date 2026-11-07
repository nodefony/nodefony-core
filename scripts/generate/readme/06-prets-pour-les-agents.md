## Prêt pour les agents — ce que ça veut dire ici

Une application est aujourd'hui écrite à deux mains : la personne et l'agent qu'elle pilote. Or un
agent lâché dans un projet bâti sur un framework qu'il connaît mal **invente**. Il produit du code
plausible : un CRUD écrit à la main là où un générateur existait, un import direct du driver de base
de données qui contourne la façade, une socket bas niveau là où le framework offre un canal. Ce code
compile, il passe même les tests — et il aura vieilli avant d'être relu.

La réponse de Nodefony n'est pas un assistant intégré. C'est de rendre **l'application capable de se
décrire**, pour que l'agent lise au lieu de deviner :

| Ce qui est posé                        | Ce que ça évite                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| Un **`AGENTS.md` généré** à la racine  | la convention périmée : le fichier est dérivé du projet réel, il ne peut pas mentir          |
| La **doc voyage dans les paquets npm** | l'agent qui cherche sur le web une version qui n'est pas la tienne                           |
| Un **catalogue des briques** publié    | le choix de module fait au jugé, sans savoir ce qu'un adaptateur ne couvre pas               |
| `inspect` · `check` · `env`            | la déduction depuis le code de ce que l'application fait vraiment : routes, services, config |
| Des générateurs **pilotables en JSON** | l'imitation d'un fichier d'exemple, au lieu d'appeler l'outil qui produit le vrai code       |
| Un **graphe symbolique** du code       | la fouille par `grep` : qui étend quoi, qui implémente quoi, en une lecture                  |

Le standard retenu — [`AGENTS.md`](https://agents.md) — est celui que lisent la plupart des outils
de codage, avec la règle « le plus proche gagne ». Rien n'est propriétaire : le fichier est un
index, court par construction, qui **pointe** vers la documentation installée plutôt que de la
recopier.

<details>
<summary><b>Et surtout : c'est mesuré</b> — un banc de découvrabilité, pas une intention</summary>

Une application témoin est générée, puis un agent y reçoit des tâches réelles : « ajoute un CRUD
produit », « protège une route », « écris une commande CLI », « configure l'application par
l'environnement », « choisis la brique adaptée à ce besoin ». Le harnais lit ensuite le transcript
et le code produit, et répond à une seule question : **l'agent a-t-il lu, ou deviné ?**

La métrique n'est pas « le code marche » — il marche souvent, c'est bien le piège. C'est : a-t-il
lancé le générateur ? ouvert le catalogue ? interrogé la configuration effective plutôt que de la
supposer ? Le banc n'est pas entièrement vert aujourd'hui, et chaque échec désigne un endroit précis
où l'application ne se rend pas assez évidente. C'est exactement à ça qu'il sert.

</details>

Ce que Nodefony revendique n'est pas d'écrire un `AGENTS.md` — n'importe quel projet peut le
faire — mais de traiter la découvrabilité comme une propriété **mesurée** : le banc ci-dessus est
rejouable, et ses échecs sont publics. C'est cette place-là que le framework occupe délibérément.
