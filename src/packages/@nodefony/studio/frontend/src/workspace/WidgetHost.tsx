import { observer } from "mobx-react-lite";
import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
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
import type { IWidgetDef, WidgetInstance, WidgetRuntimeContext } from "./types";
import { WIDGET_CATEGORY_LABEL } from "./types";

export interface WidgetHostProps {
  def: IWidgetDef;
  instance: WidgetInstance;
  ctx: WidgetRuntimeContext;
  /** Type MIME du drag interne — active la poignée de réorganisation si fourni. */
  dragMime?: string;
  /** Notifie la grille du widget en cours de glisse (indicateur d'insertion). */
  onDragChange?: (id: string | null) => void;
}

/**
 * Enveloppe WIDGET d'un bloc — la Card du bureau (en-tête poignée de glisse +
 * menu, coin de redimensionnement). Le CONTENU (données + rendu) est délégué au
 * cœur partagé `useBlockSource` + `BlockBody` : exactement le même que le dialog
 * du Jumeau et les panneaux de page. Un bloc écrit une fois, trois contenants.
 */
export const WidgetHost = observer(
  ({ def, instance, ctx, dragMime, onDragChange }: WidgetHostProps) => {
    const workspace = useWorkspace();
    const cardRef = useRef<HTMLDivElement | null>(null);

    const state = useBlockSource(def.source, ctx.live);
    const Icon = def.icon;
    const isLiveSource = def.source.kind !== "snapshot";

    // Redimensionnement par le coin : delta px → colonnes (largeur) + rangées (hauteur).
    const onResizeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = cardRef.current?.getBoundingClientRect();
      if (!rect) return;
      const colW = rect.width / Math.max(1, instance.span);
      const rowH = rect.height / Math.max(1, instance.h);
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = instance.span;
      const startH = instance.h;
      const move = (ev: PointerEvent) => {
        const w = startW + Math.round((ev.clientX - startX) / colW);
        const h = startH + Math.round((ev.clientY - startY) / rowH);
        workspace.setSize(def.id, w, h);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.userSelect = "";
      };
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };

    return (
      <Card
        ref={cardRef}
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
            style={{ minWidth: 0, cursor: dragMime ? "grab" : undefined }}
            draggable={!!dragMime}
            onDragStart={
              dragMime
                ? (e) => {
                    e.dataTransfer.setData(dragMime, def.id);
                    e.dataTransfer.effectAllowed = "move";
                    if (cardRef.current)
                      e.dataTransfer.setDragImage(cardRef.current, 24, 16);
                    onDragChange?.(def.id);
                  }
                : undefined
            }
            onDragEnd={dragMime ? () => onDragChange?.(null) : undefined}
          >
            {dragMime ? (
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
            span={instance.span}
            container="widget"
          />
        </Box>

        {/* Poignée de redimensionnement (coin bas-droit) — largeur + hauteur. */}
        <Box
          aria-hidden
          onPointerDown={onResizeDown}
          style={{
            position: "absolute",
            right: 3,
            bottom: 3,
            width: 12,
            height: 12,
            cursor: "nwse-resize",
            borderRight: "2px solid var(--mantine-color-dimmed)",
            borderBottom: "2px solid var(--mantine-color-dimmed)",
            borderBottomRightRadius: 4,
            opacity: 0.5,
          }}
        />
      </Card>
    );
  },
);
