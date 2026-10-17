/**
 * Ce qui ENTOURE le registre de disponibilité du noyau — la publication de
 * l'état sur le disque et le journal de bascule. Famille READY de `Kernel.ts`,
 * détenue par COMPOSITION : le Kernel porte une instance (`readinessPublisher`),
 * allouée au premier `setReadiness` et jamais libérée ensuite.
 *
 * Ce module ne porte PAS l'état. Le registre (`ReadinessRegistry`, donc l'entier
 * `blocked` que lit la sonde `/readyz`) reste un champ DIRECT du Kernel, créé
 * paresseusement et remis à `null` quand le dernier contributeur part : le
 * chemin de requête (`servable` → `readinessBlocked`) ne gagne ainsi aucune
 * indirection. Seule la signature du dernier état publié vit ici — elle doit
 * SURVIVRE à la libération du registre, sinon la publication de l'état vide et
 * l'anti-réécriture casseraient.
 *
 * Module FEUILLE : aucun import de `./Kernel`. Le Kernel se passe lui-même,
 * typé par {@link IReadinessHost} (le seul besoin : `path` et `log`).
 */
import type { Pci, Severity } from "../syslog/Pdu";
import {
  clearReadinessState,
  writeReadinessState,
} from "../service/dev/devProcess";
import type { IReadinessContributor } from "./readinessRegistry";

/**
 * Ce que le publieur demande au noyau, et rien de plus : la racine du projet
 * (lue à l'APPEL — elle est posée au boot, après la construction) et le
 * journal. `Kernel` satisfait cette forme structurellement.
 */
export interface IReadinessHost {
  /** Racine du projet — sous elle vit le fichier d'état. */
  readonly path: string;
  /** Journal du noyau (hérité de `Service`). */
  log(pci: Pci, severity?: Severity): unknown;
}

/**
 * Publie sur le disque QUI retient la mise en service, et dit au journal ce qui
 * vient de basculer.
 *
 * Les deux méthodes reçoivent le rapport du registre (`readinessReport()`) :
 * elles ne le lisent pas elles-mêmes, ce qui laisse le registre au Kernel.
 * Verrouillé par `tests/kernelReadiness.test.ts`.
 */
export class KernelReadinessPublisher {
  /**
   * Signature du dernier état publié sur le disque — `null` tant que rien ne
   * l'a été. Sert UNIQUEMENT à ne pas réécrire un fichier identique.
   */
  #published: string | null = null;

  private readonly host: IReadinessHost;

  /**
   * @param host - le noyau (`path` et `log`), lus à chaque appel.
   */
  constructor(host: IReadinessHost) {
    this.host = host;
  }

  /**
   * Publie sur le disque QUI retient la mise en service — le canal que lit
   * `nodefony status`.
   *
   * **Pourquoi un fichier plutôt que la sonde** : le détail existe déjà sur
   * `livez`, mais réservé à un appelant authentifié, et cette route est publique
   * en production. Le système de fichiers est la vraie frontière « local », il
   * répond même quand la boucle d'événements ne répond plus, et il n'ouvre
   * aucune surface publique. Détail : `readinessStateFile`.
   *
   * **N'écrit que si l'état a CHANGÉ.** En régime établi — un contributeur qui
   * repose le même verdict toutes les quinze secondes — ce mécanisme ne touche
   * pas le disque. La signature est une chaîne courte, composée hors du chemin
   * d'une requête : `setReadiness` n'est appelé qu'au démarrage et au rythme
   * propre de chaque contributeur.
   *
   * @param contributors - le rapport courant du registre (vide : le fichier est effacé)
   */
  publish(contributors: readonly IReadinessContributor[]): void {
    // Signature de l'ÉTAT, pas du temps : deux appels identiques n'écrivent
    // qu'une fois. Un `ts` dans la comparaison rendrait le garde inopérant.
    const signature = contributors
      .map((c) => `${c.name}\u0000${c.ready ? 1 : 0}\u0000${c.reason ?? ""}`)
      .join("\u0001");
    if (signature === this.#published) {
      return;
    }
    this.#published = signature;
    if (contributors.length === 0) {
      clearReadinessState(this.host.path);
      return;
    }
    writeReadinessState(this.host.path, contributors);
  }

  /**
   * Dit au journal ce qui vient de basculer. Appelé UNIQUEMENT quand le verdict
   * agrégé change (jamais à chaque pose de verdict identique) : un pod retenu
   * plusieurs heures ne doit pas noyer son propre journal, et un exploitant qui
   * voit un pod jamais disponible doit trouver ici le NOM de ce qui le retient —
   * le corps de la sonde, lui, reste une constante pré-allouée.
   *
   * @param contributors - le rapport courant du registre ; vide quand le registre
   *   vient d'être libéré (dernier contributeur retiré) : c'est exactement le cas
   *   « plus rien ne retient ».
   */
  logFlip(contributors: readonly IReadinessContributor[]): void {
    const holding = contributors.filter((c) => !c.ready);
    if (holding.length === 0) {
      this.host.log(
        "Mise en service libérée — /readyz rend de nouveau 200",
        "INFO",
      );
      return;
    }
    const details = holding
      .map((c) => (c.reason ? `${c.name} (${c.reason})` : c.name))
      .join(", ");
    this.host.log(
      `Mise en service RETENUE — /readyz rend 503 : ${details}`,
      "CRITIC",
    );
  }
}
