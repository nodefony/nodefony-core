/**
 * Config du module test consumer @nodefony/frontend.
 *
 * Surcharge module-frontend pour le POC perf : on garde les defaults Vite
 * (port 5173, host 127.0.0.1, autoStart en dev).
 */
const config = {
  "module-frontend": {
    // surcharge possible : devHost, devPort, startupTimeoutMs, pipeViteLogs…
  },
};

export default config;
