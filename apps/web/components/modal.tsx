"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";
/**
 * A native modal dialog: the browser keeps keyboard focus inside and makes the page behind it inert.
 * It opens on its first form field, Escape calls onClose (without onClose it stays open), and focus
 * returns to whatever opened it.
 */
export function Modal({
  labelledBy,
  describedBy,
  wide,
  alert,
  onClose,
  children,
}: {
  labelledBy: string;
  describedBy?: string;
  wide?: boolean;
  alert?: boolean;
  onClose?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    closing = useRef(false);
  useLayoutEffect(() => {
    const dialog = ref.current!,
      opener = document.activeElement;
    closing.current = false;
    dialog.showModal();
    dialog
      .querySelector<HTMLElement>(
        "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])",
      )
      ?.focus();
    return () => {
      // Close first: while the dialog is modal, the opener behind it is inert and cannot take focus.
      closing.current = true;
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      role={alert ? "alertdialog" : undefined}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
      // Chrome closes on a repeated Escape even after cancel is prevented; keep React in charge.
      onClose={() => {
        // Ignore the close from our own cleanup, including React's development re-mount.
        if (closing.current || ref.current?.open) return;
        if (onClose) onClose();
        else ref.current?.showModal();
      }}
    >
      {children}
    </dialog>
  );
}
