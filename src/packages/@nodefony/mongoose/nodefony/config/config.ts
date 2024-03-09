import nodefony from "nodefony";

/**
 *   OVERRIDE ORM BUNDLE MONGOOSE
 *
 *       @see MONGO BUNDLE config for more options
 *       @more options https://mongoosejs.com/docs/connections.html
 *              https://mongoosejs.com/docs/api.html#mongoose_Mongoose-createConnection
 *
 *       By default nodefony create connector name nodefony
 *       for manage Sessions / Users
 */

const connectors = {
  nodefony: {},
};

switch (nodefony.kernel?.appEnvironment.environment) {
  case "production":
  case "development":
  default:
    connectors.nodefony = {
      host: "localhost",
      port: 27017,
      dbname: "nodefony",
      // credentials: vault,
      options: {
        user: "nodefony",
        pass: "nodefony",
        maxPoolSize: 50,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      },
    };
}

const config = {
  debug: true,
  connectors,
};

export default config;
