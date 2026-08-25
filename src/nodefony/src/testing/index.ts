import { createRequire } from "node:module";
import path from "node:path";
import Container from "../Container";
import Module from "../kernel/Module";
import type Kernel from "../kernel/Kernel";
import type { DefaultOptionsService } from "../Service";

/**
 * Outillage de TEST publié — ce qu'il faut pour éprouver un service SEUL.
 *
 * ## Le problème que ce sous-chemin résout
 *
 * Un service Nodefony reçoit un `Module` (`super(nom, module.container,
 * module.notificationsCenter)`), et un `Module` réclame un `Kernel`. Éprouver
 * la logique d'un service — un calcul de taxe, une règle métier — demandait
 * donc de démarrer une application entière, ou de fabriquer soi-même un kernel
 * de fortune avec un `as unknown as Kernel` que les règles du projet
 * interdisent par ailleurs.
 *
 * Faute de cette porte, le réflexe observé est d'écrire un test de bout en bout
 * : on lance le serveur et on tape en HTTP. Il éprouve la chaîne complète, il
 * est lent, et il ne dit RIEN de l'isolation des responsabilités — la seule
 * chose qu'on voulait vérifier.
 *
 * ## Ce qu'il ne fait pas
 *
 * Ce module ne démarre aucun kernel, n'ouvre aucun port, ne lit aucune
 * configuration. Il rend un module JETABLE dont le seul rôle est de porter un
 * conteneur et un bus d'événements — ce dont un service a besoin pour exister.
 * Tout ce qui exige un kernel vivant (routes, firewall, ORM connecté) relève
 * d'un test d'intégration, et cette porte ne prétend pas le remplacer.
 *
 * ⚠️ **La résolution PAR LE CONTENEUR n'est pas de la partie**, et c'est
 * structurel : `@inject("XService")` passe par le singleton `Nodefony.getKernel()`
 * (`injector.ts:169`), qui n'existe pas ici — l'injecteur fabriquerait alors un
 * second exemplaire sans argument, et le constructeur casserait sur
 * `module.container`. Ce n'est pas une limite gênante : **un test unitaire
 * donne lui-même la dépendance**, ce que l'injection par constructeur permet
 * précisément, et c'est ce qui autorise à y glisser un double.
 *
 * ```ts
 * const app = createTestModule();
 * const invoice = new InvoiceService(app, new TaxService(app));   // ✅
 * const invoice = await app.addService(InvoiceService);           // ❌ exige un kernel
 * ```
 *
 * @module
 */

/**
 * Le chemin du lanceur `nodefony`, tel que CETTE installation l'a reçu.
 *
 * ## Pourquoi une fonction, et pas un chemin écrit à la main
 *
 * Une suite de tests qui doit démarrer l'application écrivait jusqu'ici
 * `node_modules/.bin/nodefony`. Trois choses lui donnent tort :
 *
 *  1. **Ce fichier n'existe pas sous Windows.** npm y écrit un `nodefony.cmd`,
 *     et Node refuse d'exécuter un script batch sans passer par un shell
 *     (correctif de CVE-2024-27980). Le symptôme est un `ENOENT` sur un chemin
 *     qui semble pourtant présent — il désigne le fichier SANS extension.
 *  2. **L'emplacement n'est pas garanti.** Hoisting npm, espaces de travail,
 *     pnpm et son magasin : le paquet n'est pas toujours dans le
 *     `node_modules` du dossier courant.
 *  3. **Le nom du binaire appartient au framework**, pas à ses utilisateurs.
 *     Écrit en dur chez chacun, il ne peut plus jamais changer.
 *
 * La résolution passe donc par le MANIFESTE : Node localise `nodefony` comme il
 * localiserait n'importe quel import, et le champ `bin` dit où est le lanceur.
 * Aucune extension à deviner, aucun shell à ouvrir, aucun chemin à supposer.
 *
 * ## Usage
 *
 * Le résultat se donne à `node`, jamais au système : c'est un script, pas un
 * exécutable.
 *
 * ```ts
 * import { execFileSync } from "node:child_process";
 * import { nodefonyBin } from "nodefony/testing";
 *
 * execFileSync(process.execPath, [nodefonyBin(), "production", "--detach", "--wait"]);
 * ```
 *
 * @param depuis - d'où résoudre, si ce n'est pas depuis ce module (rare).
 * @returns Le chemin ABSOLU du script de lancement.
 * @throws Si le paquet `nodefony` est introuvable depuis `depuis` — le message
 *         dit alors que c'est l'INSTALLATION qui manque, pas le chemin qui est
 *         faux.
 */
