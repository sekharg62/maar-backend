const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
;
const app = express();
app.use(cors());
app.use(bodyParser.json());
const superadminRoutes = require("./routes/superAdminRoutes");
const teacherRoutes = require("./routes/teacherRoute");
const { swaggerUi, specs } = require("./swagger");

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));
app.use("/api/superadmin", superadminRoutes);
app.use("/api/teacher", teacherRoutes);


console.log("index")

app.listen(5000, () => {
  console.log("Server running on port 5000");
  console.log("Swagger docs at http://localhost:3000/api-docs");
});
