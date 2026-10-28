# Exemples — des tours qui ont permis à l'auteur de trancher

> Référence du skill `nodefony-step-by-step`, à relire AVANT d'écrire un tour. Ce sont des tours
> réels, sur la conception du temps réel (socle, socket, webhooks), condensés. Ce qui les rend
> efficaces : un exemple qu'on peut lire en dix secondes, un piège raconté comme une histoire,
> une recommandation dont le coût est dit, une seule question.
>
> **Maintenance** : vérité courante, jamais un journal. Remplacer un exemple par un meilleur,
> éditer en place ; historique = `git log`.

## Sommaire

1. Expliquer une notion « pour les très nuls »
2. Un tour de décision complet
3. « Explique mieux » : repartir de la question de l'auteur
4. La question de côté qui trouve un trou
5. Le « pas bis » : un défaut découvert devient un pas
6. Le tableau d'avancement
7. Contre-exemples : ce qui a fait décrocher l'auteur

---

## 1. Expliquer une notion « pour les très nuls »

Demande : « explique-moi le socle pour les très nuls, c'est structurel ». Ce qui a marché :

1. **Une histoire concrète, générique** : un traitement long produit des événements (_démarré_,
   _10 %_, _terminé_) ; quatre destinataires les veulent par quatre tuyaux : la page web par la
   socket, un script par SSE, un autre serveur par gRPC, un serveur non connecté par webhook.
2. **Les questions que chacun se pose**, numérotées, en langage courant : de quoi parle cet
   événement ? l'ai-je déjà reçu ? dans quel ordre ? qui a le droit ? j'ai perdu la connexion,
   que se passe-t-il ?
3. **Le coût de ne pas décider** : « quatre tuyaux × cinq questions = vingt réponses écrites à
   quatre endroits, qui divergent ».
4. **Ce que « structurel » veut dire ici** : décider maintenant ce qui casserait les applications
   plus tard, sans forcément coder.

Une mise en garde, venue de l'auteur : l'histoire doit être **générique**. Le premier exemple
choisi (un agent IA) a fait croire que le socle était taillé pour les agents. Prendre une
discussion, un tableau de bord, un capteur ; l'agent n'est qu'un usage parmi d'autres.

Autre notion expliquée pour les nuls : **le webhook**. « C'est le serveur qui appelle quelqu'un
quand il se passe quelque chose, comme un SMS d'alerte. » Puis trois étapes numérotées (un admin
enregistre une adresse et ce qu'il veut recevoir ; on envoie un `POST` signé ; on réessaie si
personne ne répond), et la différence avec la socket en une phrase : « personne n'a besoin de
rester connecté, c'est nous qui appelons ».

## 2. Un tour de décision complet

