class DelayedTask {
  constructor (fn, timeMs) {
    this.timeout = setTimeout(fn, timeMs)
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