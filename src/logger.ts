
const { DEBUG } = require('./config')
  
export interface Logger {
  debug: (msg: string) => void;
  warn: () => void;
  error: (error: Error) => void;
  info: (key: string) => void;
}

export const logger: Logger = {
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: DEBUG ? console.debug.bind(console) : () => {}
}


