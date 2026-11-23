import { useEffect, useRef, useState } from 'react';

type Props = {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
};

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

export function UploadZone({ onFiles, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith('image/'),
      );
      if (files.length === 0) return;
      event.preventDefault();
      onFiles(files);
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onFiles]);

  return (
    <div
      className={'upload-zone' + (dragging ? ' is-dragging' : '')}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const files = Array.from(event.dataTransfer.files).filter((file) =>
          file.type.startsWith('image/'),
        );
        if (files.length > 0) onFiles(files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) onFiles(files);
          event.target.value = '';
        }}
      />

      <svg className="upload-zone__icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          d="M12 16V4m0 0 4 4m-4-4-4 4M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <div className="upload-zone__text">
        <button
          type="button"
          className="upload-zone__browse"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
        >
          Choose images
        </button>
        <span> or drop them here, or paste from the clipboard.</span>
        <span className="upload-zone__hint">JPEG, PNG, WebP, GIF · 20 MB each · 3 variants per image</span>
      </div>
    </div>
  );
}
