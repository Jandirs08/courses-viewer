import type { Course, Lesson, Module, StoredProgress } from "./courseTypes";

const VIDEO_EXT = [".mp4", ".mkv", ".webm", ".mov", ".m4v"];
const STORAGE_KEY = "udemy-local-progress";

export function isVideo(name: string) {
  const lower = name.toLowerCase();
  return VIDEO_EXT.some((ext) => lower.endsWith(ext));
}

export function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function buildCourse(files: File[]): Course | null {
  const videos = files.filter((f) => isVideo(f.name));
  if (videos.length === 0) return null;

  // webkitRelativePath e.g. "MyCourse/01 - Intro/01 - hello.mp4"
  const first = videos[0] as File & { webkitRelativePath?: string };
  const rootName = (first.webkitRelativePath || first.name).split("/")[0] || "Curso";

  const moduleMap = new Map<string, Lesson[]>();

  for (const f of videos) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const parts = rel.split("/");
    // parts[0] = root. If only [root, file] -> module = "Lecciones"
    let moduleName = "Lecciones";
    let lessonName = parts[parts.length - 1];
    if (parts.length >= 3) {
      moduleName = parts[1];
      lessonName = parts.slice(2).join(" / ");
    }
    const lessonId = rel;
    const moduleId = `${rootName}/${moduleName}`;
    const lesson: Lesson = {
      id: lessonId,
      name: lessonName.replace(/\.[^.]+$/, ""),
      file: f,
      moduleId,
    };
    if (!moduleMap.has(moduleId)) moduleMap.set(moduleId, []);
    moduleMap.get(moduleId)!.push(lesson);
  }

  const modules: Module[] = Array.from(moduleMap.entries())
    .map(([id, lessons]) => ({
      id,
      name: id.split("/").slice(1).join("/") || "Lecciones",
      lessons: lessons.sort((a, b) => naturalCompare(a.name, b.name)),
    }))
    .sort((a, b) => naturalCompare(a.name, b.name));

  const totalLessons = modules.reduce((acc, m) => acc + m.lessons.length, 0);

  return { name: rootName, modules, totalLessons };
}

export function flattenLessons(course: Course): Lesson[] {
  return course.modules.flatMap((m) => m.lessons);
}

type ProgressMap = Record<string, StoredProgress>;

function normalizeProgressEntry(name: string, value: Partial<StoredProgress> | undefined): StoredProgress {
  return {
    name,
    lastOpened: value?.lastOpened || Date.now(),
    totalLessons: value?.totalLessons || 0,
    completed: Array.isArray(value?.completed) ? value!.completed : [],
    times: value?.times && typeof value.times === "object" ? value.times : {},
    lessonDurations:
      value?.lessonDurations && typeof value.lessonDurations === "object" ? value.lessonDurations : {},
    lastLessonId: value?.lastLessonId,
    lastLessonName: value?.lastLessonName,
  };
}

export function loadAllProgress(): ProgressMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, Partial<StoredProgress>>;
    const normalized = Object.fromEntries(
      Object.entries(raw).map(([name, value]) => [name, normalizeProgressEntry(name, value)]),
    ) as ProgressMap;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return {};
  }
}

export function saveAllProgress(map: ProgressMap) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function getProgress(courseName: string): StoredProgress | undefined {
  return loadAllProgress()[courseName];
}

export function upsertProgress(name: string, patch: Partial<StoredProgress>) {
  const all = loadAllProgress();
  const prev: StoredProgress = normalizeProgressEntry(name, all[name]);
  all[name] = { ...prev, ...patch, lastOpened: Date.now() };
  saveAllProgress(all);
  return all[name];
}

export function markCompleted(name: string, lessonId: string) {
  const all = loadAllProgress();
  const prev = all[name] ? normalizeProgressEntry(name, all[name]) : null;
  if (!prev) return;
  if (!prev.completed.includes(lessonId)) {
    prev.completed = [...prev.completed, lessonId];
    all[name] = prev;
    saveAllProgress(all);
  }
}

