---
name: nodefony-add-realtime-presence
metadata:
  version: 1.0.0
description: >
  Affiche qui est là sur un canal temps réel Nodefony — qui est en ligne dans un salon, combien de
  spectateurs, dans combien d'onglets — par l'option de présence que le framework tient lui-même,
  au lieu d'une liste de connectés écrite à la main qui ment dès deux serveurs. Mène de la ligne
  à déclarer à l'écran (React, Vue, Angular, Svelte) et à son test, et porte ce qui ne se voit
  qu'en production : plusieurs serveurs, rechargement de page, redéploiement, salon de mille
  personnes. À charger AVANT d'écrire une liste de présents, un compteur de spectateurs ou un
  indicateur « en ligne ». Le canal lui-même (le créer, le protéger) relève de
  `nodefony-add-realtime-channel`.
  Déclencheurs : "qui est en ligne ?", "afficher les connectés", "liste des présents",
  "combien de spectateurs", "indicateur en ligne", "statut en ligne", "Untel est en train
  d'écrire", "la liste clignote quand je recharge", "les présents ne sont pas les mêmes sur deux
  serveurs", "présence", "presence", "onPresence", "useNodefonyPresence".
---

# add-realtime-presence — qui est là, sans rien tenir soi-même

> 🧭 **Arrivé ici directement ? Charge aussi `nodefony-dev`** (la conduite commune) et
> `nodefony-add-realtime-channel` (le canal qui porte la présence). Cette page ne couvre QUE la
> présence.
>
> Les pages de référence sont INSTALLÉES. Une commande les trouve — **exécute-la, puis lis la page** :
>
> ```bash
> node node_modules/@nodefony/devkit/skills/nodefony-dev/scripts/docs.mjs --open cookbook-chat
> ```
>
> La présence y est l'**étape 3** (« présence et frappe en cours »), le passage à plusieurs serveurs
> l'**étape 7**. Exemple exécuté : `cas-d-usage.md`, cas `chatPresence`.

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.
> Chaque bloc de code ci-dessous est un EXTRAIT d'un fichier exécuté par la suite du framework
> (marqueur `excerpt`) : un test refuse qu'il en diverge.

## 1. Quand m'utiliser — et quand ce n'est pas de la présence

| Tu veux…                                                  | C'est…                                                                   | Où                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------- |
| savoir qui est dans le salon, combien, dans quels onglets | **la présence** — une option du canal                                    | ici                             |
| « Untel est en train d'écrire »                           | un **message éphémère** du canal, PAS la présence (§5)                   | ici, §5                         |
| savoir si un message a été lu                             | une donnée de l'application (base + route), pas la présence              | `nodefony-add-crud`             |
| qui a le droit d'entrer                                   | la **politique** du canal (`allow`, `roles`) — la présence ne garde rien | `nodefony-add-realtime-channel` |
| les inscrits d'un salon (même absents)                    | une table de l'application ; la présence ne connaît que les connectés    | `nodefony-add-crud`             |
| prévenir une personne précise                             | `publishToUser` (canal personnel)                                        | `nodefony-add-realtime-channel` |

**N'écris jamais de liste de connectés à la main** (un `Set` rempli à l'abonnement, publié toutes
les N secondes) : chaque serveur ne connaît que SES connexions — derrière `nodefony cluster -w 2`
ou deux pods, chacun publie sa liste et écrase celle de l'autre, et les départs arrivent avec N
secondes de retard. Celle du framework est tenue entre les serveurs, groupée par fenêtre de 250 ms,
sans minuteur par présent.

## 2. La ligne — une option de la politique du canal

Être abonné, c'est être présent. La présence se déclare **sur le canal lui-même** :

<!-- excerpt: chatPresence.ts -->

```ts
  // La présence est portée PAR le canal : être abonné, c'est être présent. Ni
  // minuteur, ni liste à tenir, ni second canal — et elle reste juste quand
  // l'application tourne sur plusieurs pods (étape 7).
  @RealtimeChannel(ROOM_CHANNEL, { presence: true })
  room(): () => void {
    return () => {};
  }
```

Le framework tient la liste, l'envoie ENTIÈRE à chaque abonné qui arrive, puis n'envoie que les
changements. Une connexion fermée sort de la liste aussitôt (au plus une fenêtre de 250 ms).

Avec une **famille de salons privés** et une **grâce** — la forme du chat de la démo :

