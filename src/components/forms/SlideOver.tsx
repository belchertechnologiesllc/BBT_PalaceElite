import { useEffect, useId, useRef, type ReactNode } from "react";

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

// Elements a keyboard user can tab to. Deliberately excludes
// [tabindex="-1"] (used on the dialog container itself as a focus-of-last-
// resort, not something Tab should ever stop on).
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SlideOver({
  open,
  title,
  children,
  footer,
  width = "md",
  onClose,
}: SlideOverProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);

  // Read fresh inside the effect on every open rather than captured once,
  // so a parent that changes its onClose identity between renders (or one
  // that recreates it via useCallback with different deps) never leaves
  // Escape/backdrop wired to a stale closure.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }

    const dialogAtOpen = dialogRef.current;
    if (!dialogAtOpen) {
      return;
    }
    // Rebound to a definitely-non-null const: TypeScript does not carry
    // the null-narrowing above into the handleKeyDown closure defined
    // further down, since it's a function declaration rather than an
    // inline callback.
    const dialog: HTMLElement = dialogAtOpen;

    // Remember whatever had focus immediately before this SlideOver
    // opened (the "View details" trigger, the "Edit benefit" button, the
    // "Add benefit" button, ...) so it can be restored on close. Captured
    // fresh on every open -- not just first mount -- so reopening the
    // same SlideOver for a different record still restores focus to
    // whichever control was actually activated that time.
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const getFocusable = (): HTMLElement[] =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    // Move focus into the SlideOver. The dialog container itself
    // (tabIndex={-1} below) is the fallback if it has no focusable
    // descendants at all.
    (getFocusable()[0] ?? dialog).focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = getFocusable();

      if (focusable.length === 0) {
        // Nothing to cycle through -- keep focus pinned on the dialog
        // container itself rather than letting it leave the SlideOver.
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);

      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div
        className="slideover-backdrop"
        onClick={onClose}
      />

      <aside
        ref={dialogRef}
        className={`slideover ${widthClass[width]}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="slideover-header">
          <h2 id={titleId}>{title}</h2>

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
