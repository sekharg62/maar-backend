import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Your API Name",
      version: "1.0.0",
      description: "API documentation for your Node.js project",
    },
    servers: [
      {
        url: "http://localhost:3000", // change to your server's URL
      },
    ],
  },
  apis: ["./routes/*.js"], // adjust if needed
};

const specs = swaggerJsdoc(options);

export { swaggerUi, specs };
