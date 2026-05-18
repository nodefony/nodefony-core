/**
 * Config du module test consumer @nodefony/frontend.
 *
 * Surcharge module-frontend pour le POC perf : on garde les defaults Vite
 * (port 5173, host 127.0.0.1, autoStart en dev).
 */
const config = {
  "module-frontend": {
    // Active HTTPS Vite avec les certs Nodefony (service `certificates`).
    // Évite le mixed-content quand la page est servie par server-https (5152).
    https: true,
  },
};

export default config;