<!-- excerpt: demo/server/nodefony/controllers/ChatController.ts.tpl -->

```ts
  @RealtimeChannel(ROOM_CHANNEL_PATTERN, {
    allow: RoomAdmission,
    anonymous: true,
    presence: { grace: PRESENCE_GRACE_MS },
  })
  room(): () => void {
    return () => {};
  }
```

La présence suit l'**admission** : seul un abonné admis par `allow` figure dans la liste. Elle ne
remplace donc jamais la politique — un canal à présence sans politique montre ses présents à tout
le monde.

| Option     | Défaut | Effet                                                                                                                                                         |
| ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `true`     | —      | présence exacte : un départ est annoncé tout de suite                                                                                                         |
| `grace`    | `0`    | ms d'attente avant d'annoncer un départ ; annulé si la même identité revient (rechargement de page, redéploiement). Un chat : quelques secondes. Un jeu : `0` |
| `maxNamed` | `1000` | au-delà, la trame vers le navigateur ne porte plus que les NOMBRES ; la liste revient sous `maxNamed − maxNamed/10` (pas de bascule en boucle à 999 ↔ 1000)   |

Toute autre clé refuse le démarrage. `presence` est refusée sur un canal de la plateforme
(`nodefony:`) et sur la politique d'une **écriture** (`@RealtimeInbound`) : elle n'y a pas de sens.

## 3. Lire côté navigateur

`onPresence` rappelle l'écran avec **la vue entière** à chaque changement : rien à fusionner soi-même.

<!-- excerpt: chatPresence.client.ts -->

```ts
/** Qui est là : rappelé à chaque changement, la vue entière à chaque fois. */
export function watchPresence(render: (line: string) => void): () => void {
  const off = socket.onPresence(ROOM, (p) => {
    if (!p.ready) return; // « pas encore reçu » n'est pas « vide »
    const names = [...p.members.keys()].join(", ");
    const total = p.count + p.unnamed; // nommés (comptes) + connexions anonymes
    render(`${total} présent(s)${names === "" ? "" : ` : ${names}`}`);
  });
  socket.subscribe(ROOM);
  return () => {
    off();
    socket.unsubscribe(ROOM);
  };
}
```

| Champ     | Ce qu'il dit                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| `ready`   | `false` tant que la première liste n'est pas arrivée — n'affiche pas « personne » avant                     |
| `count`   | présents **nommés** : un par compte, quel que soit son nombre d'onglets                                     |
| `unnamed` | connexions comptées **sans nom** : anonymes, appelants machine sans compte                                  |
| `members` | `Map` identité → `{ tabs }` : qui, et dans combien d'onglets                                                |
| `partial` | `true` quand la vue est figée ou incomplète (socket coupée, serveur injoignable) : grise-la, ne la vide pas |

La présence s'abonne avec le canal : sans `subscribe`, aucune trame n'arrive. Avant la première,
l'instantané vaut `EMPTY_PRESENCE` (`nodefony/client`), `ready: false`.

| Vue        | Liaison                                                                                             | Import             |
| ---------- | --------------------------------------------------------------------------------------------------- | ------------------ |
| React      | `useNodefonyPresence(socket, "canal")`, ou `useNodefonyPresence("canal")` sous `<NodefonyProvider>` | `nodefony/react`   |
| Vue        | `useNodefonyPresence(socket, "canal")`                                                              | `nodefony/vue`     |
| Angular    | `injectNodefonyPresence(socket, "canal")`                                                           | `nodefony/angular` |
| Svelte     | `nodefonyPresence(socket, "canal")`                                                                 | `nodefony/svelte`  |
| sans cadre | `socket.onPresence(canal, h)`, `socket.presence(canal)`, socle `observePresence`                    | `nodefony/client`  |

Chaque liaison rend le même instantané et se désabonne au démontage du composant.

**La présence donne des IDENTITÉS, jamais des noms affichables.** L'écran résout identité → nom par
une route de l'application. Le chat de la démo appelle son annuaire à chaque changement :

<!-- excerpt: demo/front/frontend/src/chat/useChat.ts.tpl -->

```ts
      // Qui est là : la vue du salon, puis les noms demandés à l'annuaire.
      socket.onPresence(channel, (snapshot) => {
        setPresence(snapshot);
        roster.observe(snapshot.members, snapshot.partial, Date.now());
        draw();
        askNames();
      }),
```

Se retirer soi-même de la liste : filtrer sur l'identité de l'onglet (`socket.onIdentity`).

