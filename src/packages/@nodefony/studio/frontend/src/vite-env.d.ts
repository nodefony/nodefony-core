/// <reference types="vite/client" />

// Mantine v8 expose des fichiers CSS via "@mantine/<package>/styles.css".
// Vite gère ces imports nativement (CSS bundler) — on déclare ici pour TS.
declare module "@mantine/core/styles.css";
declare module "@mantine/notifications/styles.css";
declare module "@mantine/modals/styles.css";
declare module "@mantine/dates/styles.css";
declare module "*.css";
