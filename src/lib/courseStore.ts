// Simple in-memory store for the currently loaded course (files can't be persisted)
import type { Course } from "./courseTypes";

let currentCourse: Course | null = null;
const listeners = new Set<() => void>();

export const courseStore = {
  get(): Course | null {
    return currentCourse;
  },
  set(course: Course | null) {
    currentCourse = course;
    listeners.forEach((l) => l());
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
