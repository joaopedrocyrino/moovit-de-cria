// Produces POSIX shell arguments for the SSH command; values are never evaluated locally.
export const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
if (isMain(import.meta.url))
  console.log(process.argv.slice(2).map(shellQuote).join(" "));
import { isMain } from "./lib/runtime.mjs";
