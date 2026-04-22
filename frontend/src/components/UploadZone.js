import { useCallback, useRef } from 'react';
import { Upload, X, FileText, Archive } from 'lucide-react';

export default function UploadZone({ files, setFiles }) {
  const inputRef = useRef(null);

  const ACCEPTED_EXTENSIONS = ['.pdf', '.zip', '.docx', '.doc', '.xlsx', '.xls',
    '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tiff', '.tif', '.bmp'];
  const isAccepted = (name) => {
    const n = (name || '').toLowerCase();
    return ACCEPTED_EXTENSIONS.some(ext => n.endsWith(ext));
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files).filter(f => isAccepted(f.name));
    setFiles(prev => [...prev, ...dropped]);
  }, [setFiles]);

  const handleSelect = (e) => {
    const selected = Array.from(e.target.files).filter(f => isAccepted(f.name));
    setFiles(prev => [...prev, ...selected]);
    e.target.value = '';
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  };

  return (
    <div data-testid="upload-zone-container">
      <div
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed border-slate-700 bg-slate-900/30 rounded-sm p-8 md:p-12 flex flex-col items-center justify-center hover:border-sky-500 hover:bg-slate-800/50 transition-colors cursor-pointer"
        data-testid="upload-dropzone"
      >
        <Upload className="h-8 w-8 text-slate-500 mb-3" strokeWidth={1.5} />
        <p className="text-sm text-slate-400 mb-1">Drop PDF files or a ZIP archive here</p>
        <p className="text-xs text-slate-600">or click to browse</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.zip,.docx,.doc,.xlsx,.xls,.jpg,.jpeg,.png,.webp,.heic,.heif,.tiff,.tif,.bmp"
          onChange={handleSelect}
          className="hidden"
          data-testid="file-upload-input"
        />
      </div>

      {files.length > 0 && (
        <div className="mt-3 space-y-1" data-testid="file-list">
          {files.map((file, i) => (
            <div key={i} className="flex items-center justify-between bg-[#111827] border border-slate-800 rounded-sm px-3 py-2 text-sm">
              <div className="flex items-center gap-2 text-slate-300 min-w-0">
                {file.name.toLowerCase().endsWith('.zip') ? (
                  <Archive className="h-4 w-4 text-amber-400 shrink-0" strokeWidth={1.5} />
                ) : (
                  <FileText className="h-4 w-4 text-sky-400 shrink-0" strokeWidth={1.5} />
                )}
                <span className="truncate">{file.name}</span>
                <span className="text-slate-600 font-mono text-xs shrink-0">{formatSize(file.size)}</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                className="text-slate-600 hover:text-red-400 transition-colors ml-2 shrink-0"
                data-testid={`remove-file-${i}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
