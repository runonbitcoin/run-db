class ApiError extends Error {
  constructor (msg, errorCode, httpCode, extraData = {}) {
    super(msg)
    this.errorCode = errorCode
    this.httpCode = httpCode
    this.extraData = extraData
  }
}

module.exports = { ApiError }
