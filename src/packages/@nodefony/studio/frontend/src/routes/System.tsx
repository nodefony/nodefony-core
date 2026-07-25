import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
  Accordion,
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconServer,
  IconNetwork,
  IconRoute,
  IconFileText,
  IconApi,
  IconRefresh,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { useAdmin } from "../stores";
import type { AdminEndpointMeta } from "../stores/AdminStore";
import { PageLayout, DataState, JsonViewer } from "../components/ui";

/** Mappe le nom d'icône du descriptor (backend) vers une icône Tabler. */
const ICONS: Record<string, typeof IconServer> = {
  server: IconServer,
  network: IconNetwork,
  route: IconRoute,
  "file-text": IconFileText,
};

const METHOD_COLORS: Record<string, string> = {
  GET: "teal",
  POST: "blue",
  PUT: "yellow",
  PATCH: "grape",
  DELETE: "red",
};

/**
 * System — explorer du **data plane admin**, généré depuis le catalogue
 * `/nodefony/framework/api/admin` (discovery P10.2). Aucune URL en dur : la
 * liste des modules + endpoints vient du backend ; chaque endpoint GET est
 * invocable et sa réponse JSON s'affiche en place.
 */
export const System = observer(() => {
  const admin = useAdmin();
  const [params] = useSearchParams();
  const focus = params.get("p");
  // Accordéon contrôlé : la sidebar « Data plane » deep-link `?p=<ns>` → ouvre
  // le producteur ciblé (en plus de ceux déjà ouverts).
  const [open, setOpen] = useState<string[]>(focus ? [focus] : ["kernel"]);

  useEffect(() => {
    void admin.loadCatalog();
  }, [admin]);

  useEffect(() => {
    if (focus) setOpen((o) => (o.includes(focus) ? o : [...o, focus]));
  }, [focus]);

  return (
    <PageLayout
      title="System — Admin API"
      subtitle={
        <>
          Data plane découvert via <Code>/nodefony/framework/api/admin</Code> —{" "}
          {admin.producers.length} module(s), {admin.endpointCount} endpoint(s)
        </>
      }
      actions={
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          loading={admin.loading}
          onClick={() => void admin.loadCatalog()}
        >
          Recharger
        </Button>
      }
    >
      <DataState
        loading={admin.loading && admin.producers.length === 0}
        error={admin.error}
        empty={!admin.loading && admin.producers.length === 0}
        emptyMessage="Aucun producteur admin découvert."
        onRetry={() => void admin.loadCatalog()}
      >
        <Accordion variant="separated" multiple value={open} onChange={setOpen}>
          {admin.producers.map((p) => {
            const Icon = (p.icon && ICONS[p.icon]) || IconApi;
            return (
              <Accordion.Item key={p.namespace} value={p.namespace}>
                <Accordion.Control
                  icon={
                    <ThemeIcon variant="light" color="brand" size="md">
                      <Icon size={18} />
                    </ThemeIcon>
                  }
                >
                  <Group gap="sm">
                    <Text fw={600}>{p.label}</Text>
                    <Badge variant="default" size="sm">
                      {p.namespace}
                    </Badge>
                    <Badge variant="light" size="sm" color="gray">
                      {p.endpoints.length} ep
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="xs">
                    {p.endpoints.map((ep) => (
                      <EndpointRow key={`${ep.method} ${ep.path}`} ep={ep} />
                    ))}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      </DataState>
    </PageLayout>
  );
});

/** Extrait les noms de variables `{x}` d'un chemin. */
function paramNames(path: string): string[] {
  return Array.from(path.matchAll(/\{([^}]+)\}/g)).map((m) => m[1]);
}

/**
 * Une ligne endpoint : métadonnées + saisie des params `{x}` + Invoke (GET) +
 * réponse JSON. Les endpoints paramétrés (ex `module/{name}`) exposent un champ
 * par variable ; le chemin réel est résolu (et encodé) avant l'appel — sinon on
 * invoquerait le littéral `{name}` (→ 404).
 */
const EndpointRow = observer(({ ep }: { ep: AdminEndpointMeta }) => {
  const admin = useAdmin();
  const isGet = ep.method === "GET";
  const params = useMemo(() => paramNames(ep.path), [ep.path]);
  const [values, setValues] = useState<Record<string, string>>({});

  // Chemin réel : substitue chaque {x} par sa valeur encodée.
  const resolvedPath = params.reduce(
    (p, name) => p.replace(`{${name}}`, encodeURIComponent(values[name] ?? "")),
    ep.path,
  );
  const ready = params.every((name) => (values[name] ?? "").trim().length > 0);
  const inv = admin.invocations.get(resolvedPath);

  return (
    <Box
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: "var(--mantine-radius-sm)",
        padding: "var(--mantine-spacing-xs)",
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Badge
            color={METHOD_COLORS[ep.method] ?? "gray"}
            variant="filled"
            size="sm"
          >
            {ep.method}
          </Badge>
          <Code>{ep.path}</Code>
          <Tooltip label={`Rôle requis : ${ep.role}`}>
            <Badge variant="dot" color="gray" size="xs">
              {ep.role}
            </Badge>
          </Tooltip>
        </Group>
        <Tooltip
          label={
            !isGet
              ? "Invocation limitée aux GET ici"
              : ready
                ? "Invoquer"
                : "Renseigne les paramètres"
          }
          disabled={isGet && ready}
        >
          <Button
            size="xs"
            variant="light"
            leftSection={<IconPlayerPlay size={14} />}
            loading={inv?.loading}
            disabled={!isGet || !ready}
            onClick={() => void admin.invoke(resolvedPath)}
          >
            Invoke
          </Button>
        </Tooltip>
      </Group>

      {ep.summary && (
        <Text c="dimmed" size="xs" mt={4}>
          {ep.summary}
        </Text>
      )}

      {params.length > 0 && (
        <Group gap="xs" mt="xs">
          {params.map((name) => (
            <TextInput
              key={name}
              size="xs"
              label={name}
              placeholder={name}
              value={values[name] ?? ""}
              onChange={(e) => {
                // Capturer la valeur AVANT l'updater fonctionnel : React nullifie
                // `e.currentTarget` après le handler → l'accès différé planterait.
                const val = e.currentTarget.value;
                setValues((v) => ({ ...v, [name]: val }));
              }}
              styles={{ label: { fontSize: 10 } }}
            />
          ))}
          <Text size="xs" c="dimmed" style={{ alignSelf: "flex-end" }}>
            → <Code>{resolvedPath}</Code>
          </Text>
        </Group>
      )}

      {inv && !inv.loading && (
        <Box mt="xs">
          {inv.error ? (
            <Alert color="red" variant="light" p="xs">
              {inv.error}
            </Alert>
          ) : (
            <JsonViewer value={inv.data} maxHeight={280} />
          )}
        </Box>
      )}
    </Box>
  );
});

export default System;
