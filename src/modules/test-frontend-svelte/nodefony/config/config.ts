/**
 * Config du module test consumer Svelte de @nodefony/frontend.
 *
 * Active HTTPS Vite (certs Nodefony) pour éviter le mixed-content quand la
 * page est servie par server-https (5152) — identique aux modules React/Vue POC.
 */
const config = {
  "module-frontend": {
    https: true,
  },
};

export default config;
