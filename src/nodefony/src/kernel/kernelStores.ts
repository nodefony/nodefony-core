/**
 * Infra déclarée et registre des résolutions de stores — la famille STORE de
 * `Kernel.ts`, détenue par COMPOSITION : le Kernel porte une instance
 * (`stores`, allouée à sa construction — deux emplacements `null`, rien d'autre
 * tant que personne ne lit) et délègue `infra`, `storeResolutions` et
 * `registerStoreResolution` sans rien allouer.
 *
 * Module FEUILLE : aucun import de `./Kernel`.
 */
import { resolveInfra, AUTO_STORE } from "../config/infra";
import type { IInfra, InfraEnvSource, IStoreResolution } from "../config/infra";

/**
 * Ce que les briques de persistance déclarent au noyau et y relisent.
 *
 * - `infra` : les trois volets déclarés (`database`/`cache`/`logs`), résolus
 *   depuis l'environnement au PREMIER accès puis mémoïsés — une variable changée
 *   ensuite n'est plus vue ; un premier accès qui lève (scheme inconnu) ne
 *   mémoïse rien, la lecture suivante réessaie.
 * - `storeResolutions` / `registerStoreResolution` : la vérité VÉCUE des stores,
 *   une entrée par brique, dans l'ordre d'enregistrement ; une brique
 *   ré-enregistrée remplace son entrée à la même position.
 *
 * Verrouillé par `tests/kernelStores.test.ts`.
 */
export class KernelStores {
  /** Infra déclarée mémoïsée — lazy, `null` tant que non lue. */
  private _infra: IInfra | null = null;

  /**
   * Registre des résolutions de stores — lazy (`null` tant qu'aucune brique n'a
   * résolu son store). Alloué au premier `registerStoreResolution` (au boot, une
   * fois par brique) — jamais dans le hot-path. Clé = `brick` (dernière gagne).
   */
  private _storeResolutions: Map<string, IStoreResolution> | null = null;

  /**
   * Source d'environnement injectée (bancs) ; `undefined` ⇒ `process.env`, lu
   * au moment de l'accès, jamais capturé à la construction.
   */
  private readonly env: InfraEnvSource | undefined;

  /**
   * @param env - source d'environnement ; omise, c'est `process.env` qui est lu
   *   au premier accès à {@link infra}.
   */
  constructor(env?: InfraEnvSource) {
    this.env = env;
  }

  /**
   * Infra déclarée (`database`/`cache`/`logs`) résolue depuis l'environnement
   * (modèle « infra déclarée »). Calcul 1 fois, mémoïsé — consommé par le ctx
   * `defineConfig` (`ctx.infra`) et par les briques dont le store vaut `"auto"`
   * (`resolveAutoStore`).
   *
   * @throws Error au premier accès si `NF_DATABASE_URL` a un scheme non
   *   supporté (fail-loud : jamais de repli sqlite silencieux).
   */
  get infra(): IInfra {
    this._infra ??= resolveInfra(this.env ?? process.env);
    return this._infra;
  }

  /**
   * Résolutions EFFECTIVES des stores de persistance capturées au boot — la
   * vérité vécue (replis annoncés inclus). Alimente `/nodefony/kernel/api/stores`
   * et l'écran Studio « Stores ». Vide si aucune brique n'a encore résolu ;
   * tableau NEUF à chaque lecture (le registre n'est jamais exposé).
   */
  get storeResolutions(): IStoreResolution[] {
    return this._storeResolutions
      ? Array.from(this._storeResolutions.values())
      : [];
  }

  /**
   * Enregistre la résolution effective d'une brique (idempotent par `brick`).
   * La provenance est dérivée de `configured` : la sentinelle `"auto"` ⇒
   * `"infra"` (résolu depuis l'infra déclarée), un backend nommé ⇒ `"explicit"`.
   *
   * @param resolution - triplet brique/configuré/résolu + raison + nature
   *   ({@link IStoreResolution} sans `provenance`, dérivée ici).
   */
  registerStoreResolution(
    resolution: Omit<IStoreResolution, "provenance">,
  ): void {
    this._storeResolutions ??= new Map<string, IStoreResolution>();
    this._storeResolutions.set(resolution.brick, {
      ...resolution,
      provenance: resolution.configured === AUTO_STORE ? "infra" : "explicit",
    });
  }
}