export function setCompletedBulk(name: string, lessonIds: string[], completed: boolean) {
  const all = loadAllProgress();
  const prev = all[name] ? normalizeProgressEntry(name, all[name]) : null;
  if (!prev) return;
  const set = new Set(prev.completed);
  for (const id of lessonIds) {
    if (completed) set.add(id);
    else set.delete(id);
  }
  prev.completed = Array.from(set);
  all[name] = prev;
  saveAllProgress(all);
  return prev.completed;
}

export function setLessonTime(name: string, lessonId: string, time: number) {
  const all = loadAllProgress();
  const prev = all[name] ? normalizeProgressEntry(name, all[name]) : null;
  if (!prev) return;
  prev.times[lessonId] = time;
  prev.lastLessonId = lessonId;
  all[name] = prev;
  saveAllProgress(all);
}

export function deleteProgress(name: string) {
  const all = loadAllProgress();
  delete all[name];
  saveAllProgress(all);
}

export function setLessonDuration(name: string, lessonId: string, duration: number) {
  const all = loadAllProgress();
  const prev = all[name] ? normalizeProgressEntry(name, all[name]) : null;
  if (!prev) return;
  prev.lessonDurations[lessonId] = duration;
  all[name] = prev;
  saveAllProgress(all);
}

export function setLessonDurations(name: string, durations: Record<string, number>) {
  const all = loadAllProgress();
  const prev = all[name] ? normalizeProgressEntry(name, all[name]) : null;
  if (!prev) return;
  prev.lessonDurations = { ...prev.lessonDurations, ...durations };
  all[name] = prev;
  saveAllProgress(all);
}

export function getDurationSummary(
  courseName: string,
  lessonIds?: string[],
) {
  const progress = getProgress(courseName);
  if (!progress) return { total: 0, watched: 0 };

  const ids = lessonIds || Object.keys(progress.lessonDurations || {});
  let total = 0;
  let watched = 0;

  for (const lessonId of ids) {
    const duration = progress.lessonDurations[lessonId] || 0;
    const currentTime = progress.times[lessonId] || 0;
    total += duration;
    watched += progress.completed.includes(lessonId)
      ? duration
      : Math.min(currentTime, duration);
  }

  return { total, watched };
}

export function formatDuration(seconds: number) {
  if (!seconds || seconds <= 0) return "0m";

  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function loadVideoDuration(file: File) {
  return new Promise<number>((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);

    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };

    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      cleanup();
      resolve(duration);
    };
    video.onerror = () => {
      cleanup();
      resolve(0);
    };
    video.src = url;
  });
}

export async function ensureCourseDurations(
  course: Course,
  lessonIds?: string[],
  onProgress?: (progress: { completed: number; total: number }) => void,
) {
  const progress = getProgress(course.name);
  const knownDurations = progress?.lessonDurations || {};
  const allowedIds = lessonIds ? new Set(lessonIds) : null;
  const candidateLessons = flattenLessons(course).filter((lesson) => {
    if (allowedIds && !allowedIds.has(lesson.id)) return false;
    return true;
  });
  const lessons = candidateLessons.filter((lesson) => {
    if (allowedIds && !allowedIds.has(lesson.id)) return false;
    return !knownDurations[lesson.id];
  });
  const total = candidateLessons.length;
  let completed = total - lessons.length;
  onProgress?.({ completed, total });
  if (lessons.length === 0) return;

  const durationEntries: Array<readonly [string, number]> = [];
  for (const lesson of lessons) {
    const duration = await loadVideoDuration(lesson.file);
    durationEntries.push([lesson.id, duration] as const);
    completed += 1;
    onProgress?.({ completed, total });
  }
  setLessonDurations(course.name, Object.fromEntries(durationEntries));
}
