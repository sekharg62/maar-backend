
import dotenv from 'dotenv';
dotenv.config();

import pkg from 'pg';
const { Pool } = pkg;

//console.log("DATABASE_URL:", process.env.DATABASE_URL);
/* const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
   ssl: {
    rejectUnauthorized: false,  // important for Supabase
  },
}); */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, 
  ssl: {
    rejectUnauthorized: false, // allows self-signed cert from Supabase
  },
});

export default pool;


