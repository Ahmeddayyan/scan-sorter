import { useCallback, useRef, type ReactElement } from 'react';
import { ACCEPT_ATTR, useActions } from '../state';

/** Hidden file input + a function that opens the picker. Render `input` once, call `pick()` from buttons. */
export function useFilePicker(): { input: ReactElement; pick: () => void } {
  const { addFiles } = useActions();
  const ref = useRef<HTMLInputElement>(null);
  const pick = useCallback(() => ref.current?.click(), []);
  const input = (
    <input
      ref={ref}
      type="file"
      multiple
      accept={ACCEPT_ATTR}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event) => {
        const picked = event.target.files ? Array.from(event.target.files) : [];
        event.target.value = '';
        if (picked.length > 0) addFiles(picked);
      }}
    />
  );
  return { input, pick };
}