## 4. Qui est nommé — ce que le serveur a vérifié, jamais ce que le client affirme

- **Nommé = un compte** (identité `account === true`). Un anonyme et un appelant machine sans
  compte sont comptés dans `unnamed`, jamais nommés : la présence ne publie ni fournisseur
  d'identité, ni sujet externe.
- Un pseudo envoyé par le client (« je suis Alice ») ne nomme personne. Sur une application sans
  connexion, tout le monde est `unnamed` — c'est attendu, pas un défaut.
- Un compte dans trois onglets compte **une** fois, avec `tabs: 3`.
- **La présence PUBLIE les identifiants de compte à tout abonné admis**, anonymes compris sur un
  salon public : l'identifiant d'un compte ne doit donc jamais être une donnée personnelle (adresse
  électronique, login réattribuable). Reconnais « soi » par cet identifiant (`socket.onIdentity`),
  pas par un nom affiché.

Le test qui le prouve lit la présence côté serveur :

<!-- excerpt: chatPresence.test.ts -->

```ts
it("se déclarer « bob » ne nomme personne : seul un compte est nommé", async () => {
  const guest = await connect();
  await guest.subscribe(ROOM_CHANNEL);
  await guest.notify("chat:typing", { author: "bob" });
  await flush();
  expect(getRealtimeHub().presence(ROOM_CHANNEL)).toMatchObject({
    count: 0,
    unnamed: 1,
  });
});
```

## 5. « En train d'écrire » n'est PAS de la présence

Un état de présence DURE ; la frappe est un **message éphémère du canal**, que chacun reçoit parce
qu'il y est abonné, et que l'écran efface seul. La faire passer par la présence renverrait la liste
entière à tout le salon à chaque frappe. Le service de la démo publie la frappe sur le canal du
salon — elle suit donc ses droits, et un salon privé ne fuit pas sa frappe :

<!-- excerpt: demo/server/nodefony/service/ChatService.ts.tpl -->

```ts
  /**
   * « Untel écrit… » dans un salon : un message ÉPHÉMÈRE du canal, ni gardé ni
   * compté — il suit donc les droits du salon (un salon privé ne fuit pas sa
   * frappe), ce qu'un canal de frappe commun à tous ne ferait pas.
   */
  typing(roomId: string, author: string): void {
    publishFrame(roomId, { kind: "typing", author });
  }
```

Côté navigateur, envoie le signal au plus toutes les deux secondes, et efface l'indication ~3 s
après la dernière réception. Le geste qui le PORTE jusqu'au serveur — une route (contrôle
d'admission par salon, comme la démo) ou une entrée de canal (`@RealtimeInbound`, comme le
cookbook) — se choisit par la règle « route ou entrée ? » de `nodefony-add-realtime-channel`.

## 6. Lire côté serveur — l'observateur qui ne figure pas

`getRealtimeHub().presence(canal)` rend `{ count, unnamed, members, partial }` telle que CE serveur
la connaît (présents des autres serveurs compris), ou `null` si la politique du canal ne déclare pas
la présence. Une copie à chaque appel : chemin froid, pas une boucle de jeu. C'est la voie d'un
modérateur ou d'un tableau de bord qui lit sans apparaître dans la liste, et celle d'un test (§4 en montre un).

## 7. Plusieurs serveurs — UNE condition, puis rien à écrire

🔴 **La présence ne traverse les serveurs que si le canal est DIFFUSÉ** : `@RealtimeBroadcast("chat:")`
sur la classe du contrôleur, et un bus (`backplane.driver: "cluster"` sur une machine, `"redis"`
entre pods). Sans la déclaration, chaque serveur ne voit QUE ses propres présents — la liste diffère
selon le serveur où tombe l'onglet, sans une erreur. Le préfixe diffusé couvre aussi les messages
et la frappe du canal.

Ensuite, rien à écrire : la liste entière part aux nouveaux venus, les changements entre serveurs
sont groupés, un serveur gelé ou coupé du bus est oublié puis réparé, et une vue incomplète arrive
avec `partial: true`.

