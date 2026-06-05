import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { useStore, useWorkspace } from "../stores";
import { useResource } from "../hooks";
import { useNodefonyChannelData } from "nodefony/react";
import { DataState } from "../components/ui";
import type {
  IWidgetDef,
  WidgetData,
  WidgetInstance,
  WidgetRuntimeContext,
} from "./types";
import { WIDGET_CATEGORY_LABEL } from "./types";

/** Monté SEULEMENT quand le live est ON → abonnement ref-compté, unsubscribe auto. */
function LiveFeed({
  channel,
  onData,
}: {
  channel: string;
  onData: (d: unknown) => void;
}) {
  const d = useNodefonyChannelData<unknown>(channel);
  useEffect(() => {
    if (d != null) onData(d);
  }, [d, onData]);
  return null;
}

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
 * Cadre commun d'un widget — encode le PATTERN « sonde + hub » une seule fois :
 * snapshot HTTP au 1ᵉʳ paint, abonnement live CONDITIONNEL (monté ssi `ctx.live`),
 * fallback, `DataState`, `contain`. Le widget = rendu pur.
 *
 * Manipulation : l'**en-tête** est la poignée de glisse (fantôme = la carte) ; le
 * **coin bas-droit** redimensionne (largeur ET hauteur, en direct). Le corps défile si
 * le contenu dépasse la taille choisie.
 */
export const WidgetHost = observer(
  ({ def, instance, ctx, dragMime, onDragChange }: WidgetHostProps) => {
    const store = useStore();
    const workspace = useWorkspace();
    const cardRef = useRef<HTMLDivElement | null>(null);

    const endpoint = def.source.kind !== "live" ? def.source.endpoint : null;
    const channel = def.source.kind !== "snapshot" ? def.source.channel : null;

    const fetcher = useCallback(
      () =>
        endpoint
          ? store.api.getAbsolute<unknown>(endpoint)
          : Promise.resolve<unknown>(null),
      [store, endpoint],
    );
    const snap = useResource(fetcher);

    const [liveData, setLiveData] = useState<unknown>(null);
    const liveOn = !!channel && ctx.live;
    useEffect(() => {
      if (!liveOn) setLiveData(null);
    }, [liveOn]);

    const fromLive = liveOn && liveData != null;
    const data = fromLive ? liveData : snap.data;
    const source: WidgetData<unknown> = {
      data,
      loading: snap.loading && data == null,
      error: snap.error,
      fromLive,
      reload: snap.reload,
    };

    const Render = def.render;
    const Icon = def.icon;
    const isLiveSource = def.source.kind !== "snapshot";
    const liveOnlyOff = def.source.kind === "live" && !ctx.live;

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
                  background: fromLive
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

        {liveOn && channel ? (
          <LiveFeed channel={channel} onData={setLiveData} />
        ) : null}

        <Box style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <DataState
            loading={source.loading}
            error={source.error}
            empty={liveOnlyOff || source.data == null}
            emptyMessage={
              liveOnlyOff
                ? "Active le temps réel pour ce widget."
                : "Aucune donnée."
            }
            onRetry={endpoint ? source.reload : undefined}
            minHeight={40}
          >
            <Render source={source} ctx={ctx} span={instance.span} />
          </DataState>
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
