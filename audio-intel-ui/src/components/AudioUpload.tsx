import { useState } from 'react';
import { Upload, FileAudio, X, CheckCircle, AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { audios } from '../lib/api';
import { useMlStatus } from '../hooks/useMlStatus';

interface UploadedFile {
  id: string;
  audioId?: number;
  name: string;
  filename: string;
  description: string;
  size: number;
  status: 'uploading' | 'processing' | 'completed' | 'error';
  progress: number;
  progressLabel?: string;
  errorMessage?: string;
}

interface Props {
  userId: number;
}

export default function AudioUpload({ userId }: Props) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const { ready: mlReady } = useMlStatus();
  const [showFileDetailsModal, setShowFileDetailsModal] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileDetails, setFileDetails] = useState({ name: '', description: '', source: '', recordedAt: '' });

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) handleFiles(Array.from(e.dataTransfer.files));
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(Array.from(e.target.files));
  };

  const handleFiles = (fileList: File[]) => {
    setPendingFiles(fileList);
    setShowFileDetailsModal(true);
    setFileDetails({
      name: fileList.length === 1 ? fileList[0].name.replace(/\.[^/.]+$/, '') : '',
      description: '', source: '', recordedAt: '',
    });
  };

  const confirmFileUpload = () => {
    if (!fileDetails.name.trim()) { alert('Please provide a name for the file(s)'); return; }
    if (!fileDetails.recordedAt) { alert('Please pick the date and time the audio was recorded.'); return; }

    const recordedAt = fileDetails.recordedAt;
    const filesToUpload = [...pendingFiles];
    const newFiles: UploadedFile[] = filesToUpload.map((file, index) => ({
      id: `file-${Date.now()}-${index}`,
      name: fileDetails.name + (filesToUpload.length > 1 ? ` (${index + 1})` : ''),
      filename: file.name,
      description: fileDetails.description,
      size: file.size,
      status: 'uploading',
      progress: 0,
    }));

    setFiles(prev => [...prev, ...newFiles]);
    setShowFileDetailsModal(false);
    setPendingFiles([]);
    filesToUpload.forEach((file, index) => {
      doUpload(newFiles[index].id, file, newFiles[index].name, fileDetails.description, recordedAt);
    });
  };

  const doUpload = async (fileId: string, file: File, name: string, description: string, recordedAt: string) => {
    let audioId: number;
    try {
      const result = await audios.upload(file, name, description, userId, recordedAt);
      audioId = result.id;
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, audioId, status: 'processing', progress: 20 } : f));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'error', progress: 0, errorMessage: msg } : f));
      return;
    }

    try {
      while (true) {
        await new Promise(r => setTimeout(r, 3000));
        const [audio, prog] = await Promise.all([
          audios.get(audioId),
          audios.getProgress(audioId).catch(() => ({ pct: 0, label: '' })),
        ]);
        setFiles(prev => prev.map(f =>
          f.id === fileId
            ? { ...f, progress: prog.pct > 0 ? Math.max(20, prog.pct) : f.progress, progressLabel: prog.label || f.progressLabel }
            : f
        ));
        if (audio.status === 'processed') {
          setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'completed', progress: 100, progressLabel: undefined } : f));
          return;
        }
        if (audio.status === 'failed') {
          setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'error', progress: 0, progressLabel: undefined, errorMessage: 'ML processing failed' } : f));
          return;
        }
      }
    } catch { /* ignore polling errors */ }
  };

  const removeFile = (fileId: string) => setFiles(prev => prev.filter(f => f.id !== fileId));

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const inputCls = 'w-full bg-black border border-zinc-800 rounded px-3 py-2.5 text-white text-sm placeholder-zinc-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 transition-all';

  return (
    <div className="p-6 space-y-5">
      <div>
        <div className="text-zinc-600 text-[10px] font-mono uppercase tracking-widest mb-1">Ingest</div>
        <h1 className="text-white text-2xl font-bold tracking-tight">Audio Upload</h1>
        <p className="text-zinc-500 text-sm mt-0.5">Upload audio recordings for intelligence analysis</p>
      </div>

      {/* File details modal */}
      {showFileDetailsModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-md w-full max-w-lg shadow-2xl">
            <div className="px-5 py-4 border-b border-zinc-800">
              <h2 className="text-white font-semibold">File Details</h2>
              <p className="text-zinc-500 text-xs mt-0.5">
                Metadata for {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''}
              </p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-zinc-500 text-[10px] font-mono uppercase tracking-widest block mb-1.5">
                  File Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={fileDetails.name}
                  onChange={(e) => setFileDetails({ ...fileDetails, name: e.target.value })}
                  placeholder="Enter file name…"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-zinc-500 text-[10px] font-mono uppercase tracking-widest block mb-1.5">Description</label>
                <textarea
                  value={fileDetails.description}
                  onChange={(e) => setFileDetails({ ...fileDetails, description: e.target.value })}
                  placeholder="Brief description…"
                  rows={2}
                  className={inputCls + ' resize-none'}
                />
              </div>
              <div>
                <label className="text-zinc-500 text-[10px] font-mono uppercase tracking-widest block mb-1.5">
                  Recorded At <span className="text-red-400">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={fileDetails.recordedAt}
                  onChange={(e) => setFileDetails({ ...fileDetails, recordedAt: e.target.value })}
                  max={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                  className={inputCls + ' scheme-dark font-mono'}
                />
                <p className="text-zinc-700 text-xs font-mono mt-1">Used for temporal filtering.</p>
              </div>
              <div>
                <label className="text-zinc-500 text-[10px] font-mono uppercase tracking-widest block mb-1.5">Source / Origin</label>
                <input
                  type="text"
                  value={fileDetails.source}
                  onChange={(e) => setFileDetails({ ...fileDetails, source: e.target.value })}
                  placeholder="e.g. Intercept, Phone Tap, Meeting…"
                  className={inputCls}
                />
              </div>
              <div className="bg-black border border-zinc-900 rounded p-3">
                <p className="text-zinc-600 text-xs font-mono mb-2">FILES TO UPLOAD</p>
                <div className="space-y-1">
                  {pendingFiles.map((file, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs font-mono">
                      <FileAudio className="w-3.5 h-3.5 text-zinc-600" />
                      <span className="text-zinc-400">{file.name}</span>
                      <span className="text-zinc-700">({formatFileSize(file.size)})</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-zinc-800 flex gap-2 justify-end">
              <button
                onClick={() => { setShowFileDetailsModal(false); setPendingFiles([]); }}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white text-sm rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmFileUpload}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
              >
                Start Upload
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drop zone */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-6">
        {!mlReady && (
          <div className="mb-4 flex items-center gap-2.5 px-4 py-3 rounded bg-amber-500/8 border border-amber-500/25 text-amber-300 text-sm">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>ML models loading — uploads available shortly.</span>
          </div>
        )}
        <div
          onDragEnter={mlReady ? handleDrag : undefined}
          onDragLeave={mlReady ? handleDrag : undefined}
          onDragOver={mlReady ? handleDrag : undefined}
          onDrop={mlReady ? handleDrop : undefined}
          className={`border-2 border-dashed rounded transition-colors p-10 text-center ${
            !mlReady
              ? 'border-zinc-900 opacity-40 pointer-events-none'
              : dragActive
              ? 'border-blue-500 bg-blue-500/4'
              : 'border-zinc-800 hover:border-zinc-600'
          }`}
        >
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 bg-zinc-800 border border-zinc-700 rounded-md flex items-center justify-center mb-4">
              <Upload className="w-6 h-6 text-zinc-500" />
            </div>
            <h3 className="text-white font-semibold mb-1">Drop audio files here</h3>
            <p className="text-zinc-500 text-sm mb-4">or click to browse files</p>
            <label className={`inline-flex items-center gap-2 px-5 py-2.5 rounded text-sm font-medium transition-colors cursor-pointer ${
              mlReady ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
            }`}>
              <FileAudio className="w-4 h-4" />
              Select Files
              <input type="file" multiple accept="audio/*,.mp3,.wav,.m4a,.ogg"
                onChange={handleFileInput} disabled={!mlReady} className="hidden" />
            </label>
            <p className="text-zinc-700 text-xs font-mono mt-4">MP3 · WAV · M4A · OGG</p>
          </div>
        </div>
      </div>

      {/* Upload list */}
      {files.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-md">
          {(() => {
            const completed = files.filter(f => f.status === 'completed').length;
            const failed    = files.filter(f => f.status === 'error').length;
            const active    = files.filter(f => f.status === 'uploading' || f.status === 'processing').length;
            return (
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
                <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">
                  Uploads ({files.length})
                </span>
                <div className="flex items-center gap-3 text-xs font-mono">
                  {active > 0 && <span className="text-amber-400">{active} active</span>}
                  {completed > 0 && <span className="text-emerald-400">{completed} done</span>}
                  {failed > 0 && <span className="text-red-400">{failed} failed</span>}
                </div>
              </div>
            );
          })()}

          <div className="divide-y divide-zinc-800">
            {files.map((file) => (
              <div key={file.id} className="px-5 py-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-zinc-800 border border-zinc-700 rounded flex items-center justify-center shrink-0">
                    <FileAudio className="w-4 h-4 text-zinc-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-1">
                      <div className="min-w-0">
                        <h4 className="text-white text-sm font-medium truncate">{file.name}</h4>
                        <p className="text-zinc-600 text-xs font-mono truncate">{file.filename}</p>
                        <p className="text-zinc-600 text-xs font-mono">{formatFileSize(file.size)}</p>
                      </div>
                      <button onClick={() => removeFile(file.id)} className="text-zinc-600 hover:text-white p-1 shrink-0 ml-2">
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center gap-2.5 mt-2">
                      {file.status === 'uploading' && (
                        <><Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" /><span className="text-blue-400 text-xs font-mono">Uploading…</span></>
                      )}
                      {file.status === 'processing' && (
                        <>
                          <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                          <span className="text-amber-400 text-xs font-mono">{file.progressLabel || 'Analysing…'}</span>
                          {file.progress > 0 && <span className="text-amber-600 text-xs font-mono">{file.progress}%</span>}
                        </>
                      )}
                      {file.status === 'completed' && (
                        <>
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400 text-xs font-mono">Complete</span>
                          {file.audioId && (
                            <Link to={`/analysis/${file.audioId}`}
                              className="ml-auto flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors">
                              View <ArrowRight className="w-3 h-3" />
                            </Link>
                          )}
                        </>
                      )}
                      {file.status === 'error' && (
                        <><AlertCircle className="w-3.5 h-3.5 text-red-400" /><span className="text-red-400 text-xs font-mono">{file.errorMessage ?? 'Failed'}</span></>
                      )}
                    </div>

                    {file.status !== 'completed' && file.status !== 'error' && (
                      <div className="mt-2.5 bg-zinc-800 rounded-full h-1 overflow-hidden">
                        <div className="bg-blue-500 h-full transition-all duration-300" style={{ width: `${file.progress}%` }} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
