/**
 * **SyslogConfigPanel** — onglet « Config » de la page Log Backplane.
 *
 * NE fait QUE **mapper** la méta backplane vers la brique générique
 * `ConfigLayout` (UI kit) : c'est la VISION partagée appliquée partout aux
 * modules (la même grille de lecture config sur tout l'écosystème). Le syslog est
 * le premier consommateur — un autre module se branchera de la même façon en
 * fournissant ses `sections` (depuis son schéma Zod + ses overrides).
 *
 * ⚠️ Front-only (préparation) : la config de l'app n'est pas encore exposée par
 * une API dédiée (chantier config en cours). On remplit les valeurs DÉJÀ connues
 * via le backplane et on marque le reste « non exposé » — la structure et la
 * cascade de surcharge sont prêtes.
 */
import { Alert, Badge, Code, Text } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import {
  ConfigLayout,
  type ConfigField,
  type ConfigSection,
  type EditResult,
} from "../../components/ui";
import { useStore } from "../../stores";
import type { BackplaneMeta } from "./logsTypes";

export interface SyslogConfigPanelProps {
  meta: BackplaneMeta | null;
  /** Refetch de la méta backplane après un switch live (provenance à jour). */
  onChanged?: () => void;
}

/** Valeur de config en monospace. */
function code(v: string) {
  return <Code style={{ fontSize: 12 }}>{v}</Code>;
}
const dash = (
  <Text size="xs" c="dimmed">
    —
  </Text>
);
const urlDefined = (
  <Badge size="xs" variant="light" color="teal" tt="none">
    URL définie
  </Badge>
);

export function SyslogConfigPanel({ meta, onChanged }: SyslogConfigPanelProps) {
  const store = useStore();

  // Switch du driver de RELECTURE — MÊME action que la Vue d'ensemble
  // (POST /backplane/driver, dev-only, atomique) mais présentée ICI, là où le
  // champ est annoncé « modifiable à chaud » : la confiance n'exclut pas le
  // contrôle (un champ « live » DOIT porter son contrôle, comme la page Config
  // globale). Routé par `key` — seul queryDriver est éditable dans ce panneau.
  const onEdit = async (
    field: ConfigField,
    value: unknown,
  ): Promise<EditResult> => {
    if (field.key !== "log.queryDriver") {
      return { ok: false, error: "Champ non éditable ici" };
    }
    try {
      await store.api.postAbsolute("/nodefony/syslog/api/backplane/driver", {
        name: String(value),
      });
      onChanged?.();
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "switch refusé",
      };
    }
  };

  if (!meta) {
    return (
      <Text size="sm" c="dimmed">
        Chargement de la configuration…
      </Text>
    );
  }

  const writable = new Set(
    meta.drivers.filter((d) => d.capabilities.write).map((d) => d.name),
  );
  const has = (n: string) => writable.has(n);
  const queryDriver = meta.activeDriver?.name ?? null;
  const sink = meta.write.sink;
  // Options du switch = drivers enregistrés (le serveur refuse un nom inconnu).
  const driverOptions = meta.drivers.map((d) => d.name);
  const isDev = meta.environment !== "production";

  const sections: ConfigSection[] = [
    {
      title: "Destinations & relecture",
      description:
        "Où les logs sont écrits (fan-out) et d'où on les relit (Explorer).",
      fields: [
        {
          key: "log.queryDriver",
          type: "enum",
          constraint: "memory · file · cluster-file · loki · opensearch",
          effective: queryDriver ? code(queryDriver) : undefined,
          defaultValue: code("memory"),
          source: queryDriver && queryDriver !== "memory" ? "app" : "default",
          env: "NF_LOG_QUERY_DRIVER",
          mutability: "live",
          description:
            "Destination de RELECTURE (Explorer). Seul réglage modifiable à chaud (dev).",
          editControl: { kind: "select", options: driverOptions },
          editValue: queryDriver ?? "memory",
        },
        {
          key: "log.driver",
          type: "enum",
          constraint: "stdout · file · null",
          effective: code(sink),
          defaultValue: code("stdout"),
          source: sink !== "stdout" ? "app" : "default",
          mutability: "boot",
          description:
            "Sink d'ÉCRITURE texte : où part la ligne lisible de chaque log.",
        },
        {
          key: "log.loki.url",
          type: "url",
          effective: has("loki") ? urlDefined : undefined,
          defaultValue: dash,
          source: has("loki") ? "env" : "default",
          env: "LOKI_URL",
          mutability: "boot",
          description:
            "Endpoint Grafana Loki — l'URL active le transport d'écriture + le driver de relecture.",
        },
        {
          key: "log.opensearch.url",
          type: "url",
          effective: has("opensearch") ? urlDefined : undefined,
          defaultValue: dash,
          source: has("opensearch") ? "env" : "default",
          env: "OPENSEARCH_URL",
          mutability: "boot",
          description:
            "Endpoint OpenSearch — l'URL active l'indexation _bulk + la recherche _search.",
        },
        {
          key: "log.dir",
          type: "string",
          effective: undefined,
          defaultValue: code("logs"),
          mutability: "boot",
          description:
            "Dossier des fichiers de log (.jsonl par worker, .log texte).",
        },
      ],
    },
    {
      title: "Sortie & exécution",
      fields: [
        {
          key: "log.buffered",
          type: "enum",
          constraint: "auto · true · false",
          effective: undefined,
          defaultValue: code("auto"),
          mutability: "boot",
          description:
            "Coalescing des écritures par tick. « auto » = bufférise hors TTY (pipe/fichier).",
        },
        {
          key: "NODE_ENV",
          type: "string",
          effective: code(meta.environment ?? "—"),
          source: "runtime",
          env: "NODE_ENV",
          mutability: "readonly",
          description:
            "Environnement d'exécution. Gouverne la visibilité du switch de lecture (dev-only).",
        },
        {
          key: "NF_CLUSTER",
          type: "boolean",
          effective: code(meta.cluster?.isCluster ? "cluster" : "mono-process"),
          source: "runtime",
          env: "NF_CLUSTER",
          mutability: "readonly",
          description:
            "Topologie : posé par le master au fork. En cluster → préférer « cluster-file ».",
        },
      ],
    },
  ];

  return (
    <ConfigLayout
      module="@nodefony/core — Syslog (Log Backplane)"
      schema="partial"
      sections={sections}
      editable={isDev}
      onEdit={onEdit}
      notice={
        <Alert
          variant="light"
          color="blue"
          icon={<IconInfoCircle size={16} />}
          title="Valeurs effectives partielles — config app pas encore exposée par API"
        >
          Les valeurs « non exposé » le deviendront quand la configuration de
          l'app sera servie par une API dédiée (chantier de refonte config en
          cours). La structure et la cascade de surcharge sont prêtes : c'est le{" "}
          <b>même layout</b> que tout module utilisera dans son onglet Config.
        </Alert>
      }
    />
  );
}
