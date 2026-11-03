import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const envPath = new URL("../.env", import.meta.url);

function askHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") throw new Error("Run this command in an interactive terminal.");
  return new Promise(resolve => {
    let value = "";
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", chunk => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") { process.stdin.setRawMode(false); process.exit(130); }
        if (character === "\r" || character === "\n") {
          process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write("\n"); resolve(value); return;
        }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else value += character;
      }
    });
  });
}

function setEnv(source, key, value) {
  const line = `${key}="${value.replaceAll('"', '\\"')}"`;
  const expression = new RegExp(`^${key}=.*$`, "m");
  return expression.test(source) ? source.replace(expression, line) : `${source.trimEnd()}\n${line}\n`;
}

let env = await readFile(envPath, "utf8").catch(() => "");
env = setEnv(env, "ADMIN_USERNAME", "abis");
if (!/^ADMIN_PASSWORD_HASH=.+$/m.test(env) || process.argv.includes("--reset-password")) {
  const password = await askHidden("Enter the initial password for abis (input hidden): ");
  if (password.length < 6) throw new Error("The initial password must have at least 6 characters.");
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  env = setEnv(env, "ADMIN_PASSWORD_HASH", `scrypt:${salt.toString("base64url")}:${hash.toString("base64url")}`);
}
if (!/^AUTH_SESSION_SECRET=.+$/m.test(env)) env = setEnv(env, "AUTH_SESSION_SECRET", randomBytes(32).toString("hex"));
await writeFile(envPath, env, "utf8");
process.stdout.write("Local admin password login is initialized. Change the temporary password after the first sign-in.\n");
