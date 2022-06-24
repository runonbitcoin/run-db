class RemoteError extends Error {
  constructor (className, data) {
    super(`[${className}]: ${data.message}`)
    this.className = className
    this.data = data
  }

  static fromError (e) {
    return new this(e.constructor.name, e)
  }
}

module.exports = { RemoteError }
