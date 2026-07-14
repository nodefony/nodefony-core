/// <reference types="node" />
import {
  Controller,
  Get,
  Param,
  controller,
  IsGranted,
} from "@nodefony/framework";
import { Context } from "@nodefony/http";
import { getScaffoldSpec } from "nodefony";
import type ScaffoldService from "../service/ScaffoldService";
import { SCAFFOLD_STEPS } from "../service/ScaffoldService";

/**
 * Types de scaffold proposés par Studio.
 *
 * `app` en est volontairement ABSENT : Studio tourne DANS une application — la créer
 * depuis elle serait un serpent qui se mord la queue. Créer une app reste l'affaire du
 * CLI (`npx nodefony create app`), avant qu'un Studio n'existe.
 */
const STUDIO_TYPES = ["module", "controller", "front", "entity"] as const;

/**
 * Data plane du générateur de code (`/nodefony/studio/api/create/*`).
 *
 * Il ne sert QUE la matière du formulaire (la spec du moteur, en JSON) et l'état d'un
 * job. **L'exécution passe par le temps réel**, pas par HTTP : un scaffold suivi d'un
 * `npm install` dure des dizaines de secondes, et une réponse HTTP muette pendant tout
 * ce temps n'apprend rien à personne. Le canal `scaffold:job@<id>` streame chaque ligne.
 *
 * ## Développement uniquement — refusé COTÉ SERVEUR
 *
 * Ces routes écrivent sur le disque et lancent `npm`. Elles répondent **403 hors
 * développement**, quel que soit le rôle. Masquer l'entrée de menu côté navigateur ne
 * protège rien : la route resterait appelable au curl.
 */
@controller("/nodefony")
class StudioCreateController extends Controller {
  constructor(context: Context) {
    super("StudioCreateController", context);
  }

  /** Le service refuse déjà par lui-même ; on double la garde à la porte HTTP. */
  private get scaffold(): ScaffoldService | null {
    return this.get<ScaffoldService>("scaffold");
  }

  /**
   * Tout ce dont le formulaire a besoin, en un aller-retour : les questions du moteur
   * (avec leurs expressions de validation, réutilisées telles quelles côté navigateur),
   * les modules où l'on peut créer, et les étapes exécutables.
   *
   * La spec vient du MOTEUR — les champs ne sont pas recopiés ici. Une question ajoutée
   * au scaffold apparaît dans Studio sans toucher à ce fichier.
   */
  @IsGranted("ROLE_NODEFONY_ADMIN")
  @Get("/studio/api/create/spec")
  async apiSpec() {
    const svc = this.scaffold;
    if (!svc?.enabled) {
      return this.renderJson(
        {
          enabled: false,
          reason:
            "La création de code est réservée au développement (elle écrit sur le disque).",
        },
        403,
      );
    }
    // La spec est un TABLEAU de types ; on ne garde que ceux que Studio expose (pas `app`).
    const specs = getScaffoldSpec().filter((s) =>
      (STUDIO_TYPES as readonly string[]).includes(s.type),
    );
    return this.renderJson({
      enabled: true,
      steps: SCAFFOLD_STEPS,
      specs,
      targets: svc.targets(),
      projectRoot: svc.projectRoot,
    });
  }

  /**
   * État d'un job — sert au rechargement de page : le terminal se reconstitue depuis le
   * backlog au lieu de repartir vide (le job, lui, continue côté serveur).
   */
  @IsGranted("ROLE_NODEFONY_ADMIN")
  @Get("/studio/api/create/job/{id}")
  async apiJob(@Param("id") id: string) {
    const svc = this.scaffold;
    if (!svc?.enabled) return this.renderJson({ error: "forbidden" }, 403);
    const job = svc.getJob(id);
    if (!job) return this.renderJson({ error: "job introuvable" }, 404);
    return this.renderJson(job);
  }
}

export default StudioCreateController;
