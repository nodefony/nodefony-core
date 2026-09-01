---
title: "Éprouver une application — le harnais livré avec le framework"
navTitle: Tests
lang: fr
module: "@nodefony/core"
topic: testing
coverageModule: nodefony-core
coveragePackage: "nodefony (cœur)"
coverageFiles: "testing/index.ts"
section: "Cœur runtime"
audience: [developer]
tags: [tests, e2e, testing, harnais, vitest, unitaire, integration]
version: "doc"
status: stable
updated: 2026-09-01
source: "src/nodefony/docs/testing.md"
---

# Éprouver une application Nodefony

> Une application créée par `nodefony create app` naît avec des tests qui marchent : un harnais
> qui démarre le serveur une fois pour toute la suite, l'arrête à la fin, et donne aux tests le
> moyen de savoir à qui parler. Cette page explique ce que ce harnais utilise — le sous-chemin
> `nodefony/testing` — et comment vous en écrivez un second.

📍 [Documentation](../../../docs/index.md) › [Cœur — @nodefony/core](index.md) › **Tests**

## Le modèle — trois niveaux, trois outils

Trois questions différentes, qu'il ne faut pas confondre :

| Ce que vous voulez éprouver                          | Ce qu'il vous faut                                |
| ---------------------------------------------------- | ------------------------------------------------- |
| La logique d'**un service**, seule                   | `createTestModule()` — aucun serveur, aucun port  |
| Le comportement de **l'application qui tourne**      | le harnais généré + `runningAppPort()`            |
| Ce qui ne s'observe qu'**au démarrage** d'un process | `startSpareApp()` — un exemplaire jetable, à part |

Le point commun : **rien de tout cela ne demande de fabriquer un kernel à la main**. Un service
Nodefony reçoit un `Module`, et un `Module` réclame normalement un `Kernel` — sans porte d'entrée,
éprouver un calcul de taxe obligerait à démarrer une application entière, ou à écrire un
`as unknown as Kernel` que les règles du projet interdisent. C'est ce trou que le sous-chemin
`nodefony/testing` comble.

## 🚀 Démarrage rapide