export function nodefonyBin(depuis: string = import.meta.url): string {
  const require = createRequire(depuis);
  let manifeste: string;
  try {
    manifeste = require.resolve("nodefony/package.json");
  } catch {
    throw new Error(
      "paquet `nodefony` introuvable depuis " +
        depuis +
        " — l'application est-elle installée (npm install) ?",
    );
  }
  const pkg = require("nodefony/package.json") as {
    bin?: string | Record<string, string>;
  };
  const bin =
    typeof pkg.bin === "string"
      ? pkg.bin
      : (pkg.bin?.nodefony ?? "bin/nodefony");
  return path.join(path.dirname(manifeste), bin);
}

/** Réglages d'un module de test — tous facultatifs. */
export interface ITestModuleOptions {
  /** Nom du module (défaut `"test"`) — n'apparaît que dans les journaux. */
  name?: string;
  /**
   * Racine du module. Doit contenir un `package.json` : `Module` le lit pour
   * se situer. Défaut `process.cwd()`, qui convient à une suite lancée depuis
   * la racine d'une application.
   */
  path?: string;
  /**
   * Options passées au module (`syslog`, `events`…).
   *
   * Rien n'est imposé par défaut : un module de test ne branche aucun
   * transport, donc son journal reste muet sans qu'on ait à l'éteindre.
   */
  options?: DefaultOptionsService;
  /**
   * Conteneur à partager. Deux services construits sur le MÊME module partagent
   * déjà le sien ; ne le passer que pour réutiliser un conteneur préparé
   * (services simulés enregistrés à la main, par exemple).
   */
  container?: Container;
}

/**
 * Un module JETABLE, prêt à porter un service dans un test.
 *
 * ```ts
 * import { createTestModule } from "nodefony/testing";
 * import TaxService from "../nodefony/service/TaxService";
 *
 * const tax = new TaxService(createTestModule());
 * expect(tax.rate()).toBe(0.2);
 * ```
 *
 * Deux services qui doivent se voir prennent le MÊME module : ils partagent
 * alors son conteneur, et `container.get("…")` résout comme à l'exécution.
 *
 * ```ts
 * const app = createTestModule();
 * const tax = new TaxService(app);
 * const invoice = new InvoiceService(app, tax);
 * ```
 *
 * @param settings - réglages facultatifs (cf {@link ITestModuleOptions}).
 * @returns un module utilisable comme argument de constructeur d'un service.
 */
export function createTestModule(settings: ITestModuleOptions = {}): Module {
  const container = settings.container ?? new Container();
  // 🔴 LE cast vit ICI, et nulle part ailleurs. `Module` ne lit que
  // `kernel.container` de son kernel (`Module.ts:125`) ; construire un vrai
  // `Kernel` pour un test coûterait un inventaire des interfaces réseau et un
  // injecteur, sans rien apporter. L'encapsuler est tout l'intérêt de cette
  // porte : sans elle, c'est l'UTILISATEUR qui écrit ce cast dans son test —
  // et il l'écrit sans savoir que seul `container` est lu.
  const kernel = { container } as unknown as Kernel;
  return new Module(
    settings.name ?? "test",
    kernel,
    settings.path ?? process.cwd(),
    settings.options ?? {},
  );
}
