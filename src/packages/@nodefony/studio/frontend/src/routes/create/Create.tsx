/**
 * Page « Créer » (`/nodefony/create`) — le générateur de code du framework, piloté depuis
 * Studio, avec un terminal live.
 *
 * C'est le MÊME moteur que `nodefony create …` en ligne de commande : Studio n'est qu'un
 * troisième front posé sur la spec déclarative du scaffold. Le formulaire est donc
 * **entièrement construit depuis les questions du serveur** — ajouter un choix au moteur
 * le fait apparaître ici sans toucher au front.
 *
 * Ce que le navigateur envoie : un **type**, des **réponses** et des **étapes** prises dans
 * une liste fermée. Jamais une commande. C'est ce qui sépare « piloter un générateur » de
 * « exécuter du shell à distance » — et pourquoi le serveur refuse tout hors développement
 * (le masquage de l'entrée de menu, lui, ne protège rien).
 *
 * Le suivi passe par la socket Nodefony (`nodefony:scaffold:run` → canal `nodefony:scaffold:job@<id>`) plutôt
 * que par une réponse HTTP : une génération suivie d'un `npm install` dure des dizaines de
 * secondes, et une requête muette pendant tout ce temps n'apprend rien à personne.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Code,
  Grid,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconApps,
  IconBox,
  IconBrowser,
  IconDatabase,
  IconPlus,
  IconRoute,
  IconSparkles,
  IconWand,
  type Icon,
} from "@tabler/icons-react";
import { useNodefony } from "nodefony/react";
import { useNotifications, useStore } from "../../stores";
import { useResource } from "../../hooks";
import { ApiError } from "../../services/ApiClient";
import {
  DataState,
  DocHint,
  InfoHint,
  PageLayout,
  WarnHint,
} from "../../components/ui";
import { CreateDestination } from "./CreateDestination";
import { CreateForm } from "./CreateForm";
import { CreateTerminal, JobStream } from "./CreateTerminal";
import {
  MAX_TERMINAL_LINES,
  appendLine,
  defaultAnswers,
  defaultRootId,
  defaultSteps,
  describeDestination,
  describeInstallRisk,
  describeScaffoldError,
  formatAnswer,
  isAppType,
  isQuestionVisible,
  stepLabel,
  validateAnswers,
  type CreateSpec,
  type ICreateSpecOk,
  type IScaffoldCaps,
  type IScaffoldCancelResult,
  type IScaffoldJobMeta,
  type IScaffoldJobState,
  type IScaffoldEvent,
  type IScaffoldLine,
  type IScaffoldTypeSpec,
  type ScaffoldStep,
  type TAnswers,
} from "./createModel";
import { PLATFORM_METHODS } from "nodefony";

const SPEC_URL = "/nodefony/studio/api/create/spec";
const JOB_URL = "/nodefony/studio/api/create/job";

/** Habillage d'un type de scaffold. Un type inconnu du front reste rendu (fallback). */
const TYPE_ICONS: Readonly<Record<string, Icon>> = {
  app: IconApps,
  module: IconBox,
  controller: IconRoute,
  front: IconBrowser,
  entity: IconDatabase,
};

/** Carte de choix d'un type — le `description` vient de la spec, jamais d'ici. */
function TypeCard({
  spec,
  selected,
  onSelect,
}: {
  spec: IScaffoldTypeSpec;
  selected: boolean;
  onSelect: (type: string) => void;
}) {
  const TypeIcon = TYPE_ICONS[spec.type] ?? IconSparkles;
  return (
    <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
      <Card
        withBorder
        padding="md"
        component="button"
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(spec.type)}
        style={{
          cursor: "pointer",
          height: "100%",
          textAlign: "left",
          width: "100%",
          borderColor: selected
            ? "var(--mantine-color-brand-5)"
            : "var(--mantine-color-default-border)",
          background: selected ? "var(--mantine-color-brand-light)" : undefined,
        }}
      >
        <Group gap="xs" mb="xs">
          <ThemeIcon
            variant={selected ? "filled" : "light"}
            color="brand"
            size="md"
          >
            <TypeIcon size={16} />
          </ThemeIcon>
          <Text fw={600}>{spec.type}</Text>
        </Group>
        <Text size="sm" c="dimmed">
          {spec.description}
        </Text>
      </Card>
    </Grid.Col>
  );
}

