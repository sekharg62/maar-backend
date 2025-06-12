// swagger.js
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Your API Name",
      version: "1.0.0",
      description: "API documentation for your Node.js project"
    },
    servers: [
      {
        url: "http://localhost:3000", // change to your server's URL
      },
    ],
  },
  apis: ["./routes/*.js"], // path to your route files with Swagger comments
};

const specs = swaggerJsdoc(options);

module.exports = { swaggerUi, specs };
