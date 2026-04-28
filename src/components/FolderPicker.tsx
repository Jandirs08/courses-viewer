import { forwardRef, useImperativeHandle, useRef } from "react";
import { Button } from "@/components/ui/button";
import { FolderOpen } from "lucide-react";

type Props = {
  onFiles: (files: File[]) => void;
  variant?: "hero" | "default" | "outline" | "secondary";
  size?: "default" | "sm" | "lg";
  label?: string;
  className?: string;
  hidden?: boolean;
};

export type FolderPickerHandle = {
  open: () => void;
};

export const FolderPicker = forwardRef<FolderPickerHandle, Props>(function FolderPicker(
  { onFiles, variant = "default", size = "default", label = "Seleccionar carpeta del curso", className, hidden },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    open: () => inputRef.current?.click(),
  }));

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        // @ts-expect-error non-standard attributes for directory selection
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
      {!hidden && (
        <Button
          type="button"
          variant={variant === "hero" ? "default" : variant}
          size={size}
          className={
            variant === "hero"
              ? `bg-gradient-to-r from-primary to-primary-glow text-primary-foreground shadow-[var(--shadow-elegant)] hover:opacity-95 ${className || ""}`
              : className
          }
          onClick={() => inputRef.current?.click()}
        >
          <FolderOpen className="mr-2 h-5 w-5" />
          {label}
        </Button>
      )}
    </>
  );
});
