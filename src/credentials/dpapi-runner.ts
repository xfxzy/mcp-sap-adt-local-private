import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

type DpapiOperation = "protect" | "unprotect";

export class DpapiRunner {
  constructor(
    private readonly scriptPath = fileURLToPath(
      new URL("../../scripts/dpapi.ps1", import.meta.url),
    ),
    private readonly executable = "powershell.exe",
  ) {}

  protect(value: string): Promise<string> {
    return this.run("protect", value);
  }

  unprotect(value: string): Promise<string> {
    return this.run("unprotect", value);
  }

  private run(operation: DpapiOperation, value: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.executable,
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          this.scriptPath,
          operation,
        ],
        { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
      );
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("error", () => reject(new Error(`DPAPI ${operation} failed`)));
      child.once("close", (code) => {
        if (code !== 0) {
          const detail = Buffer.concat(stderr).toString("utf8").trim();
          reject(
            new Error(
              `DPAPI ${operation} failed${detail ? `: ${detail}` : ""}`,
            ),
          );
          return;
        }
        resolve(Buffer.concat(stdout).toString("utf8").trim());
      });

      child.stdin.end(`${value}\n`, "utf8");
    });
  }
}
