// db.js
const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",          // default user
  host: "localhost",
  database: "maar-db",       // your DB name
  password: "sekharG@2002", // replace with the password you set
  port: 5432,                // default PostgreSQL port
});

module.exports = pool;
