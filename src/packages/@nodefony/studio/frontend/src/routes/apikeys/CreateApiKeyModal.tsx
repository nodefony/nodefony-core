/**
 * Modal de **création d'une clé API** (mode utilisateur, self-service) en deux
 * temps dans la même fenêtre :
 *  1. **Formulaire** — nom, scopes (catalogue si défini, sinon libres), expiration.
 *  2. **Secret révélé** — le token en clair, affiché **UNE seule fois** (RFC « shown
 *     once ») : copier + avertissement, jamais ré-affichable ni re-fetchable.
 *
 * Sécurité : le token est rendu en TEXTE (`<Code>`), jamais loggé ; à la fermeture
 * l'état est purgé. La création passe en POST HTTP (mutation → pipeline complet,
 * CSRF appliqué — la Socket Nodefony reste GET-only).
 */
import { useMemo, useState } from "react";
import {
  Modal,
  Stack,
  Group,
  Text,
  TextInput,
  Select,
  Checkbox,
  TagsInput,
  Button,
  Alert,
  Code,
  CopyButton,
  ThemeIcon,
  Box,
} from "@mantine/core";
import {
  IconKey,
  IconCopy,
  IconCheck,
  IconAlertTriangle,
  IconShieldCheck,
} from "@tabler/icons-react";

import { useStore } from "../../stores";
import {
  KEYS_ENDPOINT,
  describeApiKeysError,
  type ApiKeyCapabilities,
  type ApiKeyCreated,
} from "./apiKeysModel";

const EXPIRY_PRESETS = [
  { value: "30", label: "30 jours" },
  { value: "60", label: "60 jours" },
  { value: "90", label: "90 jours" },
  { value: "365", label: "1 an" },
  { value: "null", label: "Sans expiration" },
];

function defaultExpiryValue(caps: ApiKeyCapabilities): string {
  const dft = caps.defaultExpiryDays;
  if (dft === null) return "null";
  const asStr = String(dft);
  return EXPIRY_PRESETS.some((p) => p.value === asStr) ? asStr : "90";
}

