import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useState } from "react";
import {
  ActionIcon,
  Box,
  Card,
  Group,
  Menu,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconArrowsHorizontal,
  IconChevronLeft,
  IconChevronRight,
  IconDotsVertical,
  IconX,
} from "@tabler/icons-react";
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
}

/**
 * Cadre commun d'un widget — encode le PATTERN « sonde + hub » une seule fois :
 * snapshot HTTP au 1ᵉʳ paint, abonnement live CONDITIONNEL (monté ssi `ctx.live` →
 * unsubscribe auto au démontage), fallback, `DataState`, `contain: content`. Le widget
 * lui-même = rendu pur (reçoit `source` + `ctx`).
 */
export const WidgetHost = observer(
  ({ def, instance, ctx }: WidgetHostProps) => {
    const store = useStore();
    const workspace = useWorkspace();

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
    // Live-only sans snapshot et OFF → invite à activer le temps réel.
    const liveOnlyOff = def.source.kind === "live" && !ctx.live;

    return (
      <Card
        withBorder
        radius="md"
        p="sm"
        h="100%"
        style={{ contain: "content" }}
      >
        <Group justify="space-between" wrap="nowrap" mb="xs">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
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
                leftSection={<IconArrowsHorizontal size={14} />}
                onClick={() =>
                  workspace.setSpan(
                    def.id,
                    instance.span >= 12 ? def.minSpan : instance.span + 2,
                  )
                }
              >
                Largeur : {instance.span}/12
              </Menu.Item>
              <Menu.Item
                leftSection={<IconChevronLeft size={14} />}
                onClick={() => workspace.move(def.id, -1)}
              >
                Déplacer à gauche
              </Menu.Item>
              <Menu.Item
                leftSection={<IconChevronRight size={14} />}
                onClick={() => workspace.move(def.id, 1)}
              >
                Déplacer à droite
              </Menu.Item>
              <Menu.Divider />
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
          minHeight={70}
        >
          <Render source={source} ctx={ctx} span={instance.span} />
        </DataState>
      </Card>
    );
  },
);
