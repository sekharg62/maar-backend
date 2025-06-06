const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");
const bodyParser = require("body-parser");
const pool = require("./db");
const app = express();
app.use(cors());
app.use(bodyParser.json());
const superadminRoutes = require("./routes/superAdminRoutes");

//app.use("/api/superadmin", superadminRoutes);

app.post("/submit-form", async (req, res) => {
  const { roll, password } = req.body;

  console.log("roll and pass::", roll, password);

  const browser = await puppeteer.launch({ headless: false }); // use headless: false to see actions
  const page = await browser.newPage();
  await page.goto("https://makaut1.ucanapply.com/smartexam/public/");

  // STEP 1: Click the div that triggers the login popup
  await page.waitForSelector('a[onclick="openLoginPage(5);"]');
  await page.click('a[onclick="openLoginPage(5);"]');

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
});

console.log("index")

app.listen(5000, () => {
  console.log("Server running on port 5000");
});
