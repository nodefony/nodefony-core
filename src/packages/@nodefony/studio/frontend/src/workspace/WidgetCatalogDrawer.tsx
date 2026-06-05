import { observer } from "mobx-react-lite";
import {
  Badge,
  Drawer,
  Group,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import { IconCheck, IconPlus } from "@tabler/icons-react";
import { useAuth, useWorkspace } from "../stores";
import { listWidgets } from "./registry";
import { WIDGET_CATEGORY_LABEL } from "./types";
import type { IWidgetDef, WidgetCategory } from "./types";

/**
 * Catalogue de widgets — le « magasin d'apps ». Liste filtrée par rôle, groupée par
 * catégorie ; clic = ajoute/retire du bureau actif (toggle). C'est l'équivalent du
 * « bureau / tablette » où l'on pose les outils qu'on veut.
 */
export const WidgetCatalogDrawer = observer(
  ({ opened, onClose }: { opened: boolean; onClose: () => void }) => {
    const workspace = useWorkspace();
    const auth = useAuth();
    const widgets = listWidgets(auth.roles);

    const groups = new Map<WidgetCategory, IWidgetDef[]>();
    for (const w of widgets) {
      const arr = groups.get(w.category) ?? [];
      arr.push(w);
      groups.set(w.category, arr);
    }

    return (
      <Drawer
        opened={opened}
        onClose={onClose}
        position="right"
        size="md"
        title="Catalogue de widgets"
      >
        <ScrollArea h="calc(100vh - 90px)">
          <Stack gap="lg">
            {[...groups.entries()].map(([cat, list]) => (
              <div key={cat}>
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="xs">
                  {WIDGET_CATEGORY_LABEL[cat]}
                </Text>
                <Stack gap="xs">
                  {list.map((w) => {
                    const Icon = w.icon;
                    const onBoard = workspace.hasWidget(w.id);
                    return (
                      <UnstyledButton
                        key={w.id}
                        aria-pressed={onBoard}
                        onClick={() =>
                          onBoard
                            ? workspace.removeWidget(w.id)
                            : workspace.addWidget(w.id)
                        }
                      >
                        <Group
                          gap="sm"
                          wrap="nowrap"
                          p="xs"
                          style={{
                            border:
                              "1px solid var(--mantine-color-default-border)",
                            borderRadius: 8,
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
                                {w.title}
                              </Text>
                              {w.clusterAware ? (
                                <Badge size="xs" variant="light" color="grape">
                                  cluster
                                </Badge>
                              ) : null}
                            </Group>
                            <Text size="xs" c="dimmed" lineClamp={2}>
                              {w.description}
                            </Text>
                          </div>
                          <ThemeIcon
                            variant={onBoard ? "filled" : "light"}
                            color={onBoard ? "teal" : "blue"}
                            radius="xl"
                            size="sm"
                          >
                            {onBoard ? (
                              <IconCheck size={14} />
                            ) : (
                              <IconPlus size={14} />
                            )}
                          </ThemeIcon>
                        </Group>
                      </UnstyledButton>
                    );
                  })}
                </Stack>
              </div>
            ))}
            {widgets.length === 0 ? (
              <Text c="dimmed" size="sm">
                Aucun widget disponible pour vos rôles.
              </Text>
            ) : null}
          </Stack>
        </ScrollArea>
      </Drawer>
    );
  },
);
