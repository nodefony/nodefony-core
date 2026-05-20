/**
 * Config du module test consumer Vue de @nodefony/frontend.
 *
 * Active HTTPS Vite (certs Nodefony) pour éviter le mixed-content quand la
 * page est servie par server-https (5152) — identique au module React POC.
 */
const config = {
  "module-frontend": {
    https: true,
  },
};

export default config;
