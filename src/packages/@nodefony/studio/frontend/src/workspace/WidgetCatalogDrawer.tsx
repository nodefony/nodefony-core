import { observer } from "mobx-react-lite";
import { useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Chip,
  Group,
  HoverCard,
  Modal,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconCheck,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react";
import { useAuth, useWorkspace } from "../stores";
import { listWidgets } from "./registry";
import type { IWidgetDef } from "./types";
import {
  getTag,
  tagsOfGroup,
  widgetCapabilities,
  type WidgetTag,
} from "./tags";
import { BlockBody, useBlockSource } from "../blocks/useBlockSource";

// Boîte au format paysage 16/9 (≈1280×720), bornée au viewport.
const BOX_W = "min(1280px, 95vw)";
const BOX_H = "min(720px, 90vh)";

/** Normalise pour la recherche : sans accents, minuscule (« mémo » ≡ « memo »). */
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Un bloc porte-t-il ce tag ? */
function hasTag(def: IWidgetDef, id: string): boolean {
  return (def.tags ?? []).includes(id);
}

/**
 * Aperçu LIVE du widget — le VRAI bloc rendu via le cœur partagé (`useBlockSource` +
 * `BlockBody`). Monté au survol seulement (dropdown HoverCard lazy) → 1 abonnement à
 * la fois, ref-compté (libéré quand on quitte).
 */
function WidgetPreview({ def, roles }: { def: IWidgetDef; roles: string[] }) {
  const state = useBlockSource(def.source, true);
  return (
    <Box
      style={{
        height: 230,
        overflow: "auto",
        padding: 8,
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: 8,
        background: "var(--mantine-color-body)",
      }}
    >
      <BlockBody
        def={def}
        state={state}
        ctx={{ live: true, cluster: false, instanceCount: 1, roles }}
        span={6}
        container="widget"
      />
    </Box>
  );
}

/** Chips des capacités DÉRIVÉES d'un bloc (cluster-ready / temps réel). */
function CapabilityChips({ def }: { def: IWidgetDef }) {
  const cap = widgetCapabilities(def);
  return (
    <>
      {cap.clusterReady ? (
        <Badge size="xs" variant="light" color="grape">
          cluster-ready
        </Badge>
      ) : null}
      {cap.realtime ? (
        <Badge size="xs" variant="light" color="teal">
          temps réel
        </Badge>
      ) : null}
    </>
  );
}

/**
 * Carte du catalogue — au SURVOL, fiche avec **aperçu en direct** + tags + capacités.
 * Clic (carte ou bouton) = toggle ajouter/retirer du bureau actif.
 */
function CatalogCard({
  def,
  onBoard,
  roles,
  onToggle,
}: {
  def: IWidgetDef;
  onBoard: boolean;
  roles: string[];
  onToggle: () => void;
}) {
  const Icon = def.icon;
  const tagDefs = (def.tags ?? [])
    .map(getTag)
    .filter((t): t is WidgetTag => !!t);
  return (
    <HoverCard
      width={400}
      position="right"
      openDelay={220}
      closeDelay={80}
      withinPortal
      shadow="md"
      radius="md"
    >
      <HoverCard.Target>
        <UnstyledButton
          aria-pressed={onBoard}
          onClick={onToggle}
          style={{ height: "100%" }}
        >
          <Stack
            gap={6}
            p="sm"
            h="100%"
            style={{
              border: `1px solid ${
                onBoard
                  ? "var(--mantine-color-teal-5)"
                  : "var(--mantine-color-default-border)"
              }`,
              borderRadius: 10,
              background: onBoard
                ? "var(--mantine-color-teal-light)"
                : undefined,
            }}
          >
            <Group gap="sm" wrap="nowrap" align="flex-start">
              <ThemeIcon
                variant="light"
                color={onBoard ? "teal" : "gray"}
                radius="md"
              >
                <Icon size={16} />
              </ThemeIcon>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" fw={600} truncate>
                  {def.title}
                </Text>
                <Text size="xs" c="dimmed" lineClamp={2}>
                  {def.description}
                </Text>
              </div>
              <ThemeIcon
                variant={onBoard ? "filled" : "light"}
                color={onBoard ? "teal" : "blue"}
                radius="xl"
                size="sm"
              >
                {onBoard ? <IconCheck size={14} /> : <IconPlus size={14} />}
              </ThemeIcon>
            </Group>
            <Group gap={4} wrap="wrap">
              <CapabilityChips def={def} />
              {tagDefs.map((t) => (
                <Badge key={t.id} size="xs" variant="default">
                  {t.label}
                </Badge>
              ))}
            </Group>
          </Stack>
        </UnstyledButton>
      </HoverCard.Target>
      <HoverCard.Dropdown p="sm">
        <Stack gap="sm">
          <Group gap="xs" wrap="wrap">
            <ThemeIcon variant="light" color="gray" radius="md" size="sm">
              <Icon size={15} />
            </ThemeIcon>
            <Text fw={700} size="sm">
              {def.title}
            </Text>
            <CapabilityChips def={def} />
          </Group>
          <Text size="xs" c="dimmed">
            {def.description}
          </Text>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed">
            Aperçu en direct
          </Text>
          <WidgetPreview def={def} roles={roles} />
          <Button
            size="xs"
            fullWidth
            variant={onBoard ? "light" : "filled"}
            color={onBoard ? "red" : "blue"}
            leftSection={
              onBoard ? <IconCheck size={14} /> : <IconPlus size={14} />
            }
            onClick={onToggle}
          >
            {onBoard ? "Retirer du bureau" : "Ajouter au bureau"}
          </Button>
        </Stack>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

const ALL = "all";

/**
 * Catalogue de BLOCS — boîte **16/9** (paysage), classée à **facettes** :
 * Domaine (thème → sous-thème) + Nature + capacités (cluster-ready / temps réel),
 * recherche tolérante, **aperçu en direct au survol**. Filtré par rôle ; clic = toggle.
 */
export const WidgetCatalogDrawer = observer(
  ({ opened, onClose }: { opened: boolean; onClose: () => void }) => {
    const workspace = useWorkspace();
    const auth = useAuth();
    const all = listWidgets(auth.roles);
    const [search, setSearch] = useState("");
    const [full, setFull] = useState(false);
    const [domain, setDomain] = useState<string>(ALL);
    const [sub, setSub] = useState<string>(ALL);
    const [nature, setNature] = useState<string>(ALL);
    const [capCluster, setCapCluster] = useState(false);
    const [capRealtime, setCapRealtime] = useState(false);

    const domains = useMemo(
      () => tagsOfGroup("domaine").filter((t) => !t.parent),
      [],
    );
    const subTags = useMemo(
      () => (domain === ALL ? [] : tagsOfGroup("domaine", domain)),
      [domain],
    );
    const natures = useMemo(() => tagsOfGroup("nature"), []);

    // Recherche tolérante : sans accents + MULTI-termes (tous) sur titre + desc + tags.
    const q = search.trim();
    const visible = useMemo(() => {
      const terms = norm(q).split(/\s+/).filter(Boolean);
      return all.filter((w) => {
        if (domain !== ALL && !hasTag(w, domain)) return false;
        if (sub !== ALL && !hasTag(w, sub)) return false;
        if (nature !== ALL && !hasTag(w, nature)) return false;
        const cap = widgetCapabilities(w);
        if (capCluster && !cap.clusterReady) return false;
        if (capRealtime && !cap.realtime) return false;
        if (terms.length) {
          const hay = norm(
            `${w.title} ${w.description} ${(w.tags ?? [])
              .map((t) => getTag(t)?.label ?? "")
              .join(" ")}`,
          );
          if (!terms.every((t) => hay.includes(t))) return false;
        }
        return true;
      });
    }, [all, q, domain, sub, nature, capCluster, capRealtime]);

    const countDomain = (id: string) => all.filter((w) => hasTag(w, id)).length;

    return (
      <Modal
        opened={opened}
        onClose={onClose}
        centered
        radius="md"
        size="auto"
        fullScreen={full}
        title={
          <Group gap="xs">
            <Text fw={700}>Catalogue de blocs</Text>
            <Badge variant="light" color="gray">
              {all.length}
            </Badge>
            <Tooltip label={full ? "Réduire (16/9)" : "Plein écran"} withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={() => setFull((f) => !f)}
                aria-label={
                  full ? "Réduire la fenêtre" : "Passer en plein écran"
                }
              >
                {full ? (
                  <IconArrowsMinimize size={16} />
                ) : (
                  <IconArrowsMaximize size={16} />
                )}
              </ActionIcon>
            </Tooltip>
          </Group>
        }
        styles={{
          content: {
            display: "flex",
            flexDirection: "column",
            ...(full ? {} : { width: BOX_W, height: BOX_H }),
          },
          header: { flexShrink: 0 },
          body: {
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          },
        }}
      >
        <Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
          <TextInput
            placeholder="Rechercher un bloc (titre, description, tag)…"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            aria-label="Rechercher un bloc dans le catalogue"
          />

          {/* Facette DOMAINE (thèmes). */}
          <Chip.Group
            value={domain}
            onChange={(v) => {
              setDomain((v as string) || ALL);
              setSub(ALL);
            }}
          >
            <Group gap={6} wrap="wrap">
              <Chip value={ALL} size="xs" variant="light">
                Tous ({all.length})
              </Chip>
              {domains.map((d) => (
                <Chip key={d.id} value={d.id} size="xs" variant="light">
                  {d.label} ({countDomain(d.id)})
                </Chip>
              ))}
            </Group>
          </Chip.Group>

          {/* Sous-thèmes du domaine sélectionné. */}
          {subTags.length > 0 ? (
            <Chip.Group
              value={sub}
              onChange={(v) => setSub((v as string) || ALL)}
            >
              <Group gap={6} wrap="wrap" pl="md">
                <Chip value={ALL} size="xs">
                  Tout {getTag(domain)?.label}
                </Chip>
                {subTags.map((s) => (
                  <Chip key={s.id} value={s.id} size="xs">
                    {s.label}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          ) : null}

          {/* Nature + capacités. */}
          <Group gap="md" wrap="wrap">
            <Chip.Group
              value={nature}
              onChange={(v) => setNature((v as string) || ALL)}
            >
              <Group gap={6} wrap="wrap">
                <Text size="xs" c="dimmed" fw={600}>
                  Nature
                </Text>
                <Chip value={ALL} size="xs" variant="outline">
                  Toutes
                </Chip>
                {natures.map((n) => (
                  <Chip key={n.id} value={n.id} size="xs" variant="outline">
                    {n.label}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
            <Group gap={6} wrap="nowrap">
              <Chip
                checked={capCluster}
                onChange={setCapCluster}
                size="xs"
                color="grape"
              >
                cluster-ready
              </Chip>
              <Chip
                checked={capRealtime}
                onChange={setCapRealtime}
                size="xs"
                color="teal"
              >
                temps réel
              </Chip>
            </Group>
          </Group>

          <ScrollArea style={{ flex: 1 }} type="auto">
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm" pr="xs">
              {visible.map((w) => (
                <CatalogCard
                  key={w.id}
                  def={w}
                  roles={auth.roles}
                  onBoard={workspace.hasWidget(w.id)}
                  onToggle={() =>
                    workspace.hasWidget(w.id)
                      ? workspace.removeWidget(w.id)
                      : workspace.addWidget(w.id)
                  }
                />
              ))}
            </SimpleGrid>
            {visible.length === 0 ? (
              <Text c="dimmed" size="sm" py="xl" ta="center">
                Aucun bloc pour ces filtres.
              </Text>
            ) : null}
          </ScrollArea>
        </Stack>
      </Modal>
    );
  },
);
