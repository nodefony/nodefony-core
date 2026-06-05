---
title: Nodefony Workspace — bureau d'observabilité composable
module: "@nodefony/studio"
audience: dev
status: draft
version: 0.1.0
---

# Nodefony Workspace — le bureau composable par métier

> Cahier des charges figé (Lot 0). Successeur des dashboards **codés en dur**
> (`auth/dashboards.ts` : 1 rôle → 1 page). Le métier ne se code plus, il se
> **compose**.

## 1. Pourquoi (le problème)

Aujourd'hui Studio a :

- des pages d'observabilité **figées** (`Runtime` = 100 % pédagogique, 0 live ;
  `DashboardSupervision`, `Cluster`, `OrmOverview`…) qui **recopient à la main** le
  même patron « sonde back + abonnement hub » ;
- des dashboards métier **en dur** : `DASHBOARDS` mappe `ROLE_DEV → /dev`,
  `ROLE_SUPERVISOR → /supervision`. L'utilisateur **ne compose rien**.

Le différenciateur n'est pas « une page de plus » : c'est de voir que **chaque sonde
déjà écrite** (CPU, heap, event-loop, santé, logs, ORM, hub realtime…) est un
**widget réutilisable**. Le bureau de travail (dev / admin / superviseur / autre) se
**compose** depuis un catalogue, comme on pose les apps qu'on veut sur une tablette.

## 2. Le design pattern source = la console Logs (Backplane)

Le « pattern de log » (page `routes/logs/*`) est la matrice. Ses 4 invariants :

1. **Axes nommés + bandeau auto-explicatif** (expliquer AVANT la donnée).
2. **Onglets de 1er niveau = les facettes**.
3. **Sonde back + abonnement hub** : endpoint `/health` (snapshot) + ticker realtime
   (live), switch opt-in **ref-compté**, fallback HTTP one-shot.
4. **Divulgation progressive + temps réel calme**.

Le Workspace **encode ce pattern une seule fois** (dans `WidgetHost`) → toute sonde
nouvelle devient une tuile sans recopier le pattern.

## 3. Architecture — 3 couches

### a) Le contrat widget (`workspace/types.ts`)

```ts
interface IWidgetDef<T> {
  id: string; // "runtime.mode", "system.cpu", "orm.health"
  title;
  description;
  category;
  icon;
  roles?: string[]; // catalogue filtré par métier ; vide = tous
  source: // ← le pattern Logs encodé une fois
    | { kind: "snapshot"; endpoint } // HTTP one-shot
    | { kind: "live"; channel } // realtime
    | { kind: "hybrid"; endpoint; channel }; // snapshot + live (le patron)
  clusterAware?: boolean; // le rendu change en cluster (cf §4)
  defaultSpan;
  minSpan; // colonnes (1-12)
  render: ComponentType<WidgetRenderProps<T>>;
}
```

Le **shell** (`WidgetHost`) gère pour TOUS les widgets : snapshot 1er paint,
abonnement live **conditionnel** (monté seulement quand `live` ON → unsubscribe auto
ref-compté), fallback, `DataState`, `contain: content`. Le widget = **rendu pur**.

### b) Le catalogue (`workspace/registry.ts`)

`registerWidget(def)` / `listWidgets(roles)` — le « magasin d'apps », filtré
`category` + `roles`.

### c) Le bureau (`workspace/WorkspaceStore.ts`, MobX)

Layout = `WidgetInstance[]` (`{ widgetId, span }`) **par bureau**, persisté
`localStorage` (`nf.workspace.*`) → data plane par-utilisateur en P6. Actions :
`addWidget` / `removeWidget` / `setSpan` / `move` / `setActive` / `resetToPreset`.
Défensif : un `widgetId` absent du registry est ignoré au rendu (pas de crash).

## 4. La vue CLUSTER > 1 (le point dur — décision figée)

**Piège** (retex) : en cluster le WS tombe sur **1 worker** (round-robin
`reusePort`) → tout endpoint per-worker **ment** sur le pod.

**Décisions** :

1. **Source canonique unique = `realtime:health`** (agrégée par le **master** via
   IPC : `instances[]` = tous les workers, `totals` = agrégat). Tout widget
   cluster-aware s'y branche. **Jamais** `dashboard:stats` (per-instance) ni un
   endpoint round-robin pour une vue pod.
2. **`normalize()` (`utils/realtimeHealth.ts`) efface mono/cluster** → `{ instances[],
totals }`. Mono = 1 instance. Le widget a **UN seul code**.
3. **Brique de rendu partagée `<ClusterView>`** (consommée par tous les widgets
   système) :
   - **mono (`instanceCount === 1`)** → valeur simple, **0 bruit cluster**.
   - **cluster** → **résumé pod par défaut** (rollup adapté : moy/max CPU, somme
     heap, **pire worker** via `buildHealth` pour la santé) **+ grille par worker
     dépliable** (`Collapse`), chaque worker linkable vers son drill
     (`/cluster`, `/orm/:pid`).

