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
import { StatCard } from "../../components/ui";
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
            hint={
              log
                ? `Relecture/agrégation des logs. Sink d'écriture : ${log.sink}.`
                : "Backplane logs indéterminé."
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
            hint={
              rt
                ? rt.crossPod
                  ? "cross-pod — flux partagés entre pods (redis/cluster)."
                  : "local — fan-out per-pod (loopback)."
                : "Module realtime absent ou indisponible."
            }
          >
            <Text fz={22} fw={700} style={{ lineHeight: 1.2 }}>
              {rt ? rt.driver : "—"}
            </Text>
          </StatCard>
          <StatCard
            label="Cache (Redis)"
            icon={<IconServer size={18} />}
            span={{ base: 12, sm: 4 }}
            hint={
              infra?.cache
                ? infra.cache.url
                : "Aucune infra cache déclarée (NF_REDIS_URL)."
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
