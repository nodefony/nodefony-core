/// <reference types="node" />
import {
  Controller,
  Get,
  Param,
  Query,
  controller,
  IsGranted,
} from "@nodefony/framework";
import { Context } from "@nodefony/http";
import { getScaffoldSpec, scaffoldCaps } from "nodefony";
import type ScaffoldService from "../service/ScaffoldService";
import { SCAFFOLD_STEPS } from "../service/ScaffoldService";

/**
 * Types de scaffold proposés par Studio.
 *
 * `app` en fait partie, avec une différence de nature : les quatre autres modifient le
 * projet COURANT (ils y écrivent et le recâblent), tandis qu'une app naît AILLEURS — dans
 * un espace de travail voisin. D'où sa destination, qui n'est pas une question de plus du
 * formulaire mais une **recomposition côté serveur** sous une racine autorisée (cf
 * `resolveScaffoldDestination` : le client choisit une racine par identifiant et un nom,
 * jamais un chemin).
 */
const STUDIO_TYPES = ["app", "module", "controller", "front", "entity"] as const;

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
      // Emplacements où une NOUVELLE app peut naître. On expose le chemin (l'appelant est
      // déjà administrateur, en développement, sur sa propre machine — le lui cacher
      // n'apporterait rien et l'empêcherait de savoir où il installe) mais le client ne
      // s'en sert QUE pour l'afficher : il renvoie l'`id`, jamais le chemin.
      roots: svc.roots(),
      // Capacités de l'environnement, vues par le MOTEUR — elles pilotent les questions
      // `askIf`. Un front ne peut pas les deviner (`link` dépend de la présence d'un
      // checkout du framework SUR LE DISQUE du serveur) : les figer côté client
      // supprimerait l'option en silence.
      caps: scaffoldCaps(),
    });
  }

  /**
   * Sous-dossiers navigables d'une racine autorisée — l'explorateur de l'écran « Créer ».
   *
   * Il n'existe pas de sélecteur de dossier serveur dans un navigateur (et
   * `showDirectoryPicker()` rend un handle CLIENT, dans lequel le serveur ne peut rien
   * écrire). On explore donc côté serveur, mais **borné** : le client envoie un
   * identifiant de racine et un sous-chemin relatif validé segment par segment, jamais un
   * chemin absolu.
   */
  @IsGranted("ROLE_NODEFONY_ADMIN")
  @Get("/studio/api/create/browse")
  async apiBrowse(@Query("root") root: string, @Query("sub") sub?: string) {
    const svc = this.scaffold;
    if (!svc?.enabled) return this.renderJson({ error: "forbidden" }, 403);
    try {
      return this.renderJson(svc.browse(root ?? "", sub ?? ""));
    } catch (e) {
      // Message d'erreur volontairement sobre : il ne révèle aucun chemin serveur.
      return this.renderJson({ error: (e as Error).message }, 400);
    }
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

  /**
   * Télécharge l'application générée (mode « archive »).
   *
   * Le client demande **l'archive d'un job**, jamais un fichier : il n'envoie qu'un
   * identifiant de job, et le service seul détient le chemin réel. Aucun paramètre de
   * chemin n'existe donc dans cette route — il n'y a rien à traverser.
   *
   * L'archive vit dans un dossier temporaire, effacé avec le job (10 minutes). Passé ce
   * délai, le lien rend 404 : c'est voulu, une app générée n'a pas à s'accumuler sur le
   * disque du serveur.
   */
  @IsGranted("ROLE_NODEFONY_ADMIN")
  @Get("/studio/api/create/job/{id}/archive")
  async apiArchive(@Param("id") id: string) {
    const svc = this.scaffold;
    if (!svc?.enabled) return this.renderJson({ error: "forbidden" }, 403);
    const file = svc.archivePathOf(id);
    if (!file) {
      return this.renderJson(
        { error: "archive introuvable (job inconnu, ou expiré)" },
        404,
      );
    }
    return this.renderFileDownload(file);
  }
}

export default StudioCreateController;
