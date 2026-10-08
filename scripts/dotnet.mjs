import { spawn } from "node:child_process";
import { ROOT, dotnetEnvironment, isMain, runCli } from "./lib/runtime.mjs";

export async function main(args = process.argv.slice(2)) {
  const { executable, env } = dotnetEnvironment();
  const child = spawn(executable, args, { cwd: ROOT, env, stdio: "inherit" });
  const forward = (signal) => child.kill(signal);
  const interrupt = () => forward("SIGINT");
  const terminate = () => forward("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) =>
        resolve(code ?? (signal === "SIGINT" ? 130 : 143)),
      );
    });
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}
if (isMain(import.meta.url)) await runCli(main);
