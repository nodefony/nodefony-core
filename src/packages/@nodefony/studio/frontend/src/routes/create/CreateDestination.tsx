/**
 * CreateDestination — **où** une nouvelle application va naître.
 *
 * Ce panneau n'existe que pour le type `app` : les quatre autres types écrivent dans le
 * projet courant, qui n'est pas un choix. Une app, elle, naît AILLEURS — dans un espace de
 * travail voisin — et l'utilisateur doit voir EXACTEMENT où avant de confirmer.
 *
 * ## Pourquoi un explorateur, et pas un champ « chemin »
 *
 * Un navigateur ne sait pas désigner un dossier SERVEUR (et `showDirectoryPicker()` rend un
 * handle côté client, dans lequel le serveur ne peut rien écrire). Un champ texte libre,
 * lui, serait une porte ouverte : un endpoint qui écrit au chemin qu'on lui donne écrit
 * aussi dans `~/.ssh`. Alors on explore côté serveur, mais **borné** — le front ne manipule
 * que des **identifiants** de racine et des **noms de dossiers** que le serveur vient de
 * rendre. Ce qui part sur la socket : `root` (id) + `subPath` (relatif), jamais un chemin.
 *
 * Le serveur refuse de toute façon tout le reste (`resolveScaffoldDestination`) : ce
 * composant rend le bon chemin ÉVIDENT, il n'est pas ce qui protège.
 */
import { useCallback, type CSSProperties } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Breadcrumbs,
  Button,
  Code,
  Group,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconChevronRight,
  IconFolder,
  IconFolderOpen,
  IconHome,
} from "@tabler/icons-react";
import { useStore } from "../../stores";
import { useResource } from "../../hooks";
import { ApiError } from "../../services/ApiClient";
import { DataState, DocHint } from "../../components/ui";
import {
  describeDestination,
  joinSub,
  subSegments,
  subUpTo,
  type IScaffoldBrowse,
  type IScaffoldRoot,
} from "./createModel";

const BROWSE_URL = "/nodefony/studio/api/create/browse";

/** Au-delà de ce nombre de racines, une liste déroulante vaut mieux qu'une rangée de boutons. */
const MAX_SEGMENTED_ROOTS = 3;

/** Style statique hissé (jamais recréé à chaque rendu) — icône + libellé de la racine. */
const ROOT_CRUMB_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

/**
 * Message d'un refus d'exploration — le serveur répond `400 {error}` (racine inconnue,
 * sous-dossier refusé). On préfère SA phrase à un « HTTP 400 » qui n'apprend rien.
 */
function describeBrowseError(e: unknown): string {
  if (e instanceof ApiError) {
    const body = e.body as { error?: unknown } | null;
    if (body && typeof body.error === "string" && body.error) return body.error;
  }
  if (e instanceof Error && e.message) return e.message;
  return "Exploration impossible.";
}

export interface CreateDestinationProps {
  /** Emplacements autorisés, servis par `create/spec`. */
  roots: IScaffoldRoot[];
  /** Racine choisie (`null` tant qu'aucune n'est retenue — ou si le serveur n'en propose pas). */
  rootId: string | null;
  /** Sous-dossier courant, relatif à la racine (`""` = la racine elle-même). */
  subPath: string;
  /** Nom saisi dans le formulaire (question `name`) — c'est le dernier segment de la destination. */
  name: string;
  onRootChange: (rootId: string) => void;
  onSubPathChange: (subPath: string) => void;
}

