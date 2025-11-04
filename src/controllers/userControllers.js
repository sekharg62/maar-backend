import {
  createUsersService,
  getAllUsersService,
  getUserByIdService,
} from "../models/userModel.js";

const handleResponse = (res, status, message, data = null) => {
  res.status(status).json({
    status,
    message,
    data,
  });
};

export const createUser = async (req, res, next) => {
  const { name, email } = req.body;
  try {
    const newUser = await createUsersService(name, email);
    handleResponse(res, 201, "User Created Successfully", newUser);
  } catch (err) {
    next(err);
  }
};

export const getAllUser = async (req, res, next) => {
  try {
    const users = await getAllUsersService();
    handleResponse(res, 200, "User Fetched Successfully", users);
  } catch (err) {
    next(err);
  }
};

export const getUserById = async (req, res, next) => {
  try {
    const user = await getUserByIdService(req.params.id);
    if (!user) handleResponse(res, 404, "User not found");
    handleResponse(res, 200, "User Fetched Successfully", user);
  } catch (err) {
    next(err);
  }
};

export const updateUser = async (req, res, next) => {
  const { name, email } = req.body;

  try {
    const updateUser = await updateUsersService(req.params.id, name, email);
    if (!user) handleResponse(res, 404, "User not found");
    handleResponse(res, 200, "User Updated Successfully", updateUser);
  } catch (err) {
    next(err);
  }
};

export const deleteUsers = async (req, res, next) => {
  try {
    const deleteUser = await deleteUsersService(req.params.id);
    if (!user) handleResponse(res, 404, "User not found");
    handleResponse(res, 200, "User Deleted Successfully", deleteUser);
  } catch (err) {
    next(err);
  }
};
