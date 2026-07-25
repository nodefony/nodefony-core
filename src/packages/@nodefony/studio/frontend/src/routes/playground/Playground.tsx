/**
 * Playground — console VIVANTE des controllers (dev uniquement).
 *
 * Page GÉNÉRIQUE data-driven : lit `GET /nodefony/framework/api/playground/routes`
 * (métadonnées décorateurs sérialisées par le framework) et construit un
 * formulaire d'exécution par action — AUCUN code généré dans l'app, rétroactif
 * sur tout controller. Deep-link : `/nodefony/playground/{controller}`.
 *
 * Hors dev le data plane n'est pas monté (404) → message « dev uniquement »
 * (fail-loud, pas de dégradation silencieuse).
 */
import { useCallback, useMemo } from "react";
import { observer } from "mobx-react-lite";
import { useNavigate, useParams } from "react-router";
import {
  Accordion,
  Badge,
  Group,
  NavLink,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import { IconFlask } from "@tabler/icons-react";
import { useStore } from "../../stores";
import { useResource } from "../../hooks";
import { DataState, DocHint, PageLayout } from "../../components/ui";
import {
  describePlaygroundError,
  type PlaygroundSnapshot,
} from "./PlaygroundModel";
import { MethodBadge } from "./PlaygroundFormat";
import { ActionPanel } from "./ActionPanel";

export const Playground = observer(() => {
  const store = useStore();
  const navigate = useNavigate();
  const { controller: selectedName } = useParams<{ controller: string }>();

  const fetcher = useCallback(async () => {
    try {
      return await store.api.getAbsolute<PlaygroundSnapshot>(
        "/nodefony/framework/api/playground/routes",
      );
    } catch (e) {
      throw new Error(describePlaygroundError(e));
    }
  }, [store]);
  const { data, loading, error, reload } = useResource(fetcher);

  const controllers = useMemo(() => data?.controllers ?? [], [data]);
  // Groupe {module → controllers} pour la colonne de navigation.
  const byModule = useMemo(() => {
    const map = new Map<string, typeof controllers>();
    for (const c of controllers) {
      const key = c.module ?? "(sans module)";
      const arr = map.get(key);
      if (arr) arr.push(c);
      else map.set(key, [c]);
    }
    return map;
  }, [controllers]);

  const selected =
    controllers.find((c) => c.name === selectedName) ?? controllers[0] ?? null;

  return (
    <PageLayout
      title="Playground"
      subtitle="Console vivante des controllers — exécute chaque action par HTTP ou par la socket Nodefony"
      icon={<IconFlask size={28} />}
      actions={
        <DocHint
          title="Playground (dev)"
          summary="Les formulaires sont construits depuis les métadonnées des décorateurs (routes, transports, @Query/@Body, gardes). Une action « duplex » répond par HTTP ET par la socket (pont api.request) — la même action controller, deux transports."
          sections={[
            {
              label: "Sécurité",
              body: "Cette console exécute des actions RÉELLES avec votre session : elle n'est montée qu'en développement. Les refus (401/403/405) s'affichent tels que le serveur les rend.",
            },
          ]}
        />
      }
    >
      <DataState
        loading={loading && !controllers.length}
        error={error}
        empty={!loading && !controllers.length}
        emptyMessage="Aucun controller enregistré."
        onRetry={reload}
      >
        <Group align="flex-start" gap="md" wrap="nowrap">
          {/* Colonne navigation — controllers groupés par module. */}
          <Paper withBorder p="xs" w={280} style={{ flexShrink: 0 }}>
            <Stack gap={4}>
              {[...byModule.entries()].map(([mod, ctrls]) => (
                <Stack key={mod} gap={2}>
                  <Text size="xs" c="dimmed" fw={600} tt="uppercase" px="xs">
                    {mod}
                  </Text>
                  {ctrls.map((c) => (
                    <NavLink
                      key={c.name}
                      active={selected?.name === c.name}
                      label={c.name}
                      description={`${c.actions.length} action(s)`}
                      onClick={() =>
                        void navigate(`/nodefony/playground/${c.name}`)
                      }
                    />
                  ))}
                </Stack>
              ))}
            </Stack>
          </Paper>

          {/* Actions du controller sélectionné. */}
          <Stack gap="md" style={{ flex: 1, minWidth: 0 }}>
            {selected && (
              <Accordion
                variant="separated"
                multiple={false}
                defaultValue={selected.actions[0]?.route ?? null}
              >
                {selected.actions.map((a) => (
                  <Accordion.Item key={a.route} value={a.route}>
                    <Accordion.Control>
                      <Group gap="xs" wrap="wrap">
                        {a.methods
                          .filter((m) => m !== "WEBSOCKET")
                          .map((m) => (
                            <MethodBadge key={m} method={m} />
                          ))}
                        {a.duplex && (
                          <Badge
                            size="sm"
                            variant="light"
                            color="orange"
                            radius="sm"
                          >
                            duplex
                          </Badge>
                        )}
                        <Text size="sm" ff="monospace">
                          {a.path}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {selected.name}.{a.action}()
                        </Text>
                      </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <ActionPanel action={a} />
                    </Accordion.Panel>
                  </Accordion.Item>
                ))}
              </Accordion>
            )}
          </Stack>
        </Group>
      </DataState>
    </PageLayout>
  );
});
