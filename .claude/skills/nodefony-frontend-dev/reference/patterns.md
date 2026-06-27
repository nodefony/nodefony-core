# Patterns d'écran front (Nodefony) — framework-agnostique

Patrons de construction d'un écran qui consomme le data-plane Nodefony. Le builder Nodefony génère du
**React, Vue ou Angular** → ce document décrit le **pattern** (la machine à états, le cycle de vie, la
navigation), **pas** une implémentation d'un framework de vue donné. Les briques concrètes (composant
d'état, hooks temps réel, UI kit) du Studio React → skill `nodefony-studio-dev`.

API/contrats sous-jacents : voir `data-bff.md` (ApiClient, useResource, RBAC) et `front-quality.md`
(temps réel calme, perf, a11y, sécu).

## Sommaire

- [1. Écran data-driven : la machine à états](#1-écran-data-driven--la-machine-à-états)
- [2. Pattern LIVE : abonnement temps réel ref-compté](#2-pattern-live--abonnement-temps-réel-ref-compté)
- [3. Pattern DÉTAIL / drill : master → detail](#3-pattern-détail--drill--master--detail)
- [4. Règles transverses](#4-règles-transverses)

---

## 1. Écran data-driven : la machine à états

**Tout écran qui charge des données serveur a 4 états mutuellement exclusifs.** Ne jamais en oublier un
(le piège classique = ne traiter que `data`, et afficher une page vide/cassée pendant loading/error).

```
            ┌── error    → message + bouton « Réessayer » (relance le fetch)
fetch() ──> ├── loading  → squelette qui ÉPOUSE la page (en-tête + zones), pas un spinner centré nu
            ├── empty    → message explicite « pourquoi c'est vide » + action si pertinent
            └── data     → rendu réel
```

**Priorité d'affichage** : `error` > `loading` > `empty` > `data`. Un seul état visible à la fois.

**Cycle (pseudo-code agnostique)** :

```
state = { data: null, loading: true, error: null }

function load():
  gen = ++generation                 # jeton anti-race
  state.loading = true; state.error = null
  fetch(path)
    .then(d  => if gen == generation: state = { data: d, loading: false, error: null })
    .catch(e => if gen == generation: state = { data: null, loading: false, error: msg(e) })

onMount(load)
onUnmount(() => generation++)        # invalide la requête en vol
onParamChange(load)                  # nouveau filtre/id → recharge (et invalide l'ancienne)
```

Points non négociables (déjà fournis par `useResource` en React — cf `data-bff.md` §4) :

- **Anti-race par jeton de génération** : une réponse arrivée après démontage OU après un changement de
  paramètre est **ignorée**. Sans ça, une réponse lente et périmée écrase une plus récente.
- **`reload`** exposé : un bouton « Recharger » et la reprise après erreur réutilisent le même chemin.
- **`loading` initial true** : on est en chargement dès le montage, pas après le 1ᵉʳ tick.
- **empty ≠ error ≠ 0 ligne pendant loading** : `data=[]` après chargement = `empty` ; `data=null` +
  `loading` = squelette. Distinguer les trois.

**Squelette d'écran liste (structure, tout framework)** :

```
<EnTête titre sous-titre={`${n} élément(s)`} actions={<Recharger onClick=reload loading/>} />
<ZoneÉtat loading error empty onRetry=reload>
   <Rendu data />     # table / grille / cartes
</ZoneÉtat>
```

> Le `n` du sous-titre, les compteurs, les aides contextuelles se **dérivent des données réelles**
> (`data.length`…), jamais codés en dur (une valeur figée se périme et ment).

---

## 2. Pattern LIVE : abonnement temps réel ref-compté

Pour un écran qui reçoit un flux (logs, métriques, santé). Le temps réel Nodefony est du **pub/sub par
canal sur une socket partagée**. Le pattern, indépendant du framework de vue :

```
onMount   → subscribe(canal, onMessage)     # démarre le flux SI 1ᵉʳ abonné (ref 0→1)
onMessage → met à jour l'état local du composant
onUnmount → unsubscribe(canal, onMessage)   # coupe le flux SI dernier abonné (ref 1→0)
```

### Invariants (sources de bugs vécus si violés)

1. **Une SEULE socket par origine** (singleton partagé : la console, la barre de debug, plusieurs pages
   la partagent). On **ne crée pas** une connexion par page/composant.
2. **TOUS les consommateurs ref-comptent.** L'abonnement/désabonnement est compté : le réseau n'émet un
   `subscribe`/`unsubscribe` qu'aux **transitions 0↔1**. Conséquence : sur la socket partagée, ne JAMAIS
   émettre un `unsubscribe` brut « à la main » — il couperait le canal pour **tous** les autres
   consommateurs. Toujours passer par l'API ref-comptée.
3. **S'initialiser depuis l'état COURANT de la socket** au montage. La socket peut être **déjà** ouverte
   (un autre consommateur l'a connectée avant) → sinon on rate l'évènement « connecté » déjà passé et on
   affiche « déconnecté » à tort. Lire `socket.state` au montage, pas seulement écouter les transitions.
4. **Re-`subscribe` automatique au reconnect.** À la reconnexion, ré-abonner tous les canaux actifs
   (la lib le fait ; ne pas le réimplémenter par page).
5. **Abonnement conditionnel = montage/démontage**, pas un flag. Pour un switch « Temps réel », **monter
   le sous-composant abonné quand ON, le démonter quand OFF** (`{live && <Abonné/>}`). Un `enabled=false`
   passé à un abonnement laisserait le canal ouvert (ticker serveur inutile). Démonter = ref→0 = 0 coût.
6. **Premier paint sans flux** : pour peupler l'écran avant/quand le live est OFF, faire un **snapshot
   HTTP one-shot** (`useResource` sur l'endpoint santé) en complément du canal. Symétrie endpoint + flux.

### Coût & propreté

- 1 abonnement = potentiellement 1 listener/timer côté serveur → **démontage = désabonnement garanti**.
  Toute fuite vient d'un consommateur qui s'abonne sans se désabonner symétriquement.
- Re-render isolé : la valeur qui « tique » doit re-rendre **le moins de DOM possible** (cf
  `front-quality.md` §1 temps réel calme + §2 perf).

### Sécurité — re-négocier la socket au changement d'identité

La socket grave l'identité au **handshake** et **survit** à sa session (singleton navigateur). Donc, au
**vrai changement de compte** (logout puis login d'un **autre** compte dans le même navigateur),
**forcer un nouveau handshake** (`disconnect()` puis `connect()`) → relecture du cookie courant. Sinon
le pont (qui rejoue des appels data-plane via la socket) porterait l'**ancienne** identité = fuite de
données entre comptes. ⚠️ Ne PAS `disconnect()` au **boot** (1ʳᵉ identité / F5 = la même identité se
recharge) : cela couperait les requêtes data-plane **en vol** qui passent par le pont → page bloquée en
spinner. La règle : re-négocier **uniquement** quand l'`id` passe d'une valeur non nulle à une **autre**.

> Purger aussi les **caches de données scopés à l'utilisateur** (réponses d'endpoints admin mémorisées,
> état device-local user-scoped en `localStorage`) au vrai changement de compte — pas au boot. Aucune
> donnée d'une identité précédente ne doit survivre dans un singleton ou un poste partagé.

---

## 3. Pattern DÉTAIL / drill : master → detail

Pour passer d'une liste à la fiche d'un élément, ou forer dans une hiérarchie.

```
Liste (master)  --clic ligne-->  Détail (/ressource/:id)
                                   ├── en-tête (titre + identité de l'élément)
                                   ├── sections / onglets (un sujet par onglet, masqués si vides)
                                   └── « retour » + fil d'Ariane si forage multi-niveaux
```

Règles :

- **Deep-link / F5 robustes** : une route détail (≥2 segments, `/ressource/:id`) doit rester atteignable
  au rechargement direct. La SPA doit déclarer un **fallback littéral** par préfixe (`/ressource/:id`),
  **jamais** un catch-all générique `/:a/:b` (il masquerait les vraies routes d'autres modules). Les
  routes mono-segment sont couvertes par le fallback SPA générique du namespace réservé `/nodefony`.
- **Préserver le contexte au retour** : onglet actif + filtres de la liste persistés (sessionStorage),
  pour ne pas reperdre l'état en revenant de la fiche. Attention : un effet qui réécrit l'URL peut
  effacer un paramètre de deep-link (ex. un `?req=…`) → conserver les params existants.
- **Détail = même machine à états** que §1 : la fiche charge ses données → loading/error/empty/data.
- **Divulgation progressive** : ne pas tout déballer. Le factuel/établi d'abord ; le secondaire dans des
  onglets de **premier niveau** (jamais 2 niveaux imbriqués) ou des sections repliées ; l'aperçu→détail
  au survol (lazy). La pédagogie (explications) va dans une rubrique « Doc »/aide, pas sur l'écran factuel.
- **Forage = exact, jamais improvisé** : une vue qui prétend refléter une architecture/un enchaînement
  réel doit être bâtie sur la **source de vérité** du module (code + sa doc), pas devinée. Une donnée/un
  schéma faux trompe plus qu'il n'informe.

---

## 4. Règles transverses

- **Un écran = une machine à états explicite** (§1). Le « cas data » n'est qu'un des quatre.
- **Live = ref-compté + démontage propre + 1 socket partagée** (§2). Snapshot HTTP pour le 1ᵉʳ paint.
- **Détail = deep-link littéral + contexte préservé + divulgation progressive** (§3).
- **Aides contextuelles dynamiques** : tout contrôle non trivial (filtre, toggle, métrique) s'explique
  en clair, **interpolé depuis les données live** (`${n}`…), jamais une valeur figée.
- **Réutiliser avant de coder** : chercher la primitive existante (UI kit, composant natif du framework,
  dep déjà installée) avant de hand-roller un tableau/filtre/tri/pagination/popover.
- **Vérifier le rendu** : pas de navigateur headless (règle projet) → valider la résolution/transpilation
  (curl du transform du builder), puis **hard-reload** pour le cache, puis confirmation visuelle humaine.
