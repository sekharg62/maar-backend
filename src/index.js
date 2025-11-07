import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pool from "./config/db.js";
import superadminRoutes from "./routes/superAdminRoutes.js";
import teacherRoutes from "./routes/teacherRoute.js";
import studentRoutes from "./routes/studentRoute.js";
import adminRoute from "./routes/adminRoute.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import signatureRoutes from "./routes/signatureRoutes.js";
import { swaggerUi, specs } from "../swagger.js";
import errorHandling from "./middlewares/errorHandler.js";
import verifyToken from "./middlewares/verifyToken.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

app.use("/api/superadmin", superadminRoutes);
app.use("/api/teacher", teacherRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/admin", adminRoute);

app.use("/api/upload", verifyToken, uploadRoutes);
app.use("/api/signature", verifyToken, signatureRoutes);
/// ----Error Handling middleware
app.use(errorHandling);

app.get("/test", async (req, res) => {
  try {
    const result = await pool.query("SELECT current_database()");
    //console.log("Query result:", result.rows); // debug log
    console.log("resule:", result);

    res.send(`The database name is: ${result.rows[0].current_database}`);
  } catch (error) {
    //console.error("Error querying database:", error);
    res.status(500).send("Error fetching database name");
  }
});

//----- Server Running
app.listen(port, () => {
  console.log(`Server running on port:${port}`);
});
