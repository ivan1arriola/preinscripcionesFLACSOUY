import React, { useEffect, useRef, useState } from 'react';
import type { DocumentDefinition, SubmissionFileToken } from '@flacso/contracts';
import { rememberPreview } from '../domain/file-previews.js';
import type { PendingUpload } from '../domain/pending-upload.js';
import { UploadingFileRow } from './UploadingFileRow.js';

interface UploadItem extends PendingUpload {
  id: string;
  file: File;
  status: 'uploading' | 'error';
  error?: string;
}

export interface ResumableFileUploaderProps {
  document: DocumentDefinition;
  disabled: boolean;
  availableSlots: number;
  onUpload: (fieldKey: string, file: File, onProgress?: (percent: number, remainingSeconds?: number) => void) => Promise<SubmissionFileToken>;
  onUploaded: (token: SubmissionFileToken) => void;
  onError?: (message: string) => void;
  className?: string;
  onActiveChange?: (active: boolean) => void;
}

const accepts = (document: DocumentDefinition, type: string) => !type || !document.acceptedMimeTypes?.length || document.acceptedMimeTypes.includes(type);

export const ResumableFileUploader: React.FC<ResumableFileUploaderProps> = ({ document, disabled, availableSlots, onUpload, onUploaded, onError, className = 'dropzone', onActiveChange }) => {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragState, setDragState] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [announcement, setAnnouncement] = useState('');
  const dragDepth = useRef(0);
  const urls = useRef(new Map<string, string>());
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = `file-${document.key}`;

  const release = (id: string) => {
    const url = urls.current.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.current.delete(id);
  };

  useEffect(() => () => { for (const url of urls.current.values()) URL.revokeObjectURL(url); }, []);
  useEffect(() => onActiveChange?.(items.length > 0), [items.length, onActiveChange]);

  const run = async (item: UploadItem) => {
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'uploading', error: undefined, updatedAt: Date.now() } : entry));
    setAnnouncement(`Subiendo ${item.name}`);
    try {
      const token = await onUpload(document.key, item.file, (percent, remainingSeconds) => {
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, percent: Math.max(0, Math.min(100, Math.round(percent))), remainingSeconds, updatedAt: Date.now() } : entry));
      });
      rememberPreview(token.token, item.file);
      onUploaded(token);
      setAnnouncement(`${item.name} se cargó correctamente`);
      release(item.id);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo cargar el archivo.';
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'error', error: message } : entry));
      setAnnouncement(`No se pudo cargar ${item.name}: ${message}`);
      onError?.(message);
    }
  };

  const addFiles = (selected: File[]) => {
    const room = Math.max(0, availableSlots - items.length);
    selected.slice(0, room).forEach((file) => {
      const id = `${Date.now()}-${Math.random()}`;
      const previewUrl = file.type.startsWith('image/') && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined;
      if (previewUrl) urls.current.set(id, previewUrl);
      const item: UploadItem = { id, file, name: file.name, size: file.size, mimeType: file.type, previewUrl, percent: 0, status: 'uploading' };
      setItems((current) => [...current, item]);
      void run(item);
    });
  };

  const dismiss = (id: string) => {
    release(id);
    setItems((current) => current.filter((entry) => entry.id !== id));
  };

  const unavailable = disabled || availableSlots <= items.length;
  const inspectDrag = (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    const types = Array.from(event.dataTransfer.items).filter((item) => item.kind === 'file').map((item) => item.type);
    setDragState(types.length > 0 && types.some((type) => !accepts(document, type)) ? 'invalid' : 'valid');
  };

  return <>
    <label
      htmlFor={inputId}
      className={`${className}${dragState === 'valid' ? ' is-dragging' : ''}${dragState === 'invalid' ? ' is-dragging-invalid' : ''}${unavailable ? ' is-busy' : ''}`}
      onDragEnter={(event) => { dragDepth.current += 1; inspectDrag(event); }}
      onDragOver={inspectDrag}
      onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragState('idle'); }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragState('idle');
        if (!unavailable) addFiles(Array.from(event.dataTransfer.files).filter((file) => accepts(document, file.type)));
      }}
    >
      {dragState === 'invalid' ? 'Ese tipo de archivo no está admitido' : dragState === 'valid' ? 'Soltá para agregar' : 'Agregar o arrastrar archivos'}
      <span className="sr-only"> para {document.label}</span>
      <input ref={inputRef} id={inputId} type="file" multiple={availableSlots > 1} accept={[...(document.acceptedMimeTypes ?? []), '.wspimage'].join(',')} disabled={unavailable}
        onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} className="sr-only" />
    </label>
    <div className="sr-only" aria-live="polite">{dragState === 'invalid' ? 'El tipo de archivo arrastrado no está admitido.' : dragState === 'valid' ? 'Archivo compatible. Soltá para cargarlo.' : announcement}</div>
    {items.length > 0 && <ul className="file-list">
      {items.map((item) => <li className="file-list__item" key={item.id}>
        <UploadingFileRow upload={item} onRetry={item.status === 'error' ? () => void run(item) : undefined} onDismiss={item.status === 'error' ? () => dismiss(item.id) : undefined} />
      </li>)}
    </ul>}
  </>;
};
