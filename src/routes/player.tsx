import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { courseStore } from "@/lib/courseStore";
import {
  flattenLessons,
  formatDuration,
  getDurationSummary,
  getProgress,
  markCompleted,
  setCompletedBulk,
  setLessonDuration,
  setLessonTime,
  upsertProgress,
} from "@/lib/courseUtils";
import type { Course, Lesson } from "@/lib/courseTypes";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CheckCheck,
  PlayCircle,
  Home,
  Gauge,
  ListChecks,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/player")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reproductor — LocalCourse" },
      { name: "description", content: "Reproduce tu curso local con temario y seguimiento de progreso." },
    ],
  }),
  component: PlayerPage,
});

const SPEEDS = [0.75, 1, 1.1, 1.2, 1.25, 1.3, 1.4, 1.5, 1.75, 2];

function useCourse(): Course | null {
  return useSyncExternalStore(
    (cb) => courseStore.subscribe(cb),
    () => courseStore.get(),
    () => null,
  );
}

function PlayerPage() {
  const course = useCourse();
  const navigate = useNavigate();

  if (!course) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-foreground">
        <h1 className="text-2xl font-semibold">No hay curso cargado</h1>
        <p className="max-w-md text-center text-muted-foreground">
          Vuelve al inicio y selecciona la carpeta de tu curso para comenzar.
        </p>
        <Button onClick={() => navigate({ to: "/" })}>
          <Home className="mr-2 h-4 w-4" /> Ir al inicio
        </Button>
      </div>
    );
  }

  return <PlayerInner course={course} />;
}

