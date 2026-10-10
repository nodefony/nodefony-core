import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Eta, type TemplateFunction } from "eta";
import {
  LOGIN_PAGE_ASSETS_BASE,
  type ILoginPageDescription,
  type Module,
} from "nodefony";
import type { ContextType } from "@nodefony/http";
import { Csp } from "../decorators/routerDecorators";
import Router from "../service/router";
import Controller from "../src/Controller";
import {
  LOGIN_PAGE_ASSET_FILES,
  LOGIN_PAGE_TEMPLATE,
  buildLoginPageView,
} from "../src/loginPage";

/**
 * Vue minimale du service `authFlow` (`@nodefony/security`) : la seule
 * méthode que lit la page. Framework n'importe pas security ; le couplage
 * passe par le nom du service.
 */
interface ILoginPageSource {
  /** Ce que la page affiche, ou `null` quand elle est désactivée. */
  describeLoginPage?(): ILoginPageDescription | null;
}

/** Service `server-static` de `@nodefony/http`, vu par son seul montage. */
interface IStaticMounts {
  addMount(prefix: string, dir: string): void;
}

const NO_STORE = { "cache-control": "no-store" } as const;

// Montage one-shot par processus, comme les routes de session.
let mounted = false;

// Tout est paresseux et mémoïsé au premier affichage : une application qui ne
// sert jamais la page ne paie ni lecture de fichier ni compilation.
let engine: Eta | null = null;
let defaultTemplate: TemplateFunction | null = null;
let appTemplate: { file: string; template: Promise<TemplateFunction> } | null =
  null;
let assetsVersion: Promise<string> | null = null;

/** Dossier des fichiers de la page (`dist/login/` du paquet `nodefony`). */
function assetsDir(): string {
  return path.dirname(fileURLToPath(import.meta.resolve("nodefony/login.js")));
}

function eta(): Eta {
  // `autoEscape` : toute valeur sort échappée ; le gabarit n'a aucune sortie brute.
  return (engine ??= new Eta({ autoEscape: true, useWith: false }));
}

function templateFor(page: ILoginPageDescription): Promise<TemplateFunction> {
  if (page.template === null) {
    return Promise.resolve(
      (defaultTemplate ??= eta().compile(LOGIN_PAGE_TEMPLATE)),
    );
  }
  if (appTemplate?.file !== page.template) {
    const file = page.template;
    appTemplate = {
      file,
      template: readFile(file, "utf8").then((source) => eta().compile(source)),
    };
  }
  return appTemplate.template;
}

// Empreinte du script et de la feuille, ajoutée à leur adresse : elle change
// avec le fichier, donc le cache long du service statique ne sert jamais le
// script d'une autre version.
function version(): Promise<string> {
  return (assetsVersion ??= (async () => {
    const dir = assetsDir();
    const hash = createHash("sha256");
    for (const file of [
      LOGIN_PAGE_ASSET_FILES.script,
      LOGIN_PAGE_ASSET_FILES.style,
    ]) {
      hash.update(await readFile(path.join(dir, file)));
    }
    return hash.digest("hex").slice(0, 12);
  })());
}

/**
 * Page de connexion par défaut (ADR-0015) : gabarit F03 rendu côté serveur,
 * feuille `nodefony/login.css`, script `nodefony/login.js`. Aucun front, aucun
 * build côté application.
 *
 * Joignable sans session ; jamais mise en cache (`no-store`) ni affichable
 * dans un cadre (`frame-ancestors 'none'`).
 */
class LoginPageController extends Controller {
  constructor(context: ContextType) {
    super("LoginPageController", context);
  }

  /**
   * Rend la page de connexion.
   *
   * @returns la page HTML, ou 404 quand security ne la décrit plus
   */
  @Csp({ "frame-ancestors": ["'none'"] })
  async page() {
    const page =
      this.get<ILoginPageSource>("authFlow")?.describeLoginPage?.() ?? null;
    if (page === null) {
      return this.renderJson({ error: "Not Found" }, 404, NO_STORE);
    }
    const query = this.queryGet as Record<string, unknown> | undefined;
    const view = buildLoginPageView(page, {
      from: query?.from,
      theme: query?.theme,
      nonce: this.context?.cspNonce ?? "",
      projectName: this.kernel?.projectName ?? "Nodefony",
      assetsVersion: await version(),
    });
    const template = await templateFor(page);
    return this.render(template.call(eta(), view), "utf8", 200, {
      ...NO_STORE,
      "content-type": "text/html; charset=utf-8",
    });
  }
}

/**
 * Monte la page de connexion par défaut quand security la décrit : la route
 * sur `loginPage.path`, et ses fichiers sous `LOGIN_PAGE_ASSETS_BASE`.
 *
 * La page est le chemin vers la session : elle échappe au pare-feu, comme les
 * routes de connexion — sinon une application qui protège `^/` exigerait
 * d'être connecté pour se connecter.
 *
 * @param frameworkModule - module framework, qui porte les contrôleurs
 */
export function mountLoginPage(frameworkModule: Module): void {
  if (mounted) return;
  const page =
    frameworkModule.get<ILoginPageSource>("authFlow")?.describeLoginPage?.() ??
    null;
  if (page === null) return;
  Router.createRoute("security.login.page", {
    path: page.path,
    constructor: LoginPageController,
    classMethod: "page",
    requirements: { methods: ["GET", "HEAD"] },
    bypassFirewall: true,
  });
  frameworkModule
    .get<IStaticMounts>("server-static")
    ?.addMount(LOGIN_PAGE_ASSETS_BASE, assetsDir());
  if (
    !Object.prototype.hasOwnProperty.call(
      LoginPageController.prototype,
      "module",
    )
  ) {
    Router.setController(LoginPageController, frameworkModule);
  }
  mounted = true;
}

export default LoginPageController;
