/**
 * bus.js
 *
 * Communication between the main program and worker threads
 */

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

let messageId = 0
const messageCallbacks = {}

// ------------------------------------------------------------------------------------------------
// sendRequest
// ------------------------------------------------------------------------------------------------

async function sendRequest (port, func, ...args) {
  return await new Promise((resolve, reject) => {
    messageCallbacks[messageId] = { resolve, reject }
    port.postMessage({ id: messageId, func, args })
    messageId++
  })
}

// ------------------------------------------------------------------------------------------------
// listen
// ------------------------------------------------------------------------------------------------

function listen (port, handlers) {
  port.on('message', async msg => {
    if (msg.response) {
      if (msg.err) {
        messageCallbacks[msg.id].reject(msg.err)
      } else {
        messageCallbacks[msg.id].resolve(msg.ret)
      }
      delete messageCallbacks[msg.id]
      return
    }

    try {
      const handler = handlers[msg.func]
      if (typeof handler !== 'function') {
        throw new Error('No handler for ' + msg.func)
      }

      const ret = await handler(...msg.args)

      port.postMessage({ response: true, id: msg.id, ret })
    } catch (e) {
      port.postMessage({ response: true, id: msg.id, err: e.message || e.toString() })
    }
  })

  port.on('error', e => {
    console.error('Worker thread error:', e)
    process.exit(1)
  })
}

// ------------------------------------------------------------------------------------------------

module.exports = { sendRequest, listen }
