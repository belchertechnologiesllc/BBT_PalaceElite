import type { ReactNode } from "react";

type SlideOverWidth = "sm" | "md" | "lg";

type SlideOverProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: SlideOverWidth;
  onClose: () => void;
};

const widthClass: Record<SlideOverWidth, string> = {
  sm: "slideover-sm",
  md: "slideover-md",
  lg: "slideover-lg",
};

export function SlideOver({
  open,
  title,
  children,
  footer,
  width = "md",
  onClose,
}: SlideOverProps) {
  if (!open) return null;

  return (
    <>
      <div
        className="slideover-backdrop"
        onClick={onClose}
      />

      <aside
        className={`slideover ${widthClass[width]}`}
        role="dialog"
        aria-modal="true"
      >
        <header className="slideover-header">
          <h2>{title}</h2>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="slideover-body">
          {children}
        </div>

        {footer && (
          <footer className="slideover-footer">
            {footer}
          </footer>
        )}
      </aside>
    </>
  );
}
