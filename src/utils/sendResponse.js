const sendResponse = (res, {
  status = 1,
  message = "Success",
  data = null,
  httpCode = 200
}) => {
  return res.status(httpCode).json({
    status,
    message,
    data,
  });
};

export default sendResponse;
