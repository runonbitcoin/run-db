
const { DEBUG } = require('./config')
  
export interface Logger {
  debug: (key: string, value?: any) => void;
  warn: () => void;
  error: (error: Error) => void;
  info: (key: string, value?: any) => void;
}

export const logger: Logger = {
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: DEBUG ? console.debug.bind(console) : () => {}
}


