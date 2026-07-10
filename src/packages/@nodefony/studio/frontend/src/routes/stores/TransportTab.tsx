/**
 * Onglet « Flux & transport » de la console Stores — le versant `driver`
 * (transport) qui complète le versant `store` (données) : backplane des logs,
 * backplane realtime, cache Redis. Ensemble = toute la topologie de persistance
 * ET de flux, branchée sur le vrai runtime. Fetch d'endpoints existants (0 backend).
 */
import { observer } from "mobx-react-lite";
import { useCallback } from "react";
import { Stack, Grid, Alert, Text } from "@mantine/core";
import {
  IconInfoCircle,
  IconFileText,
  IconBroadcast,
  IconServer,
} from "@tabler/icons-react";
import { useStore } from "../../stores";
import { useResource } from "../../hooks";
import { StatCard, DocHint } from "../../components/ui";
import {
  KERNEL_INFO_ENDPOINT,
  REALTIME_HEALTH_ENDPOINT,
  type Infra,
  type KernelInfoPartial,
  type RealtimeHealthPartial,
  type LogBackplane,
  type RealtimeBackplane,
} from "./storesModel";

interface TransportData {
  log: LogBackplane | null;
  realtime: RealtimeBackplane | null;
}

/**
 * Vue transport de la persistance/flux.
 *
 * @param infra - infra déclarée (fournie par la page parente ; `cache` = Redis).
 */
export const TransportTab = observer(
  ({ infra }: { infra: Infra | undefined }) => {
    const store = useStore();
    const fetcher = useCallback(async (): Promise<TransportData> => {
      // Les deux sondes peuvent 403/manquer (module realtime absent) → non bloquant.
      const [info, rt] = await Promise.all([
        store.api
          .getAbsolute<KernelInfoPartial>(KERNEL_INFO_ENDPOINT)
          .catch(() => null),
        store.api
          .getAbsolute<RealtimeHealthPartial>(REALTIME_HEALTH_ENDPOINT)
          .catch(() => null),
      ]);
      return {
        log: info?.backplanes?.log ?? null,
        realtime: rt?.backplane ?? null,
      };
    }, [store]);

    const { data } = useResource(fetcher);
    const log = data?.log;
    const rt = data?.realtime;

    return (
      <Stack gap="md">
        <Alert variant="light" color="blue" icon={<IconInfoCircle size={16} />}>
          <Text size="sm">
            Ici le <strong>transport</strong> (le <em>driver</em> : par où
            transitent les flux), complément de l'onglet <strong>Stores</strong>{" "}
            (les <em>données</em> : où elles sont persistées). C'est la dualité{" "}
            <strong>store (données) / driver (transport)</strong> — ensemble,
            toute la topologie runtime.
          </Text>
        </Alert>
        <Grid>
          <StatCard
            label="Backplane logs"
            icon={<IconFileText size={18} />}
            span={{ base: 12, sm: 4 }}
            info={
              <DocHint
                title="Backplane logs"
                summary="Relecture/agrégation des logs — le sink d'écriture reste stdout (12-factor)."
                sections={[
                  {
                    label: "Actif",
                    body: log
                      ? `${log.driver} (sink ${log.sink})`
                      : "indéterminé",
                  },
                  {
                    label: "Drivers possibles",
                    body: "memory · file · cluster-file · loki (NF_LOKI_URL) · opensearch (NF_OPENSEARCH_URL). Redis n'est PAS un backplane de logs.",
                  },
                ]}
              />
            }
          >
            <Text fz={22} fw={700} style={{ lineHeight: 1.2 }}>
              {log ? log.driver : "—"}
            </Text>
          </StatCard>
          <StatCard
            label="Backplane realtime"
            icon={<IconBroadcast size={18} />}
            span={{ base: 12, sm: 4 }}
            info={
              <DocHint
                title="Backplane realtime"
                summary="Fond de panier de la socket Nodefony : fan-out des flux WebSocket entre les pods."
                sections={[
                  {
                    label: "Actif",
                    body: rt
                      ? `${rt.driver} — ${rt.crossPod ? "cross-pod (partagé)" : "local (per-pod)"}`
                      : "module realtime absent",
                  },
                  {
                    label: "Drivers possibles",
                    body: "local (loopback, mono-pod) · redis (cross-pod, fan-out entre pods — NF_REDIS_URL) · cluster. Le multi-pod passe par Redis.",
                  },
                ]}
              />
            }
          >
            <Text fz={22} fw={700} style={{ lineHeight: 1.2 }}>
              {rt ? rt.driver : "—"}
            </Text>
          </StatCard>
          <StatCard
            label="Redis"
            icon={<IconServer size={18} />}
            span={{ base: 12, sm: 4 }}
            info={
              <DocHint
                title="Redis — moteur multi-rôle"
                summary="Déclaré via NF_REDIS_URL, un même Redis peut assurer PLUSIEURS rôles à la fois."
                sections={[
                  {
                    label: "Rôles",
                    body: "Cache · stores éphémères/partagés (session, idempotence) · backplane realtime cross-pod (fan-out WS entre pods).",
                  },
                  {
                    label: "État",
                    body: infra?.cache
                      ? `déclaré (${infra.cache.url}) — disponible pour tous ces rôles.`
                      : "non déclaré — repli local/mémoire (mono-pod).",
                  },
                ]}
              />
            }
          >
            <Text fz={22} fw={700} style={{ lineHeight: 1.2 }}>
              {infra?.cache ? "présent" : "absent"}
            </Text>
          </StatCard>
        </Grid>
      </Stack>
    );
  },
);
