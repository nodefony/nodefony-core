/**
 * Affichage d'un **secret de signature webhook** en clair — composant partagé
 * par la création, la rotation et la révélation. Le secret signe chaque livraison
 * (HMAC-SHA256, **Standard Webhooks v1**) ; le serveur le relit pour signer, mais
 * la console ne le montre qu'**à la demande**. Rendu en TEXTE (`<Code>`), jamais
 * loggé, purgé à la fermeture du modal porteur.
 */
import {
  Modal,
  Stack,
  Group,
  Text,
  Alert,
  Code,
  CopyButton,
  Button,
  Box,
} from "@mantine/core";
import {
  IconCopy,
  IconCheck,
  IconAlertTriangle,
  IconShieldCheck,
  IconRotateClockwise,
  IconEye,
} from "@tabler/icons-react";

/** Contexte de révélation → titre + bandeau adaptés. */
export type RevealContext = "created" | "rotated" | "revealed";

const CONTEXT_META: Record<
  RevealContext,
  { title: string; once: boolean; intro: string }
> = {
  created: {
    title: "Endpoint créé — copiez le secret",
    once: true,
    intro:
      "Configurez ce secret chez le destinataire pour qu'il vérifie la " +
      "signature de chaque livraison.",
  },
  rotated: {
    title: "Secret régénéré — copiez le nouveau",
    once: true,
    intro:
      "L'ancien secret cesse immédiatement d'être valide. Mettez à jour le " +
      "destinataire avec ce nouveau secret.",
  },
  revealed: {
    title: "Secret de signature",
    once: false,
    intro:
      "Secret en clair (réversible, conservé chiffré au repos). Copiez-le pour " +
      "configurer ou diagnostiquer la vérification de signature.",
  },
};

/**
 * Bloc présentiel : le secret + bouton copier + rappel d'usage Standard Webhooks.
 * Réutilisé dans le modal de création (phase 2) et le modal rotate/reveal.
 */
export function WebhookSecretView({
  secret,
  url,
  context,
}: {
  secret: string;
  /** URL de l'endpoint concerné (rappel de contexte). */
  url: string;
  context: RevealContext;
}) {
  const meta = CONTEXT_META[context];
  return (
    <Stack gap="md">
      <Alert
        role="alert"
        variant="light"
        color={meta.once ? "orange" : "blue"}
        icon={<IconAlertTriangle size={16} />}
        title={meta.once ? "Copiez ce secret maintenant" : "Secret sensible"}
      >
        {meta.once ? (
          <>
            Il ne sera <strong>plus jamais affiché automatiquement</strong>{" "}
            (récupérable seulement via « Révéler »). {meta.intro}
          </>
        ) : (
          meta.intro
        )}
      </Alert>

      <Box>
        <Text size="sm" c="dimmed" mb={4}>
          Secret pour <Code>{url}</Code>
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
            {secret}
          </Code>
          <CopyButton value={secret} timeout={2000}>
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

      <Alert variant="light" color="gray" icon={<IconShieldCheck size={16} />}>
        <Text size="xs">
          Signature <strong>Standard Webhooks v1</strong> : chaque livraison
          porte les en-têtes <Code>webhook-id</Code>,{" "}
          <Code>webhook-timestamp</Code> et{" "}
          <Code>webhook-signature: v1,&lt;base64&gt;</Code> (HMAC-SHA256 de{" "}
          <Code>id.timestamp.payload</Code> avec ce secret). Le destinataire
          recalcule la signature pour authentifier l'appel.
        </Text>
      </Alert>
    </Stack>
  );
}

/**
 * Modal autonome pour afficher un secret issu d'une **rotation** ou d'une
 * **révélation** (la création utilise sa propre fenêtre 2-phases).
 */
export function SecretRevealModal({
  opened,
  onClose,
  secret,
  url,
  context,
}: {
  opened: boolean;
  onClose: () => void;
  /** `null` tant qu'aucun secret n'est chargé (modal vide). */
  secret: string | null;
  url: string;
  context: Exclude<RevealContext, "created">;
}) {
  const Icon = context === "rotated" ? IconRotateClockwise : IconEye;
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <Icon size={18} />
          <Text fw={700}>{CONTEXT_META[context].title}</Text>
        </Group>
      }
      centered
      size="lg"
      closeOnClickOutside={false}
    >
      {secret !== null && (
        <Stack gap="md">
          <WebhookSecretView secret={secret} url={url} context={context} />
          <Group justify="flex-end">
            <Button leftSection={<IconCheck size={16} />} onClick={onClose}>
              {context === "rotated"
                ? "J'ai copié le nouveau secret"
                : "Fermer"}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
