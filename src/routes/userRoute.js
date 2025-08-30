import express from 'express';
import { createUser, deleteUsers, getAllUser, getUserById, updateUser } from '../controllers/userControllers.js';

const router = express.Router();

router.post("/user",createUser);
router.get("/user",getAllUser);
router.get("/user/:id",getUserById);
router.put("/user/:id",updateUser);
router.delete("/user/:id",deleteUsers);

export default router