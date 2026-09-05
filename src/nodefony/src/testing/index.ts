import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import Container from "../Container";
import Module from "../kernel/Module";
import type Kernel from "../kernel/Kernel";
import type { DefaultOptionsService } from "../Service";
import { nodefonyBin } from "../cli/nodefonyBin";
import {
  readRuntimeState,
  readinessStateFile,
  runtimeStateFile,
  signalProcessGroup,
} from "../service/dev/devProcess";

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

// `nodefonyBin` vit désormais au CŒUR (`nodefony`), et non plus ici : elle
// résout le LANCEUR du framework, ce dont un shim de création d'application ou
// un script de déploiement ont autant besoin qu'un banc. Rangée sous le seul
// sous-chemin « testing », elle était inatteignable pour son usage principal.
// Ré-exportée ici : les suites qui l'importent de `nodefony/testing` ne bougent pas.
export { nodefonyBin } from "../cli/nodefonyBin";

/**
 * Port de l'application DÉMARRÉE, ou une erreur qui dit pourquoi on l'ignore.
 *
 * ## Pourquoi ce n'est pas `?? 5151`
 *
 * Un port de repli semble anodin — il ne l'est pas. Quand l'état d'exécution
 * est illisible (l'application n'a pas démarré, elle a démarré ailleurs, le
 * répertoire courant n'est pas sa racine), le repli envoie la suite interroger
 * **le premier serveur qui traîne sur cette machine**. Constaté : un serveur de
 * développement laissé ouvert par un autre projet a répondu `404` à tous les
 * cas, et la suite a accusé les routes de l'application au lieu de son décor.
 *
 * Un test qui parle au mauvais serveur ne se contente pas d'échouer : il rend
 * un verdict FAUX, et on cherche le défaut dans le code mesuré.
 *
 * Le port ne se devine donc pas. Il se lit — ou la suite s'arrête en disant
 * quoi vérifier.
 *
 * ```ts
 * import { runningAppPort } from "nodefony/testing";
 *
 * const res = await fetch(`http://127.0.0.1:${runningAppPort()}/api/hello`);
 * ```
 *
 * @param root - racine de l'application ; le répertoire courant par défaut,
 *   ce qui convient à une suite lancée depuis la racine du projet.
 * @returns le premier port sur lequel l'application écoute.
 * @throws Quand aucun état d'exécution n'est lisible, ou qu'il n'annonce aucun
 *   port — jamais un repli silencieux.
 */
