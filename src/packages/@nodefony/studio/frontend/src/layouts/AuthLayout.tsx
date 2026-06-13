import {
  Anchor,
  Box,
  Flex,
  Group,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import type { ReactNode } from "react";
import {
  IconActivity,
  IconBolt,
  IconBrandGithub,
  IconShieldLock,
  type Icon,
} from "@tabler/icons-react";
import { NodefonyLogo } from "../components/NodefonyLogo";

/**
 * AuthLayout — page d'authentification (Login / SignUp / ForgotPassword) en
 * **split** : panneau de marque à gauche (desktop), formulaire à droite. Sur
 * mobile, le hero disparaît et le formulaire occupe tout l'écran.
 *
 * Perf : le hero est volontairement STATIQUE (0 animation, dégradé + glow figés)
 * → aucun coût de rendu. Styles hissés au niveau module (jamais recréés).
 */

const heroStyle: React.CSSProperties = {
  position: "relative",
  flex: 1.05,
  overflow: "hidden",
  // Dégradé de marque profond — suit la palette active (--mantine-color-brand-*).
  background:
    "linear-gradient(140deg, var(--mantine-color-brand-9) 0%, var(--mantine-color-brand-8) 45%, var(--mantine-color-brand-6) 100%)",
  color: "#fff",
};
// Voile lumineux STATIQUE (profondeur sans animation).
const heroGlowStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  background:
    "radial-gradient(circle at 26% 16%, rgba(255,255,255,0.16), transparent 46%), radial-gradient(circle at 88% 92%, rgba(255,255,255,0.08), transparent 42%)",
  pointerEvents: "none",
};
const glassIconStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.14)",
  color: "#fff",
  border: "1px solid rgba(255,255,255,0.18)",
};
const formColStyle: React.CSSProperties = {
  background: "var(--mantine-color-body)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  // CENTRÉ verticalement — possible SANS faire sauter les champs grâce à la zone
  // message à hauteur RÉSERVÉE (cf Login) : la hauteur totale du bloc ne change
  // pas selon qu'une erreur s'affiche ou non → le centrage reste stable.
  // `safe center` = ne rogne jamais le haut si le contenu dépasse (petit écran).
  justifyContent: "safe center",
  paddingInline: "var(--mantine-spacing-xl)",
  paddingBlock: "var(--mantine-spacing-xl)",
  overflowY: "auto",
};

interface Feature {
  icon: Icon;
  title: string;
  desc: string;
}
const FEATURES: Feature[] = [
  {
    icon: IconBolt,
    title: "Temps réel natif",
    desc: "HTTP et WebSocket, co-citoyens dans le même contexte.",
  },
  {
    icon: IconActivity,
    title: "Observabilité totale",
    desc: "Métriques, logs et traces — en direct.",
  },
  {
    icon: IconShieldLock,
    title: "Zero Trust",
    desc: "Sécurité par défaut, vos données protégées.",
  },
];

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Flex mih="100vh" align="stretch">
      {/* HERO de marque — masqué sous `md` (le formulaire prend tout l'écran). */}
      <Box visibleFrom="md" style={heroStyle}>
        <Box style={heroGlowStyle} aria-hidden />
        <Flex
          direction="column"
          justify="space-between"
          h="100%"
          p={48}
          style={{ position: "relative" }}
        >
          <Group gap={14} align="center">
            <NodefonyLogo height={42} />
            <Text fw={700} fz={26} c="white" lh={1}>
              Nodefony Studio
            </Text>
          </Group>

          <Stack gap="xl" maw={480}>
            <Stack gap="sm">
              <Text fz={{ base: 34, lg: 42 }} fw={800} lh={1.12} c="white">
                Le temps réel, nativement.
              </Text>
              <Text fz="lg" c="rgba(255,255,255,0.82)">
                Observez, comprenez et contrôlez chaque sous-système de Nodefony
                — en direct.
              </Text>
            </Stack>
            <Stack gap="lg">
              {FEATURES.map((f) => (
                <Group key={f.title} gap="md" wrap="nowrap" align="flex-start">
                  <ThemeIcon size={42} radius="md" style={glassIconStyle}>
                    <f.icon size={22} stroke={1.7} />
                  </ThemeIcon>
                  <div>
                    <Text fw={600} c="white">
                      {f.title}
                    </Text>
                    <Text size="sm" c="rgba(255,255,255,0.78)">
                      {f.desc}
                    </Text>
                  </div>
                </Group>
              ))}
            </Stack>
          </Stack>

          <Group justify="space-between">
            <Text size="xs" c="rgba(255,255,255,0.65)">
              Nodefony 10 · licence CeCILL-B
            </Text>
            <Anchor
              href="https://github.com/nodefony/nodefony-core"
              target="_blank"
              rel="noreferrer noopener"
              c="rgba(255,255,255,0.7)"
            >
              <Group gap={6}>
                <IconBrandGithub size={16} />
                <Text size="xs">GitHub</Text>
              </Group>
            </Anchor>
          </Group>
        </Flex>
      </Box>

      {/* Colonne FORMULAIRE — fond du thème (clair/sombre). */}
      <Box flex={1} style={formColStyle}>
        <Stack gap="xl" w="100%" maw={400}>
          {/* Logo compact — visible seulement quand le hero est masqué (mobile). */}
          <Group gap={8} hiddenFrom="md" justify="center">
            <NodefonyLogo height={30} />
            <Text fw={700} size="lg" c="brand">
              Nodefony Studio
            </Text>
          </Group>
          {children}
        </Stack>
      </Box>
    </Flex>
  );
}