export function CreateApiKeyModal({
  opened,
  onClose,
  capabilities,
  onCreated,
}: {
  opened: boolean;
  onClose: () => void;
  capabilities: ApiKeyCapabilities;
  /** Appelé après une création réussie (recharge la liste). */
  onCreated: () => void;
}) {
  const store = useStore();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<string>(() =>
    defaultExpiryValue(capabilities),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);

  // Catalogue groupé par API : scopes DÉCOUVERTS des routes (`declaredScopes`,
  // @RequireScope) ∪ `allowedScopes` (config). Le préfixe avant `:` est l'API.
  const grouped = useMemo<{ api: string; scopes: string[] }[]>(() => {
    const byApi = new Map<string, Set<string>>();
    const add = (scope: string) => {
      const i = scope.indexOf(":");
      const api = i === -1 ? scope : scope.slice(0, i);
      let set = byApi.get(api);
      if (set === undefined) {
        set = new Set();
        byApi.set(api, set);
      }
      set.add(scope);
    };
    for (const g of capabilities.declaredScopes ?? [])
      for (const s of g.scopes) add(s);
    for (const s of capabilities.allowedScopes ?? []) add(s);
    return [...byApi.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([api, set]) => ({ api, scopes: [...set].sort() }));
  }, [capabilities.declaredScopes, capabilities.allowedScopes]);

  const catalogueScopes = useMemo(
    () => grouped.flatMap((g) => g.scopes),
    [grouped],
  );
  const hasCatalogue = catalogueScopes.length > 0;
  // `allowedScopes === null` = config en mode libre → on autorise EN PLUS des
  // scopes hors catalogue (le catalogue découvert n'est alors qu'une suggestion).
  const allowsFreeScopes = capabilities.allowedScopes === null;

  function reset(): void {
    setName("");
    setScopes([]);
    setExpiry(defaultExpiryValue(capabilities));
    setError(null);
    setCreated(null);
    setSubmitting(false);
  }

  function handleClose(): void {
    const wasCreated = created !== null;
    reset();
    onClose();
    // Recharger la liste seulement si une clé a réellement été émise.
    if (wasCreated) onCreated();
  }

  async function submit(): Promise<void> {
    setError(null);
    if (name.trim().length === 0) {
      setError(
        "Donnez un nom à la clé (ex. « CI deploy », « script backup »).",
      );
      return;
    }
    setSubmitting(true);
    try {
      const body: {
        name: string;
        scopes?: string[];
        expiresInDays: number | null;
      } = {
        name: name.trim(),
        expiresInDays: expiry === "null" ? null : Number(expiry),
      };
      if (scopes.length > 0) body.scopes = scopes;
      const result = await store.api.postAbsolute<ApiKeyCreated>(
        KEYS_ENDPOINT,
        body,
      );
      setCreated(result);
    } catch (e) {
      setError(describeApiKeysError(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Group gap="xs">
          <IconKey size={18} />
          <Text fw={700}>
            {created ? "Clé créée — copiez le secret" : "Nouvelle clé API"}
          </Text>
        </Group>
      }
      centered
      size="lg"
      closeOnClickOutside={created === null}
    >
      {created === null ? (
        // ── Phase 1 : formulaire ───────────────────────────────────────────────
        <Stack gap="md">
          <Box mih={44}>
            {error && (
              <Alert
                role="alert"
                variant="light"
                color="red"
                icon={<IconAlertTriangle size={16} />}
              >
                {error}
              </Alert>
            )}
          </Box>

          <TextInput
            label="Nom"
            description="Un libellé pour reconnaître la clé (ne fait pas partie du secret)."
            placeholder="CI deploy"
            required
            value={name}
            maxLength={100}
            onChange={(e) => {
              setName(e.currentTarget.value);
              if (error) setError(null);
            }}
            data-autofocus
          />

          {hasCatalogue ? (
            <Stack gap="sm">
              <Checkbox.Group
                label="Scopes"
                description="Capacités accordées (sous-ensemble des droits du porteur), découvertes depuis les routes du serveur."
                value={scopes.filter((s) => catalogueScopes.includes(s))}
                onChange={(checked) =>
                  setScopes([
                    ...checked,
                    ...scopes.filter((s) => !catalogueScopes.includes(s)),
                  ])
                }
              >
                <Stack gap="sm" mt="xs">
                  {grouped.map((g) => (
                    <Box key={g.api}>
                      <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                        {g.api}
                      </Text>
                      <Group gap="md" mt={4}>
                        {g.scopes.map((s) => (
                          <Checkbox key={s} value={s} label={s} />
                        ))}
                      </Group>
                    </Box>
                  ))}
                </Stack>
              </Checkbox.Group>
              {allowsFreeScopes && (
                <TagsInput
                  label="Scopes personnalisés (optionnel)"
                  description="Mode libre : ajoutez un scope hors catalogue (toute valeur est acceptée)."
                  placeholder="custom:scope…"
                  value={scopes.filter((s) => !catalogueScopes.includes(s))}
                  onChange={(free) =>
                    setScopes([
                      ...scopes.filter((s) => catalogueScopes.includes(s)),
                      ...free,
                    ])
                  }
                  clearable
                />
              )}
            </Stack>
          ) : (
            <TagsInput
              label="Scopes (optionnel)"
              description="Aucun catalogue défini : tout scope est accepté. Vide = la clé porte tous les droits du porteur."
              placeholder="orders:read, billing:write…"
              value={scopes}
              onChange={setScopes}
              clearable
            />
          )}

          <Select
            label="Expiration"
            description="Une clé qui expire limite l'impact d'une fuite (rotation)."
            data={EXPIRY_PRESETS}
            value={expiry}
            onChange={(v) => v && setExpiry(v)}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
          />

          <Text size="xs" c="dimmed">
            Plafond : {capabilities.maxPerSubject} clés actives par porteur.
            Préfixe public : <Code>{capabilities.prefix}_</Code>.
          </Text>

          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={handleClose}>
              Annuler
            </Button>
            <Button
              leftSection={<IconKey size={16} />}
              loading={submitting}
              onClick={submit}
            >
              Créer la clé
            </Button>
          </Group>
        </Stack>
      ) : (
        // ── Phase 2 : secret révélé (1×) ───────────────────────────────────────
        <Stack gap="md">
          <Alert
            role="alert"
            variant="light"
            color="orange"
            icon={<IconAlertTriangle size={16} />}
            title="Copiez ce secret maintenant"
          >
            Il ne sera <strong>plus jamais affiché</strong>. Seule son empreinte
            est conservée côté serveur — il est impossible de le récupérer
            ensuite.
          </Alert>

          <Box>
            <Text size="sm" c="dimmed" mb={4}>
              Secret de « {created.name} »
            </Text>
            <Group
              gap="xs"
              wrap="nowrap"
              align="stretch"
              style={{
                border: "1px solid var(--mantine-color-default-border)",
                borderRadius: "var(--mantine-radius-sm)",
                padding: "var(--mantine-spacing-xs)",
              }}
            >
              <Code
                block
                style={{
                  flex: 1,
                  wordBreak: "break-all",
                  background: "transparent",
                }}
              >
                {created.token}
              </Code>
              <CopyButton value={created.token} timeout={2000}>
                {({ copied, copy }) => (
                  <Button
                    color={copied ? "teal" : "brand"}
                    variant={copied ? "light" : "filled"}
                    leftSection={
                      copied ? <IconCheck size={16} /> : <IconCopy size={16} />
                    }
                    onClick={copy}
                  >
                    {copied ? "Copié" : "Copier"}
                  </Button>
                )}
              </CopyButton>
            </Group>
          </Box>

          <Alert
            variant="light"
            color="gray"
            icon={<IconShieldCheck size={16} />}
          >
            <Text size="xs">
              Utilisation : en-tête{" "}
              <Code>
                Authorization: Bearer{" "}
                {created.prefix ?? `${capabilities.prefix}_`}…
              </Code>
              . Révocable à tout moment depuis cette console.
            </Text>
          </Alert>

          <Group justify="flex-end">
            <Button leftSection={<IconCheck size={16} />} onClick={handleClose}>
              J'ai copié le secret
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
