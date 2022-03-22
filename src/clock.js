class DelayedTask {
  constructor (fn, timeMs) {
    this.fn = fn
    this.aPromise = new Promise((resolve, reject) => {
      this.timeout = setTimeout(async () => {
        try {
          const result = await this.fn()
          resolve(result)
        } catch (e) {
          reject(e)
        }
      }, timeMs)
    })
  }

  async then (resolve, reject) {
    return this.aPromise.then(resolve, reject)
  }

  cancel () {
    clearTimeout(this.timeout)
  }
}

class Clock {
  now () {
    return new Date()
  }

  delay (callback, timeMs) {
    return new DelayedTask(callback, timeMs)
  }
}

module.exports = { Clock }