> **Pas 2 : le message entre deux serveurs de l'application**
>
> **La situation.** En production, l'application tourne en plusieurs exemplaires. Alice est sur
> le serveur A, Bob sur le serveur B. Quand Alice écrit dans le chat, A prévient B par un bus
> (Redis). Sur ce bus, A envoie exactement :
>
> ```json
> {
>   "channel": "chat",
>   "payload": { "text": "bonjour" },
>   "originId": "serveur-A",
>   "sceau": "…"
> }
> ```
>
> Chaque champ expliqué en une ligne (`originId` : pour que A ne se renvoie pas son propre
> message ; `sceau` : pour qu'un intrus ne puisse pas injecter de faux messages).
>
> **Le piège.** Pendant une mise à jour, A tourne en 10.0 et B en 10.1. Si la 10.1 ajoutait un
> champ signé, ils ne calculeraient plus la même signature : **chacun rejetterait les messages de
> l'autre**, Bob ne recevrait plus rien pendant la mise à jour.
>
> **Ma recommandation : figer ce message pour toute la série 10.**
>
> - Ce qu'on voudra transporter de plus ira **dans** `payload`, déjà couvert par le sceau.
> - C'est le format actuel : aucun code, on écrit la promesse.
> - Il faudra un test qui fige les octets de ce message.
>
> **On fige le message entre serveurs pour toute la série 10 ?** (oui / non / explique)

Les ingrédients : la vraie donnée, un scénario avec des prénoms et des versions, le coût
(« aucun code »), une question.

## 3. « Explique mieux » : repartir de la question de l'auteur

Question : « dans le JSON-RPC, il y a déjà un `id`, non ? ». Le tour qui a marché ne répète pas la
recommandation : il **part de la question**.

1. « Oui, mais seulement sur les questions. » Puis les deux sortes de messages, chacune avec sa
   frame réelle :
   - la question, qui attend une réponse : `{ "id": 1, "method": "subscribe", … }` → la réponse
     porte le même `id`. « Comme un numéro de ticket au guichet » ; le navigateur le choisit, il
     repart de zéro à la reconnexion, deux navigateurs ont chacun leur `id: 1` ;
   - la notification, sans réponse : `{ "method": "chat", "params": { "text": "bonjour" } }`,
     **sans `id`**, et la norme le dit (JSON-RPC 2.0 §4.1).
2. Ce que ça change : l'`id` ne peut pas servir de numéro de message ; il ne reste que deux voies,
   (a) emballer chaque message, (b) le canal met son numéro dans son propre message.
3. La même question fermée, reformulée.

## 4. La question de côté qui trouve un trou

Trois questions de l'auteur, posées en marge d'un « oui », ont chacune révélé un défaut. Le geste
commun : **vérifier au code avant de répondre**, montrer la preuve, ne pas rassurer.

| Question de l'auteur                                                                    | Vérification                                                                                       | Trouvé                                                                                  |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| « Est-ce qu'on pourra passer du binaire en Redis ? rien ne bloque ? »                   | `node -e 'JSON.stringify(new Uint8Array([1,2,255]))'` → `{"0":1,"1":2,"2":255}`                    | le bus déformait les octets sans erreur (Redis ET cluster IPC)                          |
| « Pourquoi du base64 ? on perd toute la perf, on ne peut pas passer le brut à Redis ? » | types de node-redis installé : `publish` accepte un `Buffer`, `subscribe(…, true)` rend des octets | la voie brute est possible : le base64 est écarté                                       |
| « Si un jour on est multi-tenant, il n'y aura pas un trou ? »                           | `rg tenantId` : champ accepté à la création, lu par personne                                       | un champ qui a l'air de cloisonner sans cloisonner                                      |
| « Et les canaux WebSocket n'ont pas de trou multi-tenant ? »                            | `IChannelPolicy` : connecté, rôles, scopes, rien d'autre                                           | Bob (entreprise B, même rôle) peut s'abonner à `commandes:A` ; même trou pour `user:42` |

Ce qui a rendu la réponse lisible : un tableau « la voie / comment / pour / contre » plutôt qu'un
paragraphe ; un exemple d'attaque à prénoms (« Bob demande `subscribe commandes:A`, la politique
dit oui ») ; et le remède nommé avec son ticket.

## 5. Le « pas bis » : un défaut découvert devient un pas

La question sur le binaire a ouvert un défaut. Il n'a pas été corrigé en douce : il est devenu un
pas à part, présenté au même format.

> **Pas 2 bis, un petit défaut à corriger.** Aujourd'hui, un binaire envoyé sur le bus arrive
> déformé sans prévenir ; le développeur ne le découvre qu'en production.
>
> **Ma recommandation : refuser au lieu de déformer.**
>
> - Coût : un `ArrayBuffer.isView(payload)` par publication, de l'ordre de la nanoseconde.
> - Compatibilité : passer plus tard de « refusé » à « transporté » est un ajout.
> - **Limite, dite franchement** : des octets cachés dans un objet restent déformés.
>
> **On corrige ça maintenant ?** (oui / non / explique)

Puis, après le oui : test vu rouge, correctif, suite du module, commit séparé, et ce qui n'a pas
été lancé (le gate mémoire tourne sans bus : il n'aurait pas exécuté le code modifié).

## 6. Le tableau d'avancement

Après chaque oui, quelques lignes, jamais plus :

| Pas   | Décision                                                       | État          |
| ----- | -------------------------------------------------------------- | ------------- |
| 1     | `params` tel quel, sans numéro imposé                          | ✅ dans l'ADR |
| 2     | message entre serveurs figé ; binaire brut sur un sujet séparé | ✅ dans l'ADR |
| 2 bis | binaire refusé plutôt que déformé                              | ✅ commité    |
| 3     | `*` = tout, mais seulement dans le périmètre                   | ✅ ADR + doc  |

Il dit à l'auteur que la charge **diminue**, et c'est ce qui lui permet de continuer.

## 7. Contre-exemples : ce qui a fait décrocher l'auteur

- **Le relevé complet** : « 14 décisions, dont 3 ruptures si différé, matrice de 7 faits × 4
  briques ». Juste, et intranchable. Réponse : « franchement j'ai du mal à suivre ».
- **Trois ADR d'un coup** à valider. Réponse : « je ne valide rien pour l'instant ».
- **Un socle cadré par un seul usage** (l'agent IA). Réponse : « tu casses tout le temps réel,
  il doit rester très générique ».
- **Une décision importée d'un protocole tiers** (« l'instantané puis la suite » d'A2A) présentée
  comme une règle du socle, au lieu d'une possibilité.
