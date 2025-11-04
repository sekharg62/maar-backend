import pool from "../config/db.js";

export const getAllUsersService = async () => {
  const result = await pool.query("SELECT * FROM users");
  return result.rows;
};
export const getUserByIdService = async (id) => {
  const result = await pool.query("SELECT * FROM users where id = $1");
  return result.rows[0];
};
export const createUsersService = async (name, email) => {
  const result = await pool.query(
    "INSERT INTO users (name,email) VALUES ($1,$2) RETURNING *",
    [name, email]
  );

  return result.rows[0];
};
export const updateUsersService = async (id, name, email) => {
  const result = await pool.query(
    "UPDATE users SET name=$1 , email=$2 WHERE id = $3 RETURNING *",
    [name, email, id]
  );
  return result.rows[0];
};
export const deleteUsersService = async (id) => {
  const result = await pool.query(
    "DELETE FROM users WHERE id = $1 RETURNNING *",
    [id]
  );
  return result.rows[0];
};
