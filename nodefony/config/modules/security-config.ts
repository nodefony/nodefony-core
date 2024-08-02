import { optionsSecuredArea, HelmetOptions } from "@nodefony/security";

const config = {
  watch: true,

  firewalls: {
    main: {
      path: new RegExp("/.*", "u"),
      helmet: {} as HelmetOptions,
      cors: {},
    } as optionsSecuredArea,
  },
};

export default config;
