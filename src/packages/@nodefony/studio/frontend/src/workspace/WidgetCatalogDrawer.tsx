import { observer } from "mobx-react-lite";
import { useMemo, useState } from "react";
import {
  Badge,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import { IconCheck, IconPlus, IconSearch } from "@tabler/icons-react";
import { useAuth, useWorkspace } from "../stores";
import { listWidgets } from "./registry";
import { WIDGET_CATEGORY_LABEL } from "./types";
import type { IWidgetDef, WidgetCategory } from "./types";

const ALL = "all";

/** Une entrée du catalogue — toggle ajouter/retirer du bureau actif. */
function CatalogItem({
  def,
  onBoard,
  onToggle,
}: {
  def: IWidgetDef;
  onBoard: boolean;
  onToggle: () => void;
}) {
  const Icon = def.icon;
  return (
    <UnstyledButton aria-pressed={onBoard} onClick={onToggle}>
      <Group
        gap="sm"
        wrap="nowrap"
        p="xs"
        style={{
          border: "1px solid var(--mantine-color-default-border)",
          borderRadius: 8,
          background: onBoard ? "var(--mantine-color-teal-light)" : undefined,
        }}
      >
        <ThemeIcon
          variant="light"
          color={onBoard ? "teal" : "gray"}
          radius="md"
        >
          <Icon size={16} />
        </ThemeIcon>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6}>
            <Text size="sm" fw={600}>
              {def.title}
            </Text>
            {def.clusterAware ? (
              <Badge size="xs" variant="light" color="grape">
                cluster
              </Badge>
            ) : null}
          </Group>
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
    </UnstyledButton>
  );
}

/**
 * Catalogue de BLOCS — le « magasin d'apps » du bureau, agencé en **onglets par
 * thème** (catégorie) + **recherche**. Filtré par rôle ; clic = ajoute/retire du
 * bureau actif (toggle). Boîte de dialogue centrée (pas de drawer). À mesure que
 * des contenus deviennent des blocs, ils apparaissent ici dans leur thème.
 */
export const WidgetCatalogDrawer = observer(
  ({ opened, onClose }: { opened: boolean; onClose: () => void }) => {
    const workspace = useWorkspace();
    const auth = useAuth();
    const all = listWidgets(auth.roles);
    const [search, setSearch] = useState("");
    const [tab, setTab] = useState<string>(ALL);

    const q = search.trim().toLowerCase();
    const matched = useMemo(
      () =>
        q
          ? all.filter(
              (w) =>
                w.title.toLowerCase().includes(q) ||
                w.description.toLowerCase().includes(q),
            )
          : all,
      [all, q],
    );

    // Thèmes (catégories) présents dans la liste filtrée → onglets.
    const cats = useMemo(() => {
      const set = new Set<WidgetCategory>();
      for (const w of matched) set.add(w.category);
      return [...set].sort((a, b) =>
        WIDGET_CATEGORY_LABEL[a].localeCompare(WIDGET_CATEGORY_LABEL[b]),
      );
    }, [matched]);

    const visible =
      tab === ALL ? matched : matched.filter((w) => w.category === tab);

    return (
      <Modal
        opened={opened}
        onClose={onClose}
        size="xl"
        centered
        radius="md"
        title={
          <Group gap="xs">
            <Text fw={700}>Catalogue de blocs</Text>
            <Badge variant="light" color="gray">
              {all.length}
            </Badge>
          </Group>
        }
      >
        <Stack gap="sm">
          <TextInput
            placeholder="Rechercher un bloc…"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            aria-label="Rechercher un bloc dans le catalogue"
          />
          <Tabs
            value={tab}
            onChange={(v) => setTab(v ?? ALL)}
            variant="pills"
            keepMounted={false}
          >
            <Tabs.List>
              <Tabs.Tab
                value={ALL}
                rightSection={
                  <Badge size="xs" variant="light" circle>
                    {matched.length}
                  </Badge>
                }
              >
                Tous
              </Tabs.Tab>
              {cats.map((c) => (
                <Tabs.Tab
                  key={c}
                  value={c}
                  rightSection={
                    <Badge size="xs" variant="light" circle>
                      {matched.filter((w) => w.category === c).length}
                    </Badge>
                  }
                >
                  {WIDGET_CATEGORY_LABEL[c]}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>
          <ScrollArea.Autosize mah="55vh">
            <Stack gap="xs">
              {visible.map((w) => (
                <CatalogItem
                  key={w.id}
                  def={w}
                  onBoard={workspace.hasWidget(w.id)}
                  onToggle={() =>
                    workspace.hasWidget(w.id)
                      ? workspace.removeWidget(w.id)
                      : workspace.addWidget(w.id)
                  }
                />
              ))}
              {visible.length === 0 ? (
                <Text c="dimmed" size="sm" py="md" ta="center">
                  Aucun bloc{q ? ` pour « ${search} »` : ""}.
                </Text>
              ) : null}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      </Modal>
    );
  },
);
