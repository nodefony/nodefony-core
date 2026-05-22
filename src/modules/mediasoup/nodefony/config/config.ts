/**
 * Config du module `mediasoup`.
 *
 * Active HTTPS Vite (certs Nodefony) pour éviter le mixed-content quand la page
 * est servie par server-https (5152) — même réglage que les autres consumers front.
 */
const config = {
  "module-frontend": {
    https: true,
  },
};

export default config;
