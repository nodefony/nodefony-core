/**
 * Config @nodefony/studio. Surcharge `module-frontend` (@nodefony/frontend).
 */
const config = {
  "module-frontend": {
    // HTTPS Vite avec certs Nodefony — évite mixed-content quand la page
    // est servie par server-https (5152).
    https: true,
  },
};

export default config;
