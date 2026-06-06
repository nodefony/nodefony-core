import { observer } from "mobx-react-lite";
import {
  ActionIcon,
  Box,
  Card,
  Group,
  Menu,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { IconDotsVertical, IconGripVertical, IconX } from "@tabler/icons-react";
import { useWorkspace } from "../stores";
import { BlockBody, useBlockSource } from "../blocks/useBlockSource";
import type {
  GridPointerHandlers,
  IWidgetDef,
  WidgetInstance,
  WidgetRuntimeContext,
} from "./types";
import { REF_COLS, WIDGET_CATEGORY_LABEL } from "./types";

export interface WidgetHostProps {
  def: IWidgetDef;
  instance: WidgetInstance;
  ctx: WidgetRuntimeContext;
  /** Poignée de DRAG (fournie par la grille) — spread sur l'en-tête. */
  dragHandlers?: GridPointerHandlers;
  /** Poignée de RESIZE (fournie par la grille) — spread sur le coin bas-droit. */
  resizeHandlers?: GridPointerHandlers;
}

/**
 * Enveloppe WIDGET d'un bloc — la Card du bureau (en-tête = poignée de glisse +
 * menu, coin = poignée de redimensionnement). L'INTERACTION (drag/resize au
 * pointeur, snap + anti-collision + commit) est orchestrée par `WidgetGrid` qui
 * connaît la géométrie ; ici on n'expose que les **poignées**. Le CONTENU est
 * délégué au cœur partagé `useBlockSource` + `BlockBody` (même bloc que le dialog
 * du Jumeau et les panneaux de page). Un bloc écrit une fois, trois contenants.
 */
export const WidgetHost = observer(
  ({ def, instance, ctx, dragHandlers, resizeHandlers }: WidgetHostProps) => {
    const workspace = useWorkspace();
    const state = useBlockSource(def.source, ctx.live);
    const Icon = def.icon;
    const isLiveSource = def.source.kind !== "snapshot";

    return (
      <Card
        withBorder
        radius="md"
        p="sm"
        h="100%"
        style={{
          contain: "content",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <Group
          justify="space-between"
          wrap="nowrap"
          mb="xs"
          style={{ flexShrink: 0 }}
        >
          <Group
            gap="xs"
            wrap="nowrap"
            style={{
              minWidth: 0,
              cursor: dragHandlers ? "grab" : undefined,
              touchAction: "none",
            }}
            {...dragHandlers}
          >
            {dragHandlers ? (
              <IconGripVertical
                size={14}
                style={{ opacity: 0.45, flexShrink: 0 }}
              />
            ) : null}
            <ThemeIcon variant="light" color="gray" size="sm" radius="md">
              <Icon size={15} />
            </ThemeIcon>
            <Text fw={600} size="sm" truncate>
              {def.title}
            </Text>
            {isLiveSource ? (
              <Box
                aria-hidden
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: state.source.fromLive
                    ? "var(--mantine-color-teal-6)"
                    : "var(--mantine-color-gray-5)",
                }}
              />
            ) : null}
          </Group>
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label="Options du widget"
              >
                <IconDotsVertical size={15} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>{WIDGET_CATEGORY_LABEL[def.category]}</Menu.Label>
              <Menu.Item
                color="red"
                leftSection={<IconX size={14} />}
                onClick={() => workspace.removeWidget(def.id)}
              >
                Retirer du bureau
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>

        <Box style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <BlockBody
            def={def}
            state={state}
            ctx={ctx}
            span={Math.max(
              1,
              Math.min(REF_COLS, Math.round(instance.w * REF_COLS)),
            )}
            container="widget"
          />
        </Box>

        {/* Poignée de redimensionnement (coin bas-droit) — largeur + hauteur. */}
        {resizeHandlers ? (
          <Box
            aria-hidden
            {...resizeHandlers}
            style={{
              position: "absolute",
              right: 3,
              bottom: 3,
              width: 14,
              height: 14,
              cursor: "nwse-resize",
              touchAction: "none",
              borderRight: "2px solid var(--mantine-color-dimmed)",
              borderBottom: "2px solid var(--mantine-color-dimmed)",
              borderBottomRightRadius: 4,
              opacity: 0.5,
            }}
          />
        ) : null}
      </Card>
    );
  },
);
