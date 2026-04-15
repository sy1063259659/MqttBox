import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "@mqttbox/agent-service";

function findProjectRoot(startDir: string): string {
  let currentDir = startDir;

  while (true) {
    const packageJsonPath = join(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
        if (packageJson.name === PACKAGE_NAME) {
          return currentDir;
        }
      } catch {
        // Ignore unreadable package metadata and continue walking upward.
      }
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return startDir;
    }
    currentDir = parentDir;
  }
}

function getDataDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = findProjectRoot(moduleDir);
  const dataDir = resolve(projectRoot, "data");
  mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

export function loadJsonFile<T>(fileName: string, fallback: T): T {
  const dataDir = getDataDir();
  const filePath = join(dataDir, fileName);
  const backupPath = join(dataDir, `${fileName}.bak`);

  for (const candidatePath of [filePath, backupPath]) {
    if (!existsSync(candidatePath)) {
      continue;
    }

    try {
      const raw = readFileSync(candidatePath, "utf8");
      return JSON.parse(raw) as T;
    } catch {
      // Ignore invalid persisted snapshots and continue to the next candidate.
    }
  }

  return fallback;
}

export function writeJsonFileAtomic(fileName: string, data: unknown): void {
  const dataDir = getDataDir();
  const filePath = join(dataDir, fileName);
  const backupPath = join(dataDir, `${fileName}.bak`);
  const tempPath = join(dataDir, `${fileName}.${process.pid}.${Date.now()}.tmp`);
  const payload = `${JSON.stringify(data, null, 2)}\n`;

  writeFileSync(tempPath, payload, "utf8");

  if (existsSync(backupPath)) {
    unlinkSync(backupPath);
  }
  if (existsSync(filePath)) {
    renameSync(filePath, backupPath);
  }

  try {
    renameSync(tempPath, filePath);
    if (existsSync(backupPath)) {
      unlinkSync(backupPath);
    }
  } catch (error) {
    if (existsSync(backupPath) && !existsSync(filePath)) {
      renameSync(backupPath, filePath);
    }
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
    throw error;
  }
}
