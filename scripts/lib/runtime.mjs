import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export function loadEnvironment(root = ROOT, environment = process.env) {
  const file = path.join(root, ".env");
  return {
    ...(existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {}),
    ...environment,
  };
}

export function resolveDotnet(environment = process.env) {
  const candidates = [
    ...(environment.PATH || "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((folder) => path.join(folder, "dotnet")),
    ...(environment.DOTNET_ROOT
      ? [path.join(environment.DOTNET_ROOT, "dotnet")]
      : []),
    path.join(homedir(), ".dotnet/dotnet"),
    "/usr/local/share/dotnet/dotnet",
    "/usr/share/dotnet/dotnet",
  ];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {}
  }
  throw new Error(
    "Install the .NET 10 SDK or set DOTNET_ROOT to its installation directory.",
  );
}

export function dotnetEnvironment(environment = process.env) {
  const executable = resolveDotnet(environment);
  const folder = path.dirname(executable);
  return {
    executable,
    env: {
      ...environment,
      PATH: folder + path.delimiter + (environment.PATH || ""),
      DOTNET_ROOT: environment.DOTNET_ROOT || folder,
    },
  };
}

export function isMain(url) {
  return (
    !!process.argv[1] &&
    pathToFileURL(path.resolve(process.argv[1])).href === url
  );
}

export async function runCli(main) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
