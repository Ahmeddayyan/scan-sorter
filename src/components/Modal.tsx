import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

interface ModalProps {
  /** Id of the element that titles the dialog. */
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLDialogElement>) => void;
  /** Close when the backdrop is clicked. Default true. */
  dismissible?: boolean;
}

/** Native modal dialog: focus trap, Esc to close, inert background. Mount it only while open. */
export function Modal({ labelledBy, onClose, children, wide, onKeyDown, dismissible = true }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    if (!dialog.open) dialog.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal${wide ? ' modal--wide' : ''}`}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
      onKeyDown={onKeyDown}
    >
      {children}
    </dialog>
  );
}