export function runningAppPort(root: string = process.cwd()): number {
  const state = readRuntimeState(root);
  const port = state?.ports?.[0];
  if (typeof port !== "number") {
    throw new Error(
      `aucune application Nodefony démarrée sous « ${root} » : ` +
        `l'état d'exécution est illisible ou n'annonce aucun port. ` +
        `Vérifie que le décor a bien lancé « nodefony production --detach --wait », ` +
        `et que la suite tourne depuis la racine de l'application. ` +
        `(Un port de repli ferait interroger un serveur ÉTRANGER, et le ` +
        `verdict porterait sur lui.)`,
    );
  }
  return port;
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

/** Réglages d'un exemplaire JETABLE — le port est le seul obligatoire. */
export interface ISpareAppOptions {
  /**
   * Port HTTP de l'exemplaire — **imposé, jamais deviné**.
   *
   * L'exemplaire déjà démarré par le décor tient le port de l'application ;
   * celui-ci doit en prendre un autre, et la sonde doit savoir à qui elle
   * parle. Un port découvert après coup ferait retomber le test sur le premier
   * serveur venu, exactement ce que {@link runningAppPort} refuse de faire.
   */
  port: number;
  /** Port HTTPS, quand la configuration en ouvre un — même raison. */
  httpsPort?: number;
  /** Variables ajoutées à l'environnement de l'exemplaire. */
  env?: NodeJS.ProcessEnv;
  /** Racine de l'application ; le répertoire courant par défaut. */
  root?: string;
  /** Délai maximal d'attente de la première réponse, en ms (défaut 60 000). */
  timeoutMs?: number;
}

/** Un exemplaire jetable, démarré et joignable. */
export interface ISpareApp {
  /** Port sur lequel il répond — celui qui a été demandé. */
  port: number;
  /** Tout ce qu'il a écrit sur ses deux flux jusqu'ici. */
  output(): string;
  /** L'arrête et REND à l'application son état d'exécution. */
  stop(): Promise<void>;
}

/**
 * Démarre un exemplaire JETABLE de l'application, dans un état choisi.
 *
 * ## À quoi ça sert
 *
 * Certaines choses ne s'observent que sur un processus qui démarre dans un état
 * précis : un schéma en retard qui retient la mise en service (`/readyz` rend
 * 503), une dépendance absente, un refus de démarrage. Le décor de la suite,
 * lui, a démarré l'application dans l'état NORMAL — et c'est ce qu'on veut : les
 * autres cas mesurent le fonctionnement.
 *
 * ## 🔴 Ce qu'il faut savoir, et qui ne se voit pas
 *
 * Un exemplaire Nodefony **publie ses ports** dans l'état d'exécution du projet
 * (`node_modules/.cache/nodefony/`), et cet état est un fichier UNIQUE par
 * racine d'application. Un second exemplaire lancé depuis le même dossier
 * l'écrase donc, et {@link runningAppPort} — que tous les autres cas
 * utilisent — se met à désigner le jetable, puis à lever une fois qu'il est
 * mort. Le défaut n'apparaît pas dans le cas qui l'a créé : il tombe sur le
 * SUIVANT, et accuse une route qui n'a rien fait.
 *
 * `stop()` restaure donc l'état d'exécution tel qu'il était avant le démarrage.
 * C'est la raison d'être de cette fonction, bien plus que le `spawn` qu'elle
 * fait à votre place.
 *
 * ```ts
 * const jetable = await startSpareApp({
 *   port: 5399,
 *   env: { NODE_ENV: "production", NF_DATABASE_URL: "sqlite:/tmp/vierge.db" },
 * });
 * try {
 *   const res = await fetch(`http://127.0.0.1:${jetable.port}/readyz`);
 *   assert.equal(res.status, 503);
 * } finally {
 *   await jetable.stop();
 * }
 * ```
 *
 * @param options - port imposé, environnement, racine.
 * @returns l'exemplaire, une fois qu'il répond.
 * @throws Si le processus meurt avant de répondre, ou si le délai expire — avec
 * ce qu'il a écrit, parce que c'est là que se trouve la cause.
 */
export async function startSpareApp(
  options: ISpareAppOptions,
): Promise<ISpareApp> {
  const root = options.root ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? 60_000;
  // L'état d'exécution est relevé AVANT le spawn : c'est la seule photo fidèle.
  const state = readStateFiles(root);

  const child = spawn(process.execPath, [nodefonyBin(), "production"], {
    cwd: root,
    // Chef de son groupe : c'est ce qui permet d'emporter l'arbre à l'arrêt.
    // Sous Windows, où les groupes n'existent pas, `signalProcessGroup` passe
    // par le programme de kill d'arbre — la règle a UNE implémentation.
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      NF_PORT: String(options.port),
      ...(options.httpsPort === undefined
        ? {}
        : { NF_PORT_HTTPS: String(options.httpsPort) }),
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout?.on("data", (c: Buffer) => (output += c.toString()));
  child.stderr?.on("data", (c: Buffer) => (output += c.toString()));
  let exitCode: number | null = null;
  child.on("exit", (code: number | null) => (exitCode = code ?? -1));

  const stop = async (): Promise<void> => {
    if (exitCode === null && typeof child.pid === "number") {
      signalProcessGroup(child.pid, "SIGKILL");
    }
    await once(child, "exit").catch(() => undefined);
    restoreStateFiles(state);
  };

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (exitCode !== null) {
      restoreStateFiles(state);
      throw new Error(
        `l'exemplaire jetable est mort avant de répondre (code ${exitCode}) :\n${output.slice(-2000)}`,
      );
    }
    // `/livez` et non `/readyz` : on attend qu'il SERVE, pas qu'il soit prêt —
    // un exemplaire dont la mise en service est retenue répond quand même.
    const alive = await fetch(`http://127.0.0.1:${options.port}/livez`)
      .then((r) => r.ok)
      .catch(() => false);
    if (alive) {
      break;
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(
        `l'exemplaire jetable n'a pas répondu sur le port ${options.port} en ${timeoutMs} ms :\n${output.slice(-2000)}`,
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  return { port: options.port, output: () => output, stop: stop };
}

/** Contenu brut des fichiers d'état, ou `null` quand le fichier n'existe pas. */
type StateFiles = ReadonlyArray<{ file: string; content: string | null }>;

/** Relève les fichiers d'état qu'un exemplaire écrase en démarrant. */
function readStateFiles(root: string): StateFiles {
  return [runtimeStateFile(root), readinessStateFile(root)].map((file) => {
    try {
      return { file, content: readFileSync(file, "utf8") };
    } catch {
      return { file, content: null };
    }
  });
}

/** Rend les fichiers d'état à ce qu'ils étaient — y compris leur absence. */
function restoreStateFiles(state: StateFiles): void {
  for (const { file, content } of state) {
    try {
      if (content === null) {
        rmSync(file, { force: true });
      } else {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, content, "utf8");
      }
    } catch {
      /* best-effort : ne jamais faire échouer un arrêt sur un ménage */
    }
  }
}
