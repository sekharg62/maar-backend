import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
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
import createUserTable from "./data/createUserTable.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

///----MIDDLEWARES

app.use(cors());

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

app.get("/api/public/test", (req, res) => {
  res.json({
    success: true,
    message: "Public route is working 🚀",
    timestamp: new Date().toISOString(),
  });
});
app.use("/api/superadmin", superadminRoutes);
app.use("/api/teacher", teacherRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/admin", adminRoute);

app.use("/upload", uploadRoutes);
app.use("/signature", signatureRoutes);
/// ----Error Handling middleware
app.use(errorHandling);

///Create table before starting the server
createUserTable();
/* app.post("/submit-form", async (req, res) => {
  const { roll, password } = req.body;

  console.log("roll and pass::", roll, password);

  const browser = await puppeteer.launch({ headless: false , defaultViewport: null, args: ['--start-maximized'], }); // use headless: false to see actions
  const page = await browser.newPage();
  await page.goto("https://makaut1.ucanapply.com/smartexam/public/");

  // STEP 1: Click the div that triggers the login popup
  await page.waitForSelector('a[onclick="openLoginPage(\'4\');"]');
await page.click('a[onclick="openLoginPage(\'4\');"]');

  // STEP 2: Wait for the login modal to appear
  await page.waitForSelector("#username", { visible: true });
  await page.focus("#username");
  await page.keyboard.type(String(roll));

  await page.focus("#password");
  await page.keyboard.type(String(password));

  // STEP 4: Click the login button
  await page.click('a[onclick="postLogin();"]');
  // Adjust selector if necessary

  // STEP 5 (optional): Wait for navigation or check for login success
  await page.waitForNavigation(3000);

  console.log("Login completed.");

  // await browser.close();
}); */

console.log("index");
//-------Testing POSTGRES Connect.get
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
