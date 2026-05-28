import { Module, extend, injectable } from "nodefony";
import { Eta as EtaEngine } from "eta";
import { readFile } from "node:fs/promises";
import Template from "../src/Template";

/**
 * Options par défaut du moteur Eta.
 *
 * `autoEscape: true` = échappement HTML par défaut sur `<%= %>` (protection XSS,
 * cf exigence sécurité Nodefony). Sortie brute volontaire via `<%~ %>`.
 * `useWith: true` = variables exposées nues (`<%= name %>`) comme EJS — DX
 * familière, migration des vues `.ejs` → `.eta` verbatim.
 * `cache: false` par défaut — réactivé en prod par {@link Template} (env).
 */
const defaultOption = {
  autoEscape: true,
  useWith: true,
  cache: false,
} as const;

/**
 * Moteur de template **Eta** — unique moteur de Nodefony (remplace EJS + Twig).
 *
 * Choisi pour : écrit en TypeScript (types fournis, pas de `@types/*`), ESM
 * natif, autoescape, et délimiteurs `<% %>` / `<%= %>` qui ne collisionnent pas
 * avec la syntaxe TS/JSON/JSX — décisif pour la génération de code (scaffold
 * `module:create`) autant que pour le rendu HTML serveur.
 *
 * Le `Controller` lit le fichier de vue (via `FileClass`) puis appelle
 * {@link Eta.render} avec la chaîne ; `renderFile` est fourni pour les usages
 * directs (CLI/Builder) qui partent d'un chemin.
 */
injectable();
class Eta extends Template {
  declare engine: EtaEngine;

  constructor(module: Module) {
    const engine = new EtaEngine(extend(true, {}, defaultOption));
    super("template", engine, module, extend(true, {}, defaultOption));
    // `Template` calcule `this.cache` selon l'environnement (prod = true).
    this.engine.configure({ cache: this.cache });
  }

  /**
   * Rend un template depuis une chaîne source (chemin chaud du Controller).
   *
   * @param str - source du template Eta
   * @param data - locals injectés dans le template
   * @returns le rendu HTML/texte
   */
  async render(
    str: string,
    data: Record<string, unknown> = {},
  ): Promise<string> {
    return this.engine.renderStringAsync(str, data);
  }

  /**
   * Rend un template depuis un chemin de fichier (lecture async non bloquante).
   *
   * @param path - chemin absolu du fichier `.eta`
   * @param data - locals injectés dans le template
   * @returns le rendu HTML/texte
   * @throws Si la lecture ou le parsing échoue (loggé en ERROR).
   */
  async renderFile(
    path: string,
    data: Record<string, unknown> = {},
  ): Promise<string> {
    try {
      const src = await readFile(path, { encoding: "utf8" });
      return await this.engine.renderStringAsync(src, data);
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }
}

export default Eta;
