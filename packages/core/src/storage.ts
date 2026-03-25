import { readFile, writeFile, rename, appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  await rename(tmpPath, filePath);
}

export async function readJson<T = unknown>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function appendJsonl(filePath: string, record: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, JSON.stringify(record) + '\n', 'utf-8');
}

export async function readJsonl<T = unknown>(filePath: string): Promise<T[]> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as T);
  } catch (err: any) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}
