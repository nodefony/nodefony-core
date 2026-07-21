# Pièges du banc multi-pods

Chacun a coûté un faux diagnostic. Le symptôme est donné avant la cause : c'est par lui
qu'on le reconnaîtra la prochaine fois.

## Lancement

**Le pod précédent disparaît quand j'en lance un second.**
Le `DevSupervisor` est single-instance par racine d'application : `nodefony development` lancé
deux fois depuis le même dossier évince l'instance en place (« superviseur actif (pid …) »).
Pour N pods, utiliser `nodefony production` — pas de superviseur, et c'est de toute façon le
mode qui ressemble au déploiement réel.

**Le serveur meurt dès que la commande shell se termine.**
Un `&` nu laisse le processus attaché au terminal : il prend un SIGHUP. Lancer
`nohup … > log 2>&1 < /dev/null & disown`.

**`pkill -f "NF_POD_NAME=A1"` ne tue rien, et le port reste pris.**
Une variable d'environnement n'apparaît pas dans la ligne de commande — le motif ne matche
jamais. Conséquence vicieuse : on croit avoir redémarré, le nouveau processus n'obtient pas
le port, et on diagnostique sur l'ancien code (symptôme typique : une route fraîchement
ajoutée répond 404 alors que le `dist` la contient). Tuer par port :

```bash
for p in $(lsof -nP -iTCP:5171,5172 -sTCP:LISTEN -t); do kill -9 $p; done
```

**Le port est déjà pris par quelque chose du repo.**
Le repo auto-hébergé occupe 5151/5152, et un serveur Vite peut tenir 5173. Vérifier ce qui
écoute (`ps -p <pid> -o command=`) avant de tuer : un `kill` à l'aveugle sur un port arrête le
serveur de travail de quelqu'un. Réserver une plage au banc (517x / 527x).

**Le `cd` d'une commande n'a pas eu lieu.**
Le répertoire courant persiste entre les appels : un `cd tmp/bench/appalpha` depuis
`tmp/bench` échoue, et la commande suivante s'exécute ailleurs que prévu — typiquement un
`npm run build` qui rebuild le framework au lieu de l'application. Toujours des chemins
absolus dans le même appel.

## Protocole WebSocket

**Le client se connecte, reçoit le welcome, puis plus rien.**
Le handshake serveur est asynchrone : toute frame envoyée avant `realtime:welcome` est
**droppée silencieusement**. Envoyer le `subscribe` depuis le handler du welcome, jamais
depuis `open`.

**Le client ne reçoit rien mais l'action RPC répond.**
Alors les frames montent bien : le problème est en aval (politique de forward, admission
d'ingress), pas dans le transport. Discriminant utile : une requête avec `id`
(`chat:ping`) qui renvoie son `result` prouve la voie montante ; la sonde du pod récepteur
(`ingressRejectedTotal`, canaux actifs) dit ce qui a été refusé.

**La sonde annonce zéro canal actif alors que le subscribe a marché.**
Un canal est disposé au **dernier** désabonné : si la sonde est interrogée après la fermeture
du client, elle voit un hub vide. Mesurer pendant que la connexion est ouverte.

## Mesure

**La latence semble catastrophique (centaines de ms) alors que tout va bien.**
Une rafale sature la file de livraison : ce qu'on mesure est un backlog, pas un temps de
transport. Séparer les deux bancs — messages espacés pour la latence, rafale pour le débit.

**Deux chiffres qui diffèrent de 20 % ne prouvent rien.**
Prendre la médiane de plusieurs runs, et se méfier d'une résolution à la milliseconde pour un
coût qui se compte en microsecondes : pour comparer deux implémentations, un micro-benchmark
en boucle (100 000 itérations, `process.hrtime.bigint()`) est le seul instrument honnête.

**Le banc ne voit rien passer — donc la défense marche ?**
Pas nécessairement : elle peut être cassée. Tout scénario défensif exige son **contrôle
négatif** — la même attaque, sur une cible non protégée, doit réussir.
