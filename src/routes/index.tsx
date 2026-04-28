import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { FolderPicker, type FolderPickerHandle } from "@/components/FolderPicker";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  PlayCircle,
  Trash2,
  BookOpen,
  FolderOpen,
  Terminal,
  Copy,
  Wrench,
  Library,
} from "lucide-react";
import {
  buildCourse,
  deleteProgress,
  ensureCourseDurations,
  formatDuration,
  getDurationSummary,
  getProgress,
  loadAllProgress,
  upsertProgress,
} from "@/lib/courseUtils";
import { courseStore } from "@/lib/courseStore";
import {
  buildCourseFromDirectoryHandle,
  forgetRememberedCourseDirectory,
  getRememberedCourseDirectory,
  hasDirectoryPermission,
  pickCourseDirectory,
  rememberCourseDirectory,
  requestDirectoryPermission,
  supportsPersistentDirectories,
} from "@/lib/courseDirectory";
import type { Course, StoredProgress } from "@/lib/courseTypes";
import { toast } from "sonner";

const SCRIPT_PATH = "C:\\Users\\User\\Downloads\\zzz\\course-companion-main\\course-companion-main\\scripts\\convert-course-videos.ps1";
const DEFAULT_SOURCE_DIR = "D:\\Spring Framework & Spring Boot desde cero a experto";
const DEFAULT_OUTPUT_DIR = "D:\\Spring Framework & Spring Boot desde cero a experto-web";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LocalCourse - Reproductor de cursos locales" },
      { name: "description", content: "Reproduce y organiza tus cursos locales estilo Udemy con seguimiento de progreso." },
    ],
  }),
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const [recents, setRecents] = useState<StoredProgress[]>([]);
  const [sourceDir, setSourceDir] = useState(DEFAULT_SOURCE_DIR);
  const [outputDir, setOutputDir] = useState(DEFAULT_OUTPUT_DIR);
  const [supportsPersistent, setSupportsPersistent] = useState(false);
  const [isOpeningPersistent, setIsOpeningPersistent] = useState(false);
  const [preparingCourse, setPreparingCourse] = useState<{ name: string; completed: number; total: number } | null>(null);
  const expectedCourseRef = useRef<string | null>(null);
  const pickerRef = useRef<FolderPickerHandle>(null);

  useEffect(() => {
    refreshRecents();
    document.documentElement.classList.add("dark");
    setSupportsPersistent(supportsPersistentDirectories());
  }, []);

  function refreshRecents() {
    const all = loadAllProgress();
    setRecents(Object.values(all).sort((a, b) => b.lastOpened - a.lastOpened));
  }

  function persistCourse(course: Course) {
    courseStore.set(course);
    const existing = getProgress(course.name);

    upsertProgress(course.name, {
      name: course.name,
      totalLessons: course.totalLessons,
      completed: existing?.completed || [],
      times: existing?.times || {},
      lastLessonId: existing?.lastLessonId,
      lastLessonName: existing?.lastLessonName,
    });
  }

  async function finishCourseOpen(course: Course) {
    persistCourse(course);
    setPreparingCourse({ name: course.name, completed: 0, total: course.totalLessons });
    await ensureCourseDurations(course, undefined, ({ completed, total }) => {
      setPreparingCourse({ name: course.name, completed, total });
    });
    setPreparingCourse(null);
    refreshRecents();
    expectedCourseRef.current = null;
    navigate({ to: "/player" });
  }

  function handleFiles(files: File[]) {
    const course = buildCourse(files);
    if (!course) {
      toast.error("No se encontraron archivos de video en esa carpeta.");
      return;
    }

    if (expectedCourseRef.current && expectedCourseRef.current !== course.name) {
      toast.error(`Carpeta incorrecta. Selecciona la carpeta "${expectedCourseRef.current}".`);
      expectedCourseRef.current = null;
      return;
    }

    void finishCourseOpen(course);
  }

  async function openPersistentDirectory(expectedCourseName?: string) {
    if (!supportsPersistentDirectories()) {
      pickerRef.current?.open();
      return;
    }

    try {
      setIsOpeningPersistent(true);
      const handle = await pickCourseDirectory();
      const course = await buildCourseFromDirectoryHandle(handle);

      if (!course) {
        toast.error("No se encontraron archivos de video en esa carpeta.");
        return;
      }

      if (expectedCourseName && course.name !== expectedCourseName) {
        toast.error(`Carpeta incorrecta. Selecciona la carpeta "${expectedCourseName}".`);
        return;
      }

      await rememberCourseDirectory(course.name, handle);
      await finishCourseOpen(course);
      toast.success("Curso guardado para reabrirlo sin volver a buscar la carpeta.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message && !message.includes("aborted") && !message.includes("AbortError")) {
        toast.error(message);
      }
    } finally {
      setIsOpeningPersistent(false);
    }
  }

  async function handleResumeClick(courseName: string) {
    expectedCourseRef.current = courseName;

    try {
      const loadedCourse = courseStore.get();
      if (loadedCourse?.name === courseName) {
        navigate({ to: "/player" });
        return;
      }

      const rememberedHandle = await getRememberedCourseDirectory(courseName);

      if (rememberedHandle) {
        const granted = await hasDirectoryPermission(rememberedHandle);

        if (granted || await requestDirectoryPermission(rememberedHandle)) {
          const course = await buildCourseFromDirectoryHandle(rememberedHandle);

          if (!course) {
            toast.error("La carpeta recordada ya no tiene videos validos.");
            await forgetRememberedCourseDirectory(courseName);
            return;
          }

          await finishCourseOpen(course);
          return;
        }
      }

      toast.info(
        supportsPersistent
          ? `No pude reabrir "${courseName}" automaticamente. Seleccionala de nuevo una vez y quedara recordada.`
          : `Selecciona de nuevo la carpeta "${courseName}" para continuar.`,
      );

      if (supportsPersistent) {
        await openPersistentDirectory(courseName);
      } else {
        pickerRef.current?.open();
      }
    } catch {
      toast.error("No se pudo reabrir la carpeta recordada.");
    } finally {
      expectedCourseRef.current = null;
    }
  }

  function transcodeCommand() {
    return `powershell -ExecutionPolicy Bypass -File "${SCRIPT_PATH}" -InputDir "${sourceDir}" -OutputDir "${outputDir}"`;
  }

  async function copyTranscodeCommand() {
    try {
      await navigator.clipboard.writeText(transcodeCommand());
      toast.success("Comando copiado.");
    } catch {
      toast.error("No se pudo copiar el comando.");
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {preparingCourse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/88 backdrop-blur-sm">
          <Card className="w-full max-w-md border-border/70 bg-card/95 p-6">
            <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Preparando curso</p>
            <h3 className="mt-2 text-xl font-semibold">{preparingCourse.name}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Calculando duraciones de los videos para mostrar horas reales por curso y modulo.
            </p>
            <Progress
              value={preparingCourse.total > 0 ? Math.round((preparingCourse.completed / preparingCourse.total) * 100) : 0}
              className="mt-5 h-2.5"
            />
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{preparingCourse.completed}/{preparingCourse.total} videos</span>
              <span className="font-medium">
                {preparingCourse.total > 0 ? Math.round((preparingCourse.completed / preparingCourse.total) * 100) : 0}%
              </span>
            </div>
          </Card>
        </div>
      )}
      <FolderPicker ref={pickerRef} onFiles={handleFiles} hidden />

      <header className="border-b border-border/70">
        <div
          className="mx-auto max-w-6xl px-6 py-8"
        >
          <div className="flex flex-col gap-6 rounded-[2rem] border border-border/70 bg-[linear-gradient(135deg,color-mix(in_oklab,var(--card)_90%,transparent),color-mix(in_oklab,var(--background)_100%,transparent))] p-6 shadow-[0_24px_80px_-48px_rgba(0,0,0,0.9)] lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">LocalCourse</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight">Tus cursos</h1>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                size="lg"
                className="min-w-52 bg-gradient-to-r from-primary to-primary-glow text-primary-foreground shadow-[var(--shadow-elegant)]"
                onClick={() => {
                  if (supportsPersistent) {
                    void openPersistentDirectory();
                  } else {
                    pickerRef.current?.open();
                  }
                }}
                disabled={isOpeningPersistent}
              >
                <Library className="mr-2 h-5 w-5" />
                {supportsPersistent ? "Abrir curso y recordarlo" : "Seleccionar carpeta del curso"}
              </Button>

              <Button
                size="lg"
                variant="secondary"
                className="border border-border/80 bg-background/60"
                onClick={() => pickerRef.current?.open()}
              >
                <FolderOpen className="mr-2 h-5 w-5" />
                Selector clasico
              </Button>

              <TranscodeDialog
                sourceDir={sourceDir}
                outputDir={outputDir}
                onSourceDirChange={setSourceDir}
                onOutputDirChange={setOutputDir}
                onCopyCommand={copyTranscodeCommand}
                command={transcodeCommand()}
              />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-6 flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h2 className="text-2xl font-semibold">Cursos recientes</h2>
        </div>

        {recents.length === 0 ? (
          <Card className="flex min-h-64 flex-col items-center justify-center gap-3 border-dashed bg-card/50 p-12 text-center">
            <p className="text-lg font-medium">Todavia no hay cursos cargados.</p>
          </Card>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {recents.map((recent) => {
              const pct = recent.totalLessons > 0
                ? Math.round((recent.completed.length / recent.totalLessons) * 100)
                : 0;
              const duration = getDurationSummary(recent.name);

              return (
                <Card
                  key={recent.name}
                  role="button"
                  tabIndex={0}
                  onClick={() => void handleResumeClick(recent.name)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void handleResumeClick(recent.name);
                    }
                  }}
                  className="group relative overflow-hidden border-border/70 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_78%,transparent),color-mix(in_oklab,var(--background)_92%,transparent))] p-6 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-[var(--shadow-elegant)]"
                >
                  <div
                    className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ background: "linear-gradient(135deg, color-mix(in oklab, var(--primary) 9%, transparent), transparent 45%)" }}
                  />
                  <div className="relative">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Curso</p>
                        <h3 className="mt-2 line-clamp-2 text-lg font-semibold leading-tight">{recent.name}</h3>
                      </div>
                      <button
                        title="Eliminar del historial"
                        className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteProgress(recent.name);
                          void forgetRememberedCourseDirectory(recent.name);
                          refreshRecents();
                          toast.success("Curso eliminado del historial");
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="mt-5 rounded-2xl border border-border/60 bg-background/50 p-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Progreso</span>
                        <span className="font-medium">{pct}%</span>
                      </div>
                      <Progress value={pct} className="mt-3 h-2.5" />
                      <p className="mt-3 text-xs text-muted-foreground">
                        {recent.completed.length} de {recent.totalLessons} lecciones vistas
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDuration(duration.watched)} / {formatDuration(duration.total)}
                      </p>
                    </div>

                    {recent.lastLessonName && (
                      <p className="mt-4 line-clamp-1 text-sm text-muted-foreground">
                        Ultima leccion: <span className="text-foreground">{recent.lastLessonName}</span>
                      </p>
                    )}

                    <div className="mt-5 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-primary">
                        <PlayCircle className="h-4 w-4" />
                        <span>Reanudar curso</span>
                      </div>
                      <div className="rounded-full border border-primary/20 px-2.5 py-1 text-[11px] text-muted-foreground">
                        Click para abrir
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function TranscodeDialog({
  sourceDir,
  outputDir,
  onSourceDirChange,
  onOutputDirChange,
  onCopyCommand,
  command,
}: {
  sourceDir: string;
  outputDir: string;
  onSourceDirChange: (value: string) => void;
  onOutputDirChange: (value: string) => void;
  onCopyCommand: () => void;
  command: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="lg" variant="outline" className="border-border/80 bg-background/50">
          <Wrench className="mr-2 h-5 w-5" />
          Herramientas
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl border-border bg-card/95 p-0 backdrop-blur">
        <div className="border-b border-border px-6 py-5">
          <DialogHeader>
            <DialogTitle className="text-2xl">Conversion por lote</DialogTitle>
            <DialogDescription>
              Si algunos videos no son compatibles con el navegador, genera aqui el comando para convertir todo el curso
              manteniendo carpetas y modulos.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="grid gap-5 px-6 py-6 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Carpeta origen</label>
            <Input value={sourceDir} onChange={(event) => onSourceDirChange(event.target.value)} />
            <p className="text-xs text-muted-foreground">Curso original en USB o disco local.</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Carpeta destino</label>
            <Input value={outputDir} onChange={(event) => onOutputDirChange(event.target.value)} />
            <p className="text-xs text-muted-foreground">Nueva carpeta con MP4 compatibles listos para web.</p>
          </div>
        </div>

        <div className="px-6 pb-6">
          <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Terminal className="h-4 w-4 text-primary" />
              Comando listo para PowerShell
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-black/30 p-4 font-mono text-xs text-muted-foreground">
              {command}
            </pre>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button onClick={onCopyCommand}>
                <Copy className="mr-2 h-4 w-4" />
                Copiar comando
              </Button>
              <Button variant="secondary" onClick={() => toast.info("Instala ffmpeg, abre PowerShell y pega el comando.")}>
                Ver pasos
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