export function CreateDestination({
  roots,
  rootId,
  subPath,
  name,
  onRootChange,
  onSubPathChange,
}: CreateDestinationProps) {
  const store = useStore();

  // L'exploration est REFAITE à chaque changement de racine ou de dossier : c'est le
  // serveur qui dit ce qui existe, jamais un cache que le disque aurait démenti entre-temps.
  const fetcher = useCallback(async (): Promise<IScaffoldBrowse> => {
    if (rootId === null) return { sub: "", dirs: [] };
    const query = new URLSearchParams({ root: rootId, sub: subPath });
    try {
      return await store.api.getAbsolute<IScaffoldBrowse>(
        `${BROWSE_URL}?${query.toString()}`,
      );
    } catch (e) {
      throw new Error(describeBrowseError(e), { cause: e });
    }
  }, [store, rootId, subPath]);
  const { data, loading, error, reload } = useResource(fetcher);

  const root = roots.find((r) => r.id === rootId) ?? null;
  const dirs = data?.dirs ?? [];
  const segments = subSegments(subPath);
  const destination = describeDestination(root, subPath, name);

  // Le serveur ne propose aucun emplacement : on le DIT (une page muette laisserait croire
  // à un bug du navigateur), et on n'invente surtout pas de chemin de repli.
  if (roots.length === 0) {
    return (
      <Alert
        color="orange"
        variant="light"
        icon={<IconAlertTriangle size={16} />}
        title="Aucun emplacement d'installation"
      >
        <Text size="sm">
          Le serveur ne déclare aucun espace de travail où créer une
          application. Déclarez-en un dans la configuration du module Studio (
          <Code>scaffold.roots</Code>), puis rechargez.
        </Text>
      </Alert>
    );
  }

  return (
    <Paper withBorder p="md">
      <Stack gap="md">
        {/* ── L'espace de travail ─────────────────────────────────────────── */}
        <Stack gap={6}>
          <Group gap="xs">
            <Text size="sm" fw={600}>
              Espace de travail
            </Text>
            <DocHint
              title="Une app naît hors du projet"
              summary="Les emplacements proposés sont ceux que le serveur autorise — par défaut le dossier parent du projet courant, là où vivent déjà vos autres projets."
              sections={[
                {
                  label: "Ce que le navigateur envoie",
                  body: "L'identifiant de l'emplacement et un sous-dossier relatif — jamais un chemin. Le serveur recompose la destination et refuse tout ce qui sortirait de l'espace autorisé.",
                },
                {
                  label: "Pour en ajouter un",
                  body: "Configuration du module Studio, clé scaffold.roots (libellé + chemin).",
                },
              ]}
            />
          </Group>
          {roots.length > MAX_SEGMENTED_ROOTS ? (
            <Select
              aria-label="Espace de travail"
              data={roots.map((r) => ({ value: r.id, label: r.label }))}
              value={rootId ?? ""}
              onChange={(v) => v && onRootChange(v)}
              allowDeselect={false}
            />
          ) : (
            <SegmentedControl
              aria-label="Espace de travail"
              data={roots.map((r) => ({ value: r.id, label: r.label }))}
              value={rootId ?? roots[0]?.id ?? ""}
              onChange={onRootChange}
            />
          )}
          {root && (
            <Text size="xs" c="dimmed">
              <Code>{root.path}</Code>
            </Text>
          )}
        </Stack>

        {/* ── Le fil d'Ariane — remonter d'un clic ────────────────────────── */}
        <nav aria-label="Fil d'Ariane du dossier d'installation">
          <Breadcrumbs separator={<IconChevronRight size={12} />}>
            <Anchor
              component="button"
              type="button"
              size="sm"
              aria-label="Revenir à la racine de l'espace de travail"
              onClick={() => onSubPathChange("")}
              // Un <button> ne contient que du contenu de phrasé : pas de <div> ici (donc
              // pas de <Group>, qui en rend un) — un inline-flex fait le même travail.
              style={ROOT_CRUMB_STYLE}
            >
              <IconHome size={14} />
              <span>{root?.label ?? "Racine"}</span>
            </Anchor>
            {segments.map((segment, index) => (
              <Anchor
                key={`${segment}-${String(index)}`}
                component="button"
                type="button"
                size="sm"
                aria-label={`Remonter au dossier ${segment}`}
                onClick={() => onSubPathChange(subUpTo(subPath, index + 1))}
              >
                {segment}
              </Anchor>
            ))}
          </Breadcrumbs>
        </nav>

        {/* ── Les sous-dossiers — un clic descend ─────────────────────────── */}
        <DataState
          loading={loading}
          error={error}
          empty={!loading && !error && dirs.length === 0}
          onRetry={reload}
          minHeight={80}
          emptyMessage="Aucun sous-dossier ici — l'application naîtra directement dans ce dossier."
        >
          <Group gap="xs">
            {dirs.map((dir) => (
              <Button
                key={dir}
                variant="default"
                size="compact-sm"
                leftSection={<IconFolder size={14} />}
                aria-label={`Ouvrir le dossier ${dir}`}
                onClick={() => onSubPathChange(joinSub(subPath, dir))}
              >
                {dir}
              </Button>
            ))}
          </Group>
        </DataState>

        {/* ── La destination — ce que l'utilisateur DOIT voir avant de lancer ─ */}
        <Paper
          withBorder
          p="sm"
          bg="var(--mantine-color-default-hover)"
          aria-live="polite"
        >
          <Stack gap={6}>
            <Group gap="xs">
              <IconFolderOpen size={16} />
              <Text size="sm" fw={600}>
                L'application naîtra ici
              </Text>
              {destination.issue === null && (
                <Badge variant="light" color="teal" size="sm">
                  destination complète
                </Badge>
              )}
            </Group>
            <Code block>{destination.label}</Code>
            {destination.issue ? (
              <Text size="sm" c="orange">
                {destination.issue}
              </Text>
            ) : (
              destination.path && (
                <Text size="xs" c="dimmed">
                  Chemin sur le serveur : <Code>{destination.path}</Code>
                </Text>
              )
            )}
          </Stack>
        </Paper>
      </Stack>
    </Paper>
  );
}
