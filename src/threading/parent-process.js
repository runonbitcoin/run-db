const { parentPort, workerData } = require('worker_threads')
const { Port } = require('./port')

// class ParentProcess {
//   constructor () {
//     this.port = new Port(parentPort)
//     this.data = workerData
//   }
//
//   async send (topic, data) {
//     return this.port.send(topic, data)
//   }
// }

const instance = new Port(parentPort)

module.exports = { instance, workerData }