function PlayerInner({ course }: { course: Course }) {
  const all = useMemo(() => flattenLessons(course), [course]);
  const progress = getProgress(course.name);

  const initialId = progress?.lastLessonId && all.some((l) => l.id === progress.lastLessonId)
    ? progress.lastLessonId
    : all[0]?.id;

  const [currentId, setCurrentId] = useState<string | undefined>(initialId);
  const [completed, setCompleted] = useState<string[]>(progress?.completed || []);
  const [speed, setSpeed] = useState<number>(1);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [openModules, setOpenModules] = useState<string[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const urlRef = useRef<string | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const current = all.find((l) => l.id === currentId);
  const currentIdx = all.findIndex((l) => l.id === currentId);

  // Manejo del ObjectURL
  useEffect(() => {
    if (!current) return;

    console.log("[Player] Preparando lección:", {
      nombre: current.name,
      tipoArchivo: current.file.type,
      tamaño: `${(current.file.size / 1024 / 1024).toFixed(2)} MB`
    });

    const nextUrl = URL.createObjectURL(current.file);
    const previousUrl = urlRef.current;

    urlRef.current = nextUrl;
    setCurrentUrl(nextUrl);
    upsertProgress(course.name, { lastLessonId: current.id, lastLessonName: current.name });

    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
    }
  }, [course.name, current]);

  // Limpieza del ObjectURL al desmontar
  useEffect(() => {
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, []);

  // Manejo del Video (Lógica principal de reproducción y errores)
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !current || !currentUrl) return;

    const saved = getProgress(course.name)?.times[current.id] || 0;

    const handleLoadedMetadata = () => {
      setLessonDuration(course.name, current.id, v.duration || 0);
      console.log(`[Player] Metadata cargada. Duración: ${v.duration}s`);
      v.playbackRate = speed;
      if (saved > 0 && saved < (v.duration || Infinity) - 1) {
        v.currentTime = saved;
      }
    };

    const handleCanPlay = () => {
      console.log("[Player] Archivo listo para reproducir (canplay).");
      const playPromise = v.play();
      
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log("[Player] Reproducción automática iniciada con éxito.");
          })
          .catch((err) => {
            console.warn("[Player] Reproducción automática bloqueada por el navegador:", err.message);
            // No disparamos un error fatal aquí porque el usuario puede darle Play manualmente.
          });
      }
    };

    const handleError = () => {
      const mediaError = v.error;
      const format = current.file.name.split(".").pop()?.toUpperCase() || "VIDEO";
      
      let errorDesc = "Error desconocido";
      if (mediaError) {
        switch (mediaError.code) {
          case 1: errorDesc = "Carga abortada por el usuario (MEDIA_ERR_ABORTED)"; break;
          case 2: errorDesc = "Error de red (MEDIA_ERR_NETWORK)"; break;
          case 3: errorDesc = "Error de decodificación - Códec dañado o no soportado (MEDIA_ERR_DECODE)"; break;
          case 4: errorDesc = "Formato no soportado por el navegador (MEDIA_ERR_SRC_NOT_SUPPORTED)"; break;
        }
      }

      console.error("[Player] Error fatal de reproducción:", {
        archivo: current.file.name,
        formato: format,
        codigoError: mediaError?.code,
        descripcion: errorDesc,
        mensajeNativo: mediaError?.message
      });

      toast.error(`No se pudo reproducir este archivo (${format}): ${errorDesc}`);
    };

    // Resetear el estado del video antes de cargar el nuevo source
    v.pause();
    v.src = currentUrl;
    
    // Registrar listeners
    v.addEventListener("loadedmetadata", handleLoadedMetadata);
    v.addEventListener("canplay", handleCanPlay, { once: true });
    v.addEventListener("error", handleError);
    
    // Forzar carga del video
    console.log("[Player] Invocando v.load()...");
    v.load();

    return () => {
      v.pause();
      v.removeEventListener("loadedmetadata", handleLoadedMetadata);
      v.removeEventListener("canplay", handleCanPlay);
      v.removeEventListener("error", handleError);
      v.removeAttribute("src");
      v.load(); // Vaciar el buffer
    };
  }, [course.name, current, currentUrl, speed]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  }, [speed]);

  useEffect(() => {
    const currentModuleId = course.modules.find((m) => m.lessons.some((l) => l.id === currentId))?.id;
    if (!currentModuleId) return;

    setOpenModules((prev) => (prev.includes(currentModuleId) ? prev : [...prev, currentModuleId]));

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const sidebar = sidebarRef.current;
        if (!sidebar) return;

        const activeModule = sidebar.querySelector(`[data-module-id="${CSS.escape(currentModuleId)}"]`);
        if (activeModule instanceof HTMLElement) {
          activeModule.scrollIntoView({ block: "start" });
        }

        const activeLesson = sidebar.querySelector(`[data-lesson-id="${CSS.escape(currentId || "")}"]`);
        if (activeLesson instanceof HTMLElement) {
          activeLesson.scrollIntoView({ block: "nearest" });
        }
      });
    });
  }, [course.modules, currentId]);

  function handleTimeUpdate() {
    const v = videoRef.current;
    if (!v || !current) return;
    setLessonTime(course.name, current.id, v.currentTime);
    if (v.duration && v.currentTime / v.duration >= 0.95) {
      if (!completed.includes(current.id)) {
        markCompleted(course.name, current.id);
        setCompleted((prev) => (prev.includes(current.id) ? prev : [...prev, current.id]));
      }
    }
  }

  function handleEnded() {
    if (!current) return;
    markCompleted(course.name, current.id);
    setCompleted((prev) => (prev.includes(current.id) ? prev : [...prev, current.id]));
    const next = all[currentIdx + 1];
    if (next) setCurrentId(next.id);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function applyBulk(asCompleted: boolean) {
    if (selected.size === 0) {
      toast.info("No has seleccionado ninguna lección.");
      return;
    }
    const ids = Array.from(selected);
    const updated = setCompletedBulk(course.name, ids, asCompleted);
    if (updated) setCompleted(updated);
    toast.success(
      asCompleted
        ? `${ids.length} lección(es) marcadas como vistas`
        : `${ids.length} lección(es) desmarcadas`,
    );
    setSelected(new Set());
  }

  function selectAll() {
    setSelected(new Set(all.map((l) => l.id)));
  }

  function expandAllModules() {
    setOpenModules(course.modules.map((module) => module.id));
  }

  const prev = currentIdx > 0 ? all[currentIdx - 1] : null;
  const next = currentIdx >= 0 && currentIdx < all.length - 1 ? all[currentIdx + 1] : null;
  const completedCount = completed.length;
  const pct = course.totalLessons > 0 ? Math.round((completedCount / course.totalLessons) * 100) : 0;
  const courseDuration = getDurationSummary(course.name, all.map((lesson) => lesson.id));
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-4 border-b border-border bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_90%,transparent),color-mix(in_oklab,var(--background)_100%,transparent))] px-4 py-3 backdrop-blur">
        <Button asChild variant="ghost" size="sm">
          <Link to="/"><ArrowLeft className="mr-1 h-4 w-4" /> Inicio</Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{course.name}</p>
          <div className="mt-1 flex items-center gap-2">
            <Progress value={pct} className="h-1.5 max-w-xs" />
            <span className="text-xs text-muted-foreground">{formatDuration(courseDuration.watched)} / {formatDuration(courseDuration.total)}</span>
            <span className="text-xs text-muted-foreground">
              {completedCount}/{course.totalLessons} · {pct}%
            </span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="relative flex flex-1 items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_28%),_linear-gradient(180deg,_#050505,_#111)]">
            {current && currentUrl ? (
              <video
                key={current.id}
                ref={videoRef}
                src={currentUrl}
                controls
                playsInline
                preload="metadata"
                className="h-full w-full bg-black"
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleEnded}
              >
                Tu navegador no puede reproducir este video.
              </video>
            ) : (
              <p className="text-muted-foreground">Selecciona una lección</p>
            )}
          </div>
          <div className="border-t border-border bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_92%,transparent),color-mix(in_oklab,var(--background)_100%,transparent))] px-6 py-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="truncate text-lg font-semibold">{current?.name || "—"}</h2>
              <SpeedControl speed={speed} onChange={setSpeed} />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <Button
                variant="secondary"
                disabled={!prev}
                onClick={() => prev && setCurrentId(prev.id)}
              >
                <ChevronLeft className="mr-1 h-4 w-4" /> Lección anterior
              </Button>
              <Button
                disabled={!next}
                onClick={() => next && setCurrentId(next.id)}
                className="bg-gradient-to-r from-primary to-primary-glow text-primary-foreground"
              >
                Lección siguiente <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </main>

        <aside className="hidden w-[26rem] flex-shrink-0 flex-col border-l border-border bg-[linear-gradient(180deg,color-mix(in_oklab,var(--sidebar)_98%,transparent),color-mix(in_oklab,var(--background)_100%,transparent))] md:flex">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold">Temario</p>
                <p className="text-xs text-muted-foreground">{course.modules.length} módulos · {course.totalLessons} lecciones</p>
              </div>
              <Button
                size="sm"
                variant={selectMode ? "default" : "secondary"}
                onClick={() => {
                  setSelectMode((s) => !s);
                  setSelected(new Set());
                }}
              >
                {selectMode ? <><X className="mr-1 h-3.5 w-3.5" />Cerrar</> : <><ListChecks className="mr-1 h-3.5 w-3.5" />Seleccionar</>}
              </Button>
            </div>
            {selectMode && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">{selected.size} seleccionada(s)</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={selectAll}>Todas</Button>
                  <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>Ninguna</Button>
                  <Button size="sm" onClick={() => applyBulk(true)} className="bg-success/90 text-primary-foreground hover:bg-success">
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />Marcar vistas
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => applyBulk(false)}>
                    Desmarcar
                  </Button>
                </div>
              </div>
            )}
            {!selectMode && (
              <div className="mt-3">
                <Button size="sm" variant="outline" onClick={expandAllModules}>
                  Expandir todos
                </Button>
              </div>
            )}
          </div>
          <ScrollArea ref={sidebarRef} className="flex-1">
            <Accordion type="multiple" value={openModules} onValueChange={setOpenModules} className="px-2 py-2">
              {course.modules.map((mod) => {
                const modCompleted = mod.lessons.filter((l) => completed.includes(l.id)).length;
                const modSelectedCount = mod.lessons.filter((l) => selected.has(l.id)).length;
                const allModSelected = modSelectedCount === mod.lessons.length && mod.lessons.length > 0;
                const someModSelected = modSelectedCount > 0 && !allModSelected;
                const isCompletedModule = mod.lessons.length > 0 && modCompleted === mod.lessons.length;
                const moduleDuration = getDurationSummary(course.name, mod.lessons.map((lesson) => lesson.id));

                return (
                  <AccordionItem
                    key={mod.id}
                    value={mod.id}
                    data-module-id={mod.id}
                    className={cn(
                      "mb-2 rounded-xl border border-border/60 px-2",
                      isCompletedModule && "border-emerald-500/25 bg-emerald-500/6",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {selectMode && (
                        <Checkbox
                          checked={allModSelected ? true : someModSelected ? "indeterminate" : false}
                          onCheckedChange={(checked) => {
                            setSelected((prev) => {
                              const n = new Set(prev);
                              if (checked) mod.lessons.forEach((l) => n.add(l.id));
                              else mod.lessons.forEach((l) => n.delete(l.id));
                              return n;
                            });
                          }}
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Seleccionar módulo completo"
                        />
                      )}
                      <AccordionTrigger className="flex-1 px-0 text-left hover:no-underline">
                        <div className="flex w-full flex-col items-start gap-1 pr-2">
                          <div className="flex w-full items-center gap-2">
                            <span className={cn("line-clamp-2 text-sm font-medium", isCompletedModule && "text-emerald-200")}>
                              {mod.name}
                            </span>
                            {isCompletedModule ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-300">
                                <CheckCheck className="h-3 w-3" />
                                Completado
                              </span>
                            ) : null}
                          </div>
                          <span className={cn("text-xs text-muted-foreground", isCompletedModule && "text-emerald-300/80")}>
                            {modCompleted}/{mod.lessons.length}
                            {` · ${formatDuration(moduleDuration.total)}`}
                            {selectMode && modSelectedCount > 0 && ` · ${modSelectedCount} sel.`}
                          </span>
                        </div>
                      </AccordionTrigger>
                    </div>
                    <AccordionContent className="pb-2">
                      <ul className="space-y-0.5">
                        {mod.lessons.map((l) => (
                          <LessonRow
                            key={l.id}
                            lesson={l}
                            active={l.id === currentId}
                            done={completed.includes(l.id)}
                            selectMode={selectMode}
                            selected={selected.has(l.id)}
                            onToggleSelect={() => toggleSelect(l.id)}
                            onClick={() => setCurrentId(l.id)}
                          />
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}

function SpeedControl({ speed, onChange }: { speed: number; onChange: (n: number) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1 rounded-xl border border-border bg-background/60 px-2 py-1.5">
      <Gauge className="mr-1 h-3.5 w-3.5 text-primary" />
      {SPEEDS.map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={cn(
            "rounded px-1.5 py-0.5 text-xs transition-colors",
            speed === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent/40",
          )}
        >
          {s}x
        </button>
      ))}
    </div>
  );
}

function LessonRow({
  lesson,
  active,
  done,
  selectMode,
  selected,
  onClick,
  onToggleSelect,
}: {
  lesson: Lesson;
  active: boolean;
  done: boolean;
  selectMode: boolean;
  selected: boolean;
  onClick: () => void;
  onToggleSelect: () => void;
}) {
  return (
    <li>
      <div
        data-lesson-id={lesson.id}
        className={cn(
          "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
          active ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-accent/40",
        )}
      >
        {selectMode && (
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelect}
            className="mt-0.5"
            aria-label="Seleccionar lección"
          />
        )}
        <button
          onClick={selectMode ? onToggleSelect : onClick}
          className="flex flex-1 items-start gap-2 text-left"
        >
          {done ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />
          ) : active ? (
            <PlayCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
          ) : (
            <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full border border-muted-foreground/40" />
          )}
          <span className={cn("line-clamp-2", active && "font-medium text-foreground")}>{lesson.name}</span>
        </button>
      </div>
    </li>
  );
}