→ bureau **lisible** en cluster (1 tuile = 1 verdict pod), détail worker à 1 clic,
agrégation dans les **utils partagés** (0 copie). **Pas de N bureaux** : un bureau,
des widgets qui se déplient. Cohérent « tablette = grille + onglets, pas window
manager ».

Le `WidgetRuntimeContext` (porté par le shell, calculé **1×**) transporte
`{ live, cluster, instanceCount, roles }` à chaque widget. Les non-cluster (routes,
modules, git, logs du process courant) l'ignorent.

## 5. Les personas = presets, pas du hard-code

`DASHBOARDS` figé → **presets de layout** (`workspace/presets.ts`) : **Développeur /
Superviseur / Admin / Vierge**. Un preset = un layout de départ ; l'utilisateur
**personnalise** ensuite. Multi-rôle = plusieurs bureaux (sélecteur). « Autre » =
bureau vierge où l'on pioche dans le catalogue.

## 6. Choix techniques tranchés (POURQUOI)

- **Pas de lib grille/DnD en deps** (juste `@tanstack/react-table`). Le retex est
  explicite : « tablette = grille + onglets, PAS un window manager ». **Lot 1 = grille
  CSS 12 colonnes + add/remove + redimensionner/déplacer au menu**. On **prouve le
  contrat** avant de payer une dep.
- **Drag-resize** = `@dnd-kit` (React 19 OK, modulaire) **en lot ultérieur**, une fois
  le contrat validé. Pas de métaphore window-manager « au cas où ».
- **Persistance** localStorage v1 → serveur P6 (symétrie `UiStore`).

## 7. Plan en lots

| Lot | Contenu                                                                                                                   | État |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ---- |
| 0   | Cahier des charges figé (ce doc + mémoire graine)                                                                         | ✅   |
| 1   | `types` + `registry` + `WorkspaceStore` + `ClusterView` + `WidgetHost` + grille + catalogue + route `/nodefony/workspace` | —    |
| 2   | 6-8 widgets extraits des pages existantes (runtime/system/orm/logs/realtime)                                              | —    |
| 3   | Presets personas + sélecteur de bureaux + drag-resize (`@dnd-kit`)                                                        | —    |
| 4   | **Runtime refondu** en console-pattern (axes + flux lifecycle `syslog:stream`)                                            | —    |
| 5   | Persistance serveur (P6)                                                                                                  | —    |

## 8. Intégration (additif, sans rien casser)

Nouvelle route mono-segment `/nodefony/workspace` (fallback SPA existant, 0 backend) +
entrée nav (groupe Overview) + `RootStore.workspace`. Les dashboards `Dev`/`Supervision`
existants **restent** ; ils seront migrés vers le bureau en Lot 4.

## 9. Charte de mouvement — temps réel CALME (NON négociable)

> S'applique à TOUT widget live ET au mode héros « Jumeau Vivant ». Réconcilie
> « vivant » et l'ergonomie anti-clignotement (skill `nodefony-studio-dev` §« Temps
> réel CALME », `feedback_studio_realtime_calm`). Principe directeur :

**Le mouvement est ISOMORPHE à l'activité réelle du serveur — jamais décoratif, jamais
périodique pour faire joli.** Serveur au repos → jumeau immobile. Une particule
n'apparaît **que** sur une vraie requête ; un arc ne pulse **que** sur un vrai fan-out.
_Le temps réel parfait est invisible tant qu'il ne se passe rien._

1. **Glisser, pas clignoter** — particules/flux = `transform`/`opacity` **compositor-only**,
   continu. Interdits : `filled↔light`, glow `box-shadow` qui bat, couleur qui flippe au tick.
2. **Amorti, lent** — respiration de cellule = `opacity` ~2,5 s. Un état (rouge = lag)
   **s'installe et reste** par transition douce tant qu'il dure ; jamais un flash répété.
3. **Borné + coalescé** — 1 particule = N requêtes (coalescing) ; cadence plafonnée (AIMD,
   `ui.adaptiveCadence`) ; **drop** au-delà du budget. Jamais de flood (perf + GC + scintillement).
4. **Centre fluide, périphérie statique** — mouvement seulement sur le canevas regardé ; chips/
   panneaux/topbar = statiques (`tabular-nums`, variant stable). Le scintillement périphérique
   involontaire est l'ennemi (vision périphérique = détection subie).
5. **`prefers-reduced-motion` → jumeau figé** — 0 particule/respiration → carte d'état colorée
   statique (mêmes infos). a11y obligatoire, pas une option.
6. **Contrôle utilisateur (WCAG 2.2.2)** — switch Live (`ui.realtimeLive`), granularité, et le
   **scrubber** = pause/stop natif (figer pour lire).
7. **Perf rendu** — SVG/Canvas, `contain`, `content-visibility` hors-champ, GPU. **Gate = test des
   30 s au repos** : rien ne doit attirer l'œil sans cause.

Le Jumeau n'est pas « animé », il est **réactif** : calme par défaut, expressif uniquement sur
événement réel, amorti, borné, coupé sous _reduced-motion_.
