
export interface Logger {
  debug: (msg: string) => void;
  warn: () => void;
  error: (error: Error) => void;
  info: (key: string) => void;
}
