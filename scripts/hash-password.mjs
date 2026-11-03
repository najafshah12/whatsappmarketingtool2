import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
function readHiddenPassword() {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    process.stderr.write("Run this command in an interactive terminal so the password can be entered without echo.\n");
    process.exit(1);
  }
  return new Promise(resolve => {
    let password = "";
    process.stdout.write("Enter the initial admin password (input is hidden): ");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", chunk => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") { process.stdin.setRawMode(false); process.exit(130); }
        if (character === "\r" || character === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          resolve(password);
          return;
        }
        if (character === "\u007f" || character === "\b") password = password.slice(0, -1);
        else password += character;
      }
    });
  });
}

const password = await readHiddenPassword();
  if (password.length < 6) {
    process.stderr.write("Use at least 6 characters for the initial password.\n");
    process.exitCode = 1;
  } else {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  process.stdout.write(`scrypt:${salt.toString("base64url")}:${hash.toString("base64url")}\n`);
  }
