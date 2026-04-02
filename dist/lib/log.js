const GREEN = "\x1b[0;32m";
const RED = "\x1b[0;31m";
const YELLOW = "\x1b[1;33m";
const BLUE = "\x1b[0;34m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
export const color = {
    green: (s) => `${GREEN}${s}${RESET}`,
    red: (s) => `${RED}${s}${RESET}`,
    yellow: (s) => `${YELLOW}${s}${RESET}`,
    blue: (s) => `${BLUE}${s}${RESET}`,
    dim: (s) => `${DIM}${s}${RESET}`,
};
export const log = {
    green: (msg) => console.log(color.green(msg)),
    red: (msg) => console.log(color.red(msg)),
    yellow: (msg) => console.log(color.yellow(msg)),
    blue: (msg) => console.log(color.blue(msg)),
    dim: (msg) => console.log(color.dim(msg)),
    info: (msg) => console.log(msg),
    error: (msg) => console.error(color.red(`✖ ${msg}`)),
    success: (msg) => console.log(color.green(`✓ ${msg}`)),
    warn: (msg) => console.log(color.yellow(`⚠ ${msg}`)),
};
