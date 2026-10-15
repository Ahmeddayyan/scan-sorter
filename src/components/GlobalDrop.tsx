import { useEffect, useState } from 'react';
import { useActions } from '../state';
import { Icon } from './Icon';
import './GlobalDrop.css';

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName));
}

/** Window-wide drag-and-drop and Ctrl+V paste. Renders a full-screen hint while dragging files. */
export function GlobalDrop() {
  const { addFiles } = useActions();
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let depth = 0;
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const files = event.dataTransfer ? Array.from(event.dataTransfer.files) : [];
      if (files.length > 0) addFiles(files);
    };
    const onPaste = (event: ClipboardEvent) => {
      const files = event.clipboardData ? Array.from(event.clipboardData.files) : [];
      if (files.length === 0 || isEditable(event.target)) return;
      event.preventDefault();
      const stamp = Date.now();
      addFiles(
        files.map((file, i) =>
          /^image\.\w+$/i.test(file.name)
            ? new File([file], `pasted-image-${stamp}-${i + 1}.${file.type.split('/')[1] ?? 'png'}`, { type: file.type })
            : file,
        ),
      );
    };
    const onEnd = () => {
      depth = 0;
      setDragging(false);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', onEnd);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', onEnd);
      window.removeEventListener('paste', onPaste);
    };
  }, [addFiles]);

  useEffect(() => {
    document.documentElement.toggleAttribute('data-dragging', dragging);
  }, [dragging]);

  if (!dragging) return null;
  return (
    <div className="global-drop" aria-hidden="true">
      <div className="global-drop__card">
        <Icon name="upload" />
        <strong>Drop to add scans</strong>
        <span>PDF, JPG, PNG or WebP</span>
      </div>
    </div>
  );
}
