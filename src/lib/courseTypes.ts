export type Lesson = {
  id: string; // relative path
  name: string;
  file: File;
  moduleId: string;
};

export type Module = {
  id: string;
  name: string;
  lessons: Lesson[];
};

export type Course = {
  name: string;
  modules: Module[];
  totalLessons: number;
};

export type StoredProgress = {
  name: string;
  lastOpened: number;
  totalLessons: number;
  completed: string[]; // lesson ids
  times: Record<string, number>; // lesson id -> currentTime
  lessonDurations: Record<string, number>; // lesson id -> duration in seconds
  lastLessonId?: string;
  lastLessonName?: string;
};