| Situation                                                     | Ce qui se passe                                                                                                                                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| page rechargée                                                | départ puis retour : invisible avec `grace`, un clignotement sans                                                                                                                         |
| seul utilisateur d'un serveur qui recharge                    | la présence reste servie aux autres pendant `grace` : pas de clignotement chez eux                                                                                                        |
| redéploiement (arrêt propre du serveur)                       | le serveur annonce son départ : ses présents disparaissent chez les autres dans la fenêtre, sans attendre l'oubli ; les clients reconnectés ailleurs reviennent, `grace` lisse le passage |
| bus fourni par l'application (`realtimeBackplane`)            | la fin est émise, mais arrêter CE bus reste à l'application : `shutdownRealtime` (`@nodefony/realtime`)                                                                                   |
| deux déploiements de la même application sur un Redis partagé | `backplane.namespace` distinct, sinon les présences se mélangent                                                                                                                          |

## 8. Ce que la présence coûte — et ne coûte pas

- **Un canal sans `presence` ne coûte rien** : ni message, ni minuteur, ni structure.
- Au plus **5 trames de présence par seconde** par client et par canal (fenêtre de 250 ms).
- Le bus au repos est indépendant du nombre de canaux (une preuve de vie par serveur, ~260 octets).
- Mesuré au banc du framework : ~1,8 Ko/s par client pour un salon de 1 000 membres et 30
  mouvements par seconde ; ~75 octets de mémoire par présent d'un autre serveur.
- Un salon de spectateurs (des milliers) : garde le défaut `maxNamed`, affiche `count + unnamed`.

## 9. Ce que la présence n'est PAS — ne lui fais pas porter ça

- **Pas une autorisation** : elle montre qui a été admis, c'est `allow` / `roles` qui admettent.
- **Pas instantanée** : cohérente à une fenêtre près, réparée par resynchronisation. N'en déduis
  jamais un droit (« il est présent, donc je lui envoie le secret »).
- **Pas un état** : en 10.0, aucun état (micro, caméra, absent) ne se pose sur un présent ; le
  champ `states` est réservé à un ajout futur. Un état applicatif passe par un message du canal.
- **Pas la raison d'un départ** : quitté, exclu, panne — non publié. L'exclusion se lit côté
  exclu (`realtime:closed { reason: "evicted" }`).
- **Pas les membres d'un salon** : `members` désigne les connectés. Les inscrits vivent en base.

## 10. Prouver

Le harnais de `@nodefony/realtime/testing` joue des connexions réelles contre le contrôleur ; le
test lit ce que **l'écran** de chacune afficherait, avec la même vue que le navigateur
(`PresenceView`, `isPresenceFrame` de `nodefony`) :

<!-- excerpt: chatPresence.test.ts -->

```ts
/** Ce que l'écran de cette connexion affiche : ses trames de présence, appliquées comme le fait le navigateur. */
function screenOf(h: IRealtimeHarness<ChatController>): IPresenceSnapshot {
  const view = new PresenceView(ROOM_CHANNEL);
  for (const frame of h.received) {
    if (
      frame.method === REALTIME_PRESENCE_METHOD &&
      isPresenceFrame(frame.params)
    )
      view.apply(frame.params);
  }
  return view.snapshot();
}

/** Attendre un FAIT, borné : les changements partent groupés, par fenêtre de 250 ms. */
async function until(fact: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !fact(); i++)
    await new Promise((r) => setTimeout(r, 25));
  expect(fact()).toBe(true);
}
```

- **Attends un fait, jamais une durée** : `until(() => screenOf(alice).members.has("bob"))`, pas un
  `setTimeout(300)` — les changements partent par fenêtre, une durée fixe rend le test instable.
- Prouve le **départ** (connexion fermée → absent chez le serveur PUIS sur l'écran des autres) et
  l'**anonyme compté sans nom** — le test complet est dans `cas-d-usage.md`, cas `chatPresence`.
- **Vois-le rouge une fois** : retire `presence` de la politique, `screenOf(...).ready` reste `false`.
- Plusieurs serveurs ne se prouvent pas avec un seul processus : deux onglets sur un serveur ne
  disent rien de la diffusion. `cookbook-chat.md` étape 7 donne le montage.

## 11. Voisins

| Besoin                                                        | Skill                           |
| ------------------------------------------------------------- | ------------------------------- |
| Créer, protéger, diffuser le canal ; route ou entrée de canal | `nodefony-add-realtime-channel` |
| La table des inscrits, l'annuaire des noms                    | `nodefony-add-crud`             |
| Voir l'écran, lire les trames depuis la page                  | `nodefony-browser`              |
| La liste ne bouge plus, un serveur ne voit pas les autres     | `nodefony-troubleshoot`         |