export function Create() {
  const store = useStore();
  const conn = useNodefony();
  const notifications = useNotifications();
  const [searchParams, setSearchParams] = useSearchParams();

  // Le 403 « hors développement » n'est PAS une panne : il porte sa raison dans le corps.
  // On le convertit en état normal de la page (sinon l'écran afficherait « erreur » là où
  // le serveur explique posément pourquoi il refuse).
  const fetcher = useCallback(async (): Promise<CreateSpec> => {
    try {
      return await store.api.getAbsolute<CreateSpec>(SPEC_URL);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        const body = e.body as { reason?: unknown } | null;
        return {
          enabled: false,
          reason:
            body && typeof body.reason === "string"
              ? body.reason
              : "La création de code est réservée au développement.",
        };
      }
      throw e;
    }
  }, [store]);
  const { data, loading, error, reload } = useResource(fetcher);
  const spec = data?.enabled === true ? (data as ICreateSpecOk) : null;

  const [type, setType] = useState<string | null>(null);
  const [answers, setAnswers] = useState<TAnswers>({});
  const [steps, setSteps] = useState<ScaffoldStep[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Destination — HORS des réponses du formulaire : ce n'est pas une question du moteur (il
  // ignore ces deux clés), c'est ce que le SERVEUR lit pour recomposer où l'app doit naître.
  // Elle n'a de sens que pour le type `app` ; les autres écrivent dans le projet courant.
  const [rootId, setRootId] = useState<string | null>(null);
  const [subPath, setSubPath] = useState<string>("");

  const [job, setJob] = useState<IScaffoldJobMeta | null>(null);
  const [lines, setLines] = useState<IScaffoldLine[]>([]);
  // Dernier `seq` intégré : le serveur REJOUE le backlog à l'abonnement (rien n'est perdu
  // si on s'abonne en retard) — sans ce garde-fou, la reprise après un F5 afficherait
  // deux fois les mêmes lignes.
  const lastSeqRef = useRef(0);

  const typeSpec = spec?.specs.find((s) => s.type === type) ?? null;
  const jobIdParam = searchParams.get("job");

  // Une app naît hors du projet : elle a une destination, les autres types n'en ont pas.
  const isApp = isAppType(typeSpec?.type ?? null);
  const roots = spec?.roots ?? [];
  // Les capacités viennent du SERVEUR : lui seul sait ce qu'il y a sur son disque (un
  // checkout du framework est-il résolvable ?). Les deviner côté navigateur revenait à
  // supprimer une question en silence. Absentes (vieux serveur) → tout à « non ».
  const caps: IScaffoldCaps = spec?.caps ?? { hasCheckout: false };
  const destination = describeDestination(
    roots.find((r) => r.id === rootId) ?? null,
    subPath,
    typeof answers.name === "string" ? answers.name : "",
  );
  const installRisk = describeInstallRisk(
    typeSpec?.type ?? null,
    caps,
    answers,
    steps,
  );

  const selectType = (next: string): void => {
    const s = spec?.specs.find((x) => x.type === next);
    if (!s) return;
    setType(next);
    setAnswers(defaultAnswers(s, caps));
    setSteps(defaultSteps(next, spec?.steps ?? []));
    setErrors({});
    // Repartir de la première racine (et de son sommet) : garder le dossier d'un choix
    // précédent ferait naître l'app quelque part que plus personne ne regarde.
    setRootId(defaultRootId(spec?.roots ?? []));
    setSubPath("");
  };

  const changeAnswer = (
    key: string,
    value: string | boolean | string[],
  ): void => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const toggleStep = (step: ScaffoldStep, on: boolean): void => {
    setSteps((prev) => (on ? [...prev, step] : prev.filter((s) => s !== step)));
  };

  /**
   * Événement reçu du canal : une ligne de terminal, ou l'état du job.
   *
   * Tout passe par la socket — statut, fichiers écrits et notes compris. Aucune raison
   * d'interroger le serveur en boucle quand une connexion temps réel est déjà ouverte.
   * Les lignes déjà vues (backlog rejoué à l'abonnement) sont ignorées par leur `seq`.
   */
  const onEvent = useCallback((event: IScaffoldEvent): void => {
    if (event?.kind === "state") {
      const { lines: _ignored, ...meta } = event.state;
      setJob(meta);
      return;
    }
    const line = event?.kind === "line" ? event.line : null;
    if (!line || typeof line.seq !== "number") return;
    if (line.seq <= lastSeqRef.current) return;
    lastSeqRef.current = line.seq;
    setLines((prev) => appendLine(prev, line));
  }, []);

  /** Reprise après rechargement : le job continue côté serveur, on le rattrape par son lien. */
  useEffect(() => {
    if (!jobIdParam || job?.id === jobIdParam) return;
    let alive = true;
    store.api
      .getAbsolute<IScaffoldJobState>(`${JOB_URL}/${jobIdParam}`)
      .then((snap) => {
        if (!alive) return;
        const { lines: snapLines, ...meta } = snap;
        const window_ = snapLines.slice(-MAX_TERMINAL_LINES);
        lastSeqRef.current = window_.length
          ? (window_[window_.length - 1]?.seq ?? 0)
          : 0;
        setLines(window_);
        setJob(meta);
      })
      .catch(() => {
        // Job inconnu (purgé après 10 minutes) → le lien ne mène plus à rien : on le retire
        // plutôt que de laisser un terminal fantôme.
        if (alive) setSearchParams({}, { replace: true });
      });
    return () => {
      alive = false;
    };
  }, [jobIdParam, job?.id, store, setSearchParams]);

  const openConfirm = (): void => {
    if (!typeSpec) return;
    const found = validateAnswers(typeSpec, answers, caps);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    // Une app sans destination complète ne part pas : le serveur la refuserait, autant le
    // dire ici — le panneau « Emplacement » affiche déjà CE qui manque.
    if (isApp && destination.issue !== null) {
      notifications.notify("warning", destination.issue, {
        title: "Destination incomplète",
        source: "api",
      });
      return;
    }
    setConfirm(true);
  };

  const run = async (): Promise<void> => {
    if (!typeSpec) return;
    setSubmitting(true);
    try {
      // `root` et `subPath` accompagnent les réponses SANS être des réponses : le moteur les
      // ignore (elles ne sont pas dans sa spec), le serveur les lit pour recomposer la
      // destination. Le front n'envoie donc jamais de chemin — seulement un identifiant de
      // racine et des noms de dossiers qu'il tient du serveur lui-même.
      const payload: TAnswers = isApp
        ? { ...answers, root: rootId ?? "", subPath }
        : answers;
      const state = await conn.request<IScaffoldJobState>(
        PLATFORM_METHODS.scaffoldRun,
        {
          type: typeSpec.type,
          answers: payload,
          steps,
        },
      );
      const { lines: snapLines, ...meta } = state;
      const window_ = snapLines.slice(-MAX_TERMINAL_LINES);
      lastSeqRef.current = window_.length
        ? (window_[window_.length - 1]?.seq ?? 0)
        : 0;
      setLines(window_);
      setJob(meta);
      setConfirm(false);
      // Le lien porte le job : un F5 (ou un partage du lien) retrouve le terminal.
      setSearchParams({ job: meta.id });
    } catch (e) {
      notifications.notify("error", describeScaffoldError(e), {
        title: "Génération refusée",
        source: "server",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (): Promise<void> => {
    if (!job) return;
    setCancelling(true);
    try {
      await conn.request<IScaffoldCancelResult>(
        PLATFORM_METHODS.scaffoldCancel,
        {
          id: job.id,
        },
      );
    } catch (e) {
      notifications.notify("error", describeScaffoldError(e), {
        title: "Arrêt impossible",
        source: "server",
      });
    } finally {
      setCancelling(false);
    }
  };

  const reset = (): void => {
    setJob(null);
    setLines([]);
    lastSeqRef.current = 0;
    setSearchParams({}, { replace: true });
  };

  const running = job?.status === "running";

  return (
    <PageLayout
      title="Créer"
      icon={<IconWand size={22} />}
      subtitle="Génère du code DANS ce projet — le serveur écrit réellement sur le disque."
      actions={
        job && !running ? (
          <Button
            variant="light"
            leftSection={<IconPlus size={16} />}
            onClick={reset}
          >
            Nouvelle génération
          </Button>
        ) : undefined
      }
    >
      <DataState loading={loading} error={error} onRetry={reload}>
        {data?.enabled === false ? (
          <Alert
            color="orange"
            variant="light"
            icon={<IconAlertTriangle size={16} />}
            title="Création indisponible"
          >
            <Text size="sm">{data.reason}</Text>
          </Alert>
        ) : spec === null ? null : (
          <Stack gap="lg">
            {/* L'avertissement dit la vérité du type CHOISI : une app naît ailleurs (elle
                ne touche pas au projet courant), les quatre autres écrivent ICI. Un seul
                bandeau pour les deux cas mentirait la moitié du temps. */}
            <Alert
              color="orange"
              variant="light"
              icon={<IconAlertTriangle size={16} />}
              title={
                isApp
                  ? "Réservé au développement — une application va être créée sur le disque"
                  : "Réservé au développement — l'écriture est réelle"
              }
            >
              <Stack gap={6}>
                {isApp ? (
                  <Text size="sm">
                    Une application naît <b>AILLEURS</b> : dans l'espace de
                    travail choisi ci-dessous, pas dans ce projet — qui n'est ni
                    modifié ni recâblé. Le serveur y écrit réellement un nouveau
                    dossier (et y lance <Code>npm install</Code> si l'étape est
                    cochée). Le moteur n'a <b>aucun mode simulation</b> : rien à
                    prévisualiser, rien d'annulé en cas d'échec — d'où la
                    confirmation demandée avant de lancer.
                  </Text>
                ) : (
                  <Text size="sm">
                    Cette page ÉCRIT des fichiers dans le projet et modifie son{" "}
                    <Code>index.ts</Code> et son <Code>package.json</Code>{" "}
                    (câblage du module, des controllers, des entités). Le moteur
                    n'a <b>aucun mode simulation</b> : il n'y a rien à
                    prévisualiser, et rien n'est annulé en cas d'échec — d'où la
                    confirmation demandée avant de lancer.
                  </Text>
                )}
                <Group gap="xs">
                  <Text size="sm" c="dimmed">
                    Projet :
                  </Text>
                  <Code>{spec.projectRoot}</Code>
                  <WarnHint
                    title="Ce qui n'est pas fait pour vous"
                    summary={
                      isApp
                        ? "L'application est écrite et prête, mais elle vit sa propre vie : ce serveur ne la charge pas."
                        : "Le code est écrit et câblé, mais le serveur qui tourne ne le connaît pas encore."
                    }
                    sections={
                      isApp
                        ? [
                            {
                              label: "Après la génération",
                              body: "L'app est autonome (son propre package.json, son propre serveur). Elle se lance depuis son dossier — le terminal ci-dessous vous donne la commande exacte.",
                            },
                            {
                              label: "Ce projet",
                              body: "Il n'est pas touché : ni index.ts, ni package.json, ni redémarrage à prévoir.",
                            },
                          ]
                        : [
                            {
                              label: "Après la génération",
                              body: "Un module n'est chargeable qu'une fois installé (lien de workspace npm) ET le serveur redémarré — le kernel lit les modules au boot.",
                            },
                            {
                              label: "Entités",
                              body: "La table naît au prochain démarrage en développement (CREATE TABLE IF NOT EXISTS). Modifier une entité existante n'altère AUCUNE table : le moteur ne produit pas de migration.",
                            },
                          ]
                    }
                  />
                </Group>
              </Stack>
            </Alert>

            {/* ── Étape 1 — quoi créer ─────────────────────────────────── */}
            <Stack gap="xs">
              <Group gap="xs">
                <Badge variant="light" color="brand">
                  1
                </Badge>
                <Text fw={600}>Que voulez-vous créer ?</Text>
              </Group>
              <Grid>
                {spec.specs.map((s) => (
                  <TypeCard
                    key={s.type}
                    spec={s}
                    selected={s.type === type}
                    onSelect={selectType}
                  />
                ))}
              </Grid>
            </Stack>

            {typeSpec && (
              <>
                {/* ── Étape 2 — le formulaire, généré depuis la spec ────── */}
                <Stack gap="xs">
                  <Group gap="xs">
                    <Badge variant="light" color="brand">
                      2
                    </Badge>
                    <Text fw={600}>Réglages</Text>
                    <DocHint
                      title="Formulaire généré, pas écrit"
                      summary="Ces champs viennent des questions du moteur de scaffold — les mêmes que celles posées par le CLI. Une question ajoutée au moteur apparaît ici sans qu'une ligne de front ne change."
                      sections={[
                        {
                          label: "Validation",
                          body: "Les formes attendues (kebab-case, PascalCase, chemin absolu…) sont celles déclarées par le moteur. Le serveur revalide de toute façon : il reste l'autorité.",
                        },
                      ]}
                    />
                  </Group>
                  <Paper withBorder p="md">
                    <CreateForm
                      spec={typeSpec}
                      answers={answers}
                      errors={errors}
                      targets={spec.targets}
                      caps={caps}
                      onChange={changeAnswer}
                    />
                  </Paper>
                </Stack>

                {/* ── Étape 3 (app SEULEMENT) — où l'application va naître ─ */}
                {isApp && (
                  <Stack gap="xs">
                    <Group gap="xs">
                      <Badge variant="light" color="brand">
                        3
                      </Badge>
                      <Text fw={600}>Emplacement d'installation</Text>
                    </Group>
                    <CreateDestination
                      roots={roots}
                      rootId={rootId}
                      subPath={subPath}
                      name={
                        typeof answers.name === "string" ? answers.name : ""
                      }
                      onRootChange={(next) => {
                        setRootId(next);
                        // Changer d'espace de travail réinitialise le dossier : un
                        // sous-chemin d'une autre racine n'a aucun sens (et n'existe
                        // probablement pas).
                        setSubPath("");
                      }}
                      onSubPathChange={setSubPath}
                    />
                  </Stack>
                )}

                {/* ── Dernière étape — ce qu'on enchaîne APRÈS l'écriture ── */}
                <Stack gap="xs">
                  <Group gap="xs">
                    <Badge variant="light" color="brand">
                      {isApp ? 4 : 3}
                    </Badge>
                    <Text fw={600}>Après l'écriture</Text>
                  </Group>
                  <Paper withBorder p="md">
                    <Stack gap="sm">
                      <Text size="sm" c="dimmed">
                        {isApp ? (
                          <>
                            Une application naît avec son propre{" "}
                            <Code>package.json</Code> : sans{" "}
                            <Code>npm install</Code>, elle n'est pas lançable.
                            Les étapes tournent DANS le dossier de la nouvelle
                            app — jamais dans ce projet.
                          </>
                        ) : (
                          <>
                            Sans <Code>npm install</Code>, un module tout juste
                            créé n'est pas résolvable par le kernel : il
                            l'importe par son NOM, et c'est le lien de workspace
                            posé par l'installation qui rend ce nom résolvable.
                          </>
                        )}
                      </Text>
                      {spec.steps.map((s) => {
                        const meta = stepLabel(s);
                        return (
                          <Group key={s} gap="xs">
                            <Checkbox
                              label={meta.label}
                              checked={steps.includes(s)}
                              onChange={(e) =>
                                toggleStep(s, e.currentTarget.checked)
                              }
                            />
                            <InfoHint text={meta.help} />
                          </Group>
                        );
                      })}
                      {/* Le piège qu'on ne voit qu'APRÈS coup sinon : une app sans câblage
                          local va chercher des paquets qui ne sont pas encore publiés →
                          `npm install` s'arrête sur un 404. Mieux vaut le dire avant. */}
                      {installRisk && (
                        <Alert
                          color="orange"
                          variant="light"
                          icon={<IconAlertTriangle size={16} />}
                          title="L'installation va probablement échouer"
                        >
                          <Text size="sm">{installRisk}</Text>
                        </Alert>
                      )}
                    </Stack>
                  </Paper>
                </Stack>

                <Group>
                  <Button
                    leftSection={<IconWand size={16} />}
                    disabled={running}
                    onClick={openConfirm}
                  >
                    Générer
                  </Button>
                  {running && (
                    <Text size="sm" c="dimmed">
                      Une génération est en cours — attendez la fin ou
                      arrêtez-la.
                    </Text>
                  )}
                </Group>
              </>
            )}

            {/* Terminal + abonnement : montés SEULEMENT quand un job existe (l'abonnement
                est ref-compté → aucun canal ouvert tant qu'il n'y a rien à regarder). */}
            {job && (
              <Paper withBorder p="md">
                <JobStream jobId={job.id} onEvent={onEvent} />
                <CreateTerminal
                  job={job}
                  lines={lines}
                  onCancel={() => void cancel()}
                  cancelling={cancelling}
                />
              </Paper>
            )}
          </Stack>
        )}
      </DataState>

      {/* Confirmation — dernier point d'arrêt AVANT une écriture irréversible. */}
      <Modal
        opened={confirm}
        onClose={() => setConfirm(false)}
        title="Confirmer la génération"
        centered
      >
        {typeSpec && (
          <Stack gap="md">
            <Alert
              color="orange"
              variant="light"
              icon={<IconAlertTriangle size={16} />}
            >
              {isApp ? (
                <Text size="sm">
                  Une application va être créée dans{" "}
                  <Code>{destination.path ?? destination.label}</Code>. Ce
                  projet n'est pas modifié. Il n'y a pas de simulation, et pas
                  de retour en arrière automatique.
                </Text>
              ) : (
                <Text size="sm">
                  Des fichiers vont être écrits dans{" "}
                  <Code>{spec?.projectRoot}</Code> et le projet va être modifié.
                  Il n'y a pas de simulation, et pas de retour en arrière
                  automatique.
                </Text>
              )}
            </Alert>

            <Stack gap={4}>
              <Text size="sm" fw={600}>
                {typeSpec.type}
              </Text>
              {typeSpec.questions
                // `answers` compris : récapituler une question que le moteur va
                // ramener au défaut annoncerait un choix qu'il ignore.
                .filter((q) => isQuestionVisible(q, caps, answers))
                .map((q) => (
                  <Group
                    key={q.key}
                    justify="space-between"
                    gap="xs"
                    wrap="nowrap"
                  >
                    <Text size="sm" c="dimmed" style={{ flex: 1 }}>
                      {q.label}
                    </Text>
                    <Code>{formatAnswer(q, answers[q.key])}</Code>
                  </Group>
                ))}
              {/* La destination n'est pas une question du moteur — elle se récapitule
                  quand même : c'est LE fait qui décide où l'app va naître. */}
              {isApp && (
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Text size="sm" c="dimmed" style={{ flex: 1 }}>
                    Destination
                  </Text>
                  <Code>{destination.label}</Code>
                </Group>
              )}
            </Stack>

            <Stack gap={4}>
              <Text size="sm" fw={600}>
                Étapes enchaînées
              </Text>
              <Text size="sm" c="dimmed">
                {steps.length === 0
                  ? "Aucune — les fichiers seront seulement écrits."
                  : steps.map((s) => stepLabel(s).label).join(" · ")}
              </Text>
              {/* Dernier rappel avant l'écriture : les fichiers seront bien écrits, mais
                  l'installation, elle, va casser. Le dire ici évite de le découvrir dans
                  le terminal. */}
              {installRisk && (
                <Text size="sm" c="orange">
                  {installRisk}
                </Text>
              )}
            </Stack>

            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirm(false)}>
                Annuler
              </Button>
              <Button
                color="orange"
                loading={submitting}
                leftSection={<IconWand size={16} />}
                onClick={() => void run()}
              >
                Écrire sur le disque
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </PageLayout>
  );
}