```ts
import { createTestModule, runningAppPort } from "nodefony/testing";

// 1. Un module JETABLE : il porte un conteneur et un bus d'événements, rien d'autre.
//    De quoi construire un service seul, sans démarrer quoi que ce soit.
const app = createTestModule();

// 2. Les services se donnent leurs dépendances À LA MAIN — c'est ce qui permet
//    d'y glisser un double.
class TaxService {
  rate = 0.2;
}
class InvoiceService {
  constructor(
    readonly module: typeof app,
    readonly tax: TaxService,
  ) {}
  total(ht: number): number {
    return ht * (1 + this.tax.rate);
  }
}
const invoice = new InvoiceService(app, new TaxService());
console.log(invoice.total(100)); // 120

// 3. Dans un test de bout en bout, le port ne s'écrit JAMAIS en dur :
//    il se demande à l'application qui tourne.
const port = runningAppPort();
const res = await fetch(`http://127.0.0.1:${port}/`);
console.log(res.status);
```

## Ce que le sous-chemin fournit

<!-- prettier-ignore -->
| Export | Ce qu'il fait | Quand s'en servir |
| --- | --- | --- |
| `createTestModule()` (`testing/index.ts:160`) | Rend un `Module` jetable portant un conteneur et un bus d'événements | Test unitaire d'un service |
| `runningAppPort()` (`testing/index.ts:96`) | Lit le port de l'application démarrée par le décor | Tout test de bout en bout |
| `startSpareApp()` (`testing/index.ts:251`) | Démarre un exemplaire jetable dans un état choisi, puis restaure l'état d'exécution | Éprouver un démarrage, pas un fonctionnement |
| `nodefonyBin()` (`testing/index.ts:64`) | Résout le lanceur du framework, où qu'il soit installé | Appeler une commande depuis un script |

### `createTestModule()` — et ce qu'il ne fait pas

Il ne démarre aucun kernel, n'ouvre aucun port, ne lit aucune configuration. Conséquence directe,
et qui surprend : **la résolution par le conteneur n'est pas de la partie**. `@inject("XService")`
passe par le singleton du kernel, qui n'existe pas ici.

```ts ignore
const app = createTestModule();
const invoice = new InvoiceService(app, new TaxService(app)); // ✅
const invoice = await app.addService(InvoiceService); // ❌ exige un kernel vivant
```

Ce n'est pas une limite gênante : un test unitaire **donne lui-même** la dépendance, ce qui est
précisément l'intérêt de l'injection par constructeur — et ce qui permet d'y glisser un double.

### `runningAppPort()` — pourquoi il lève plutôt que de se rabattre

Il lit l'état d'exécution publié par l'application démarrée, et **échoue franchement** s'il ne
trouve pas de port. Un port de repli ferait interroger un serveur étranger sur la même machine, et
le verdict porterait sur lui : un test vert qui n'a rien mesuré de votre code.

## Le harnais généré — `tests/e2e.setup.ts`

Chaque application créée par `nodefony create app` reçoit ce fichier. Il fait quatre choses, dans
cet ordre, **une fois pour toute la suite** :

1. **Repartir d'une base vierge.** Un verdict qui dépend de ce qu'un essai précédent a laissé n'est
   pas reproductible. Sur SQLite le fichier est supprimé — avec ses compagnons `-wal` et `-shm`,
   sans quoi la base ressuscite. Sur un moteur serveur, c'est `orm:reset` : une base ne s'efface
   pas, on retire ses tables.
2. **Appliquer le schéma avant le trafic** (`orm:migrate`). C'est le patron de production tel quel :
   en production le démarrage ne fabrique jamais le schéma, parce que plusieurs exemplaires partent
   en même temps et qu'aucun ne doit toucher aux tables.
3. **Démarrer l'application** par `production --detach --wait` : la commande ne rend la main que
   lorsque la disponibilité est constatée — aucune attente arbitraire.
4. **L'arrêter à la fin** (`stop`), sans exception : un serveur orphelin tient les ports et fait
   échouer l'essai suivant sur une erreur qui ne parle pas de lui.

Le fichier expose aussi `URL_BASE_E2E` — une base **séparée de celle du développement**, ce qui
n'est pas une coquetterie : une suite qui écrit dans la base de développement y sème un compte
`admin` dont le mot de passe est celui du fichier de test, et le couple annoncé par le README cesse
alors de fonctionner sans le moindre message. Surcharge possible par `NF_E2E_DATABASE_URL`.

> Cette variable ne change **pas le dialecte** de vos entités : elles sont écrites pour le moteur
> choisi à la création, et l'ORM refuse de démarrer sur un autre en nommant l'entité fautive.

## Écrire un second harnais — un exemplaire jetable

Certaines choses ne s'observent que sur un processus qui **démarre** dans un état précis : un
schéma en retard qui retient la mise en service, une dépendance absente, un refus de démarrage. Le
décor de la suite, lui, a démarré l'application dans l'état normal — et c'est ce qu'on veut.

```ts ignore
const jetable = await startSpareApp({
  port: 5399,
  env: { NODE_ENV: "production", NF_DATABASE_URL: "sqlite:/tmp/vierge.db" },
});
try {
  const res = await fetch(`http://127.0.0.1:${jetable.port}/readyz`);
  assert.equal(res.status, 503);
} finally {
  await jetable.stop();
}
```

Le port est **imposé, jamais deviné** : l'exemplaire du décor tient déjà celui de l'application, et
la sonde doit savoir à qui elle parle.

## 📖 Lexique

| Terme                  | Ce que c'est                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Sous-chemin**        | Une porte d'entrée secondaire d'un paquet (`nodefony/testing` à côté de `nodefony`), déclarée dans son `package.json`.            |
| **e2e**                | _End to end_ — un test qui exerce la chaîne entière, du client à la base réelle, sans rien simuler.                               |
| **Module jetable**     | Ce que rend `createTestModule()` : un porteur de conteneur et d'événements, sans kernel, sans port, sans configuration.           |
| **État d'exécution**   | Le fichier où une application publie ses ports en démarrant. C'est lui que `runningAppPort()` lit — un seul par racine de projet. |
| **Exemplaire jetable** | Un second process de la même application, sur un autre port, démarré pour observer un cas de démarrage précis.                    |

## ⚠️ Pièges

- **Deux exemplaires lancés depuis le même dossier partagent un seul état d'exécution.** Le second
  écrase les ports du premier, et `runningAppPort()` se met à désigner le jetable — puis à lever
  une fois qu'il est mort. Le défaut ne se voit pas dans le test qui l'a créé : il tombe sur le
  **suivant**, et accuse une route qui n'a rien fait. C'est pour cela que `stop()` restaure l'état
  d'avant, et pourquoi il doit être appelé dans un `finally`.
- **Un port écrit en dur casse dès que l'application déclare le sien** (`NF_PORT`, ou la variable
  qu'un hébergeur impose), ou qu'un port occupé l'a fait glisser.
- **`createTestModule()` ne résout rien par le conteneur.** Si un test échoue sur
  `module.container` au constructeur, c'est qu'une dépendance a été demandée à l'injecteur au lieu
  d'être donnée à la main.
- **Une suite lancée ailleurs qu'à la racine de l'application ne trouve pas l'état d'exécution**,
  et `runningAppPort()` lève en le disant.
- **La suite tourne en `production`**, où aucun compte n'est semé sans mot de passe explicite. Les
  routes protégées ont donc besoin de l'identité que le harnais pose lui-même — sans elle, elles
  échouent en accusant la garde plutôt que le décor.

## 🧪 Tests & couverture

Les chiffres exacts vivent dans la carte de l'aperçu, régénérée en comptant — jamais figés ici.

<!-- prettier-ignore -->
| Type | Où | Ce qui est prouvé |
| --- | --- | --- |
| Unitaires | `nodefony` `testing.test.ts` | ce que rend le module jetable, la lecture du port, la restauration de l'état d'exécution |
| Unitaires (génération) | `nodefony` `create.test.ts` | que le harnais est bien livré avec l'application créée, dans ses quatre variantes |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Cœur — @nodefony/core](index.md) ·
  [Toute la documentation](../../../docs/index.md)
- 🏗️ **Ce qui a généré ces fichiers** :
  [`generer-du-code.md`](../../../docs/guides/generer-du-code.md)
- 🗄️ **La base que la suite efface** :
  [`persistence.md`](../../../docs/guides/persistence.md)
- 🖥️ **Les commandes que le harnais appelle** : [la CLI](cli.md)
- 🏭 **Ce que la forge du framework lance, et pourquoi un saut compte comme un succès** :
  [`integration-continue.md`](../../../docs/guides/integration-continue.md)
