function formatIso(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sendJsonError(res, status, errorCode, message) {
  return res.status(status).json({
    success: false,
    error: errorCode,
    message
  });
}

function sendServerError(res, logLabel, errorCode, error) {
  console.error(logLabel, error);
  return sendJsonError(res, 500, errorCode, getErrorMessage(error));
}

module.exports = {
  formatIso,
  getErrorMessage,
  sendJsonError,
  sendServerError
};
