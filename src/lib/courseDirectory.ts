import { buildCourse } from "./courseUtils";
import type { Course } from "./courseTypes";

const DB_NAME = "local-course-handles";
const STORE_NAME = "directories";
const STORE_KEY = "courses";

type FileWithRelativePath = File & { webkitRelativePath?: string };

type RememberedDirectoryMap = Record<string, FileSystemDirectoryHandle>;
type FileSystemPermissionMode = "read" | "readwrite";
type FileSystemPermissionState = "granted" | "denied" | "prompt";
type FileHandleWithFileGetter = FileSystemFileHandle & { getFile: () => Promise<File> };
type DirectoryHandleWithExtras = FileSystemDirectoryHandle & {
  values?: () => AsyncIterable<FileSystemHandle | DirectoryHandleWithExtras | FileHandleWithFileGetter>;
  queryPermission?: (descriptor?: { mode?: FileSystemPermissionMode }) => Promise<FileSystemPermissionState>;
  requestPermission?: (descriptor?: { mode?: FileSystemPermissionMode }) => Promise<FileSystemPermissionState>;
};

declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readRememberedMap(): Promise<RememberedDirectoryMap> {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(STORE_KEY);

    request.onsuccess = () => resolve((request.result as RememberedDirectoryMap | undefined) || {});
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

async function writeRememberedMap(map: RememberedDirectoryMap): Promise<void> {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(map, STORE_KEY);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function collectFiles(
  directoryHandle: FileSystemDirectoryHandle,
  prefix = "",
): Promise<FileWithRelativePath[]> {
  const files: FileWithRelativePath[] = [];
  const handle = directoryHandle as DirectoryHandleWithExtras;
  const iterator = handle.values ? handle.values() : undefined;

  if (!iterator) {
    throw new Error("Tu navegador no expone el iterador de archivos para esta carpeta.");
  }

  for await (const entry of iterator) {
    if (entry.kind === "file") {
      const file = (await (entry as FileHandleWithFileGetter).getFile()) as FileWithRelativePath;
      Object.defineProperty(file, "webkitRelativePath", {
        value: `${prefix}${entry.name}`,
        configurable: true,
      });
      files.push(file);
      continue;
    }

    const childFiles = await collectFiles(entry as FileSystemDirectoryHandle, `${prefix}${entry.name}/`);
    files.push(...childFiles);
  }

  return files;
}

export function supportsPersistentDirectories() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function pickCourseDirectory() {
  if (!window.showDirectoryPicker) {
    throw new Error("Tu navegador no soporta seleccion persistente de carpetas.");
  }

  return window.showDirectoryPicker();
}

export async function buildCourseFromDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<Course | null> {
  const files = await collectFiles(handle, `${handle.name}/`);
  return buildCourse(files);
}

export async function rememberCourseDirectory(courseName: string, handle: FileSystemDirectoryHandle) {
  const map = await readRememberedMap();
  map[courseName] = handle;
  await writeRememberedMap(map);
}

export async function getRememberedCourseDirectory(courseName: string) {
  const map = await readRememberedMap();
  return map[courseName] || null;
}

export async function forgetRememberedCourseDirectory(courseName: string) {
  const map = await readRememberedMap();
  delete map[courseName];
  await writeRememberedMap(map);
}

export async function hasDirectoryPermission(handle: FileSystemDirectoryHandle) {
  const permissionFn = (handle as DirectoryHandleWithExtras).queryPermission;
  if (!permissionFn) return false;
  const permission = await permissionFn({ mode: "read" });
  return permission === "granted";
}

export async function requestDirectoryPermission(handle: FileSystemDirectoryHandle) {
  const permissionFn = (handle as DirectoryHandleWithExtras).requestPermission;
  if (!permissionFn) return false;
  const permission = await permissionFn({ mode: "read" });
  return permission === "granted";
}
