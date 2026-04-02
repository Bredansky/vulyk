const GREEN = "\x1b[0;32m";
const RED = "\x1b[0;31m";
const YELLOW = "\x1b[1;33m";
const BLUE = "\x1b[0;34m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export const color = {
  green: (s: string) => `${GREEN}${s}${RESET}`,
  red: (s: string) => `${RED}${s}${RESET}`,
  yellow: (s: string) => `${YELLOW}${s}${RESET}`,
  blue: (s: string) => `${BLUE}${s}${RESET}`,
  dim: (s: string) => `${DIM}${s}${RESET}`,
};

export const log = {
  green: (msg: string) => console.log(color.green(msg)),
  red: (msg: string) => console.log(color.red(msg)),
  yellow: (msg: string) => console.log(color.yellow(msg)),
  blue: (msg: string) => console.log(color.blue(msg)),
  dim: (msg: string) => console.log(color.dim(msg)),
  info: (msg: string) => console.log(msg),
  error: (msg: string) => console.error(color.red(`✖ ${msg}`)),
  success: (msg: string) => console.log(color.green(`✓ ${msg}`)),
  warn: (msg: string) => console.log(color.yellow(`⚠ ${msg}`)),
};
