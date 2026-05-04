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
  source?: string;
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
  const [fileDetails, setFileDetails] = useState({
    name: '',
    description: '',
    source: '',
    recordedAt: '',  // ISO local datetime, e.g. "2026-05-04T18:30"
  });

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(Array.from(e.target.files));
    }
  };

  const handleFiles = (fileList: File[]) => {
    // Store pending files and show modal for details
    setPendingFiles(fileList);
    setShowFileDetailsModal(true);
    // Reset form
    setFileDetails({
      name: fileList.length === 1 ? fileList[0].name.replace(/\.[^/.]+$/, '') : '',
      description: '',
      source: '',
      recordedAt: '',
    });
  };

  const confirmFileUpload = () => {
    if (!fileDetails.name.trim()) {
      alert('Please provide a name for the file(s)');
      return;
    }
    if (!fileDetails.recordedAt) {
      alert('Please pick the date and time the audio was recorded.');
      return;
    }

    const recordedAt = fileDetails.recordedAt;
    const filesToUpload = [...pendingFiles];
    const newFiles: UploadedFile[] = filesToUpload.map((file, index) => ({
      id: `file-${Date.now()}-${index}`,
      name: fileDetails.name + (filesToUpload.length > 1 ? ` (${index + 1})` : ''),
      filename: file.name,
      description: fileDetails.description,
      source: fileDetails.source,
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
    // Step 1: send file — backend saves it and returns immediately
    let audioId: number;
    try {
      const result = await audios.upload(file, name, description, userId, recordedAt);
      audioId = result.id;
      setFiles(prev => prev.map(f =>
        f.id === fileId ? { ...f, audioId, status: 'processing', progress: 20 } : f
      ));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setFiles(prev => prev.map(f =>
        f.id === fileId ? { ...f, status: 'error', progress: 0, errorMessage: msg } : f
      ));
      return;
    }

    // Step 2: poll until ML finishes
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
          setFiles(prev => prev.map(f =>
            f.id === fileId ? { ...f, status: 'completed', progress: 100, progressLabel: undefined } : f
          ));
          return;
        }
        if (audio.status === 'failed') {
          setFiles(prev => prev.map(f =>
            f.id === fileId ? { ...f, status: 'error', progress: 0, progressLabel: undefined, errorMessage: 'ML processing failed' } : f
          ));
          return;
        }
      }
    } catch {
      // ignore polling errors
    }
  };

  const removeFile = (fileId: string) => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-white text-3xl mb-2">Audio Upload</h1>
        <p className="text-slate-400">Upload audio files for analysis and processing</p>
      </div>

      {/* File Details Modal */}
      {showFileDetailsModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg w-full max-w-lg">
            <div className="p-6 border-b border-slate-800">
              <h2 className="text-white text-xl">File Details</h2>
              <p className="text-slate-400 text-sm mt-1">
                Provide details for {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''}
              </p>
            </div>

            <div className="p-6 space-y-4">
              {/* File Name */}
              <div>
                <label className="text-slate-400 text-sm mb-2 block">
                  File Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={fileDetails.name}
                  onChange={(e) => setFileDetails({ ...fileDetails, name: e.target.value })}
                  placeholder="Enter file name..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-slate-400 text-sm mb-2 block">
                  Description
                </label>
                <textarea
                  value={fileDetails.description}
                  onChange={(e) => setFileDetails({ ...fileDetails, description: e.target.value })}
                  placeholder="Enter file description..."
                  rows={3}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              {/* Recorded At */}
              <div>
                <label className="text-slate-400 text-sm mb-2 block">
                  When was this recorded? <span className="text-red-400">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={fileDetails.recordedAt}
                  onChange={(e) => setFileDetails({ ...fileDetails, recordedAt: e.target.value })}
                  max={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 scheme-dark"
                />
                <p className="text-slate-500 text-xs mt-1">Used for filtering by recording time, separate from when you uploaded.</p>
              </div>

              {/* Source */}
              <div>
                <label className="text-slate-400 text-sm mb-2 block">
                  Source/Origin
                </label>
                <input
                  type="text"
                  value={fileDetails.source}
                  onChange={(e) => setFileDetails({ ...fileDetails, source: e.target.value })}
                  placeholder="e.g., Intercept, Phone Tap, Meeting Recording..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Files to upload preview */}
              <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
                <p className="text-slate-400 text-sm mb-2">Files to upload:</p>
                <div className="space-y-1">
                  {pendingFiles.map((file, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      <FileAudio className="w-4 h-4 text-blue-400" />
                      <span className="text-slate-300">{file.name}</span>
                      <span className="text-slate-500">({formatFileSize(file.size)})</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-800 flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowFileDetailsModal(false);
                  setPendingFiles([]);
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmFileUpload}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                Upload Files
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Area */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 mb-8">
        {!mlReady && (
          <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-200 text-sm">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>
              ML models are still loading — uploads will be enabled in a moment.
            </span>
          </div>
        )}
        <div
          onDragEnter={mlReady ? handleDrag : undefined}
          onDragLeave={mlReady ? handleDrag : undefined}
          onDragOver={mlReady ? handleDrag : undefined}
          onDrop={mlReady ? handleDrop : undefined}
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
            !mlReady
              ? 'border-slate-800 opacity-50 pointer-events-none'
              : dragActive
              ? 'border-blue-500 bg-blue-500/5'
              : 'border-slate-700 hover:border-slate-600'
          }`}
        >
          <div className="flex flex-col items-center">
            <div className="bg-blue-600/10 p-4 rounded-full mb-4">
              <Upload className="w-8 h-8 text-blue-500" />
            </div>
            <h3 className="text-white text-xl mb-2">Drop audio files here</h3>
            <p className="text-slate-400 mb-4">or click to browse</p>
            <label className={`text-white px-6 py-3 rounded-lg transition-colors ${
              mlReady
                ? 'bg-blue-600 hover:bg-blue-700 cursor-pointer'
                : 'bg-slate-700 cursor-not-allowed'
            }`}>
              Select Files
              <input
                type="file"
                multiple
                accept="audio/*,.mp3,.wav,.m4a,.ogg"
                onChange={handleFileInput}
                disabled={!mlReady}
                className="hidden"
              />
            </label>
            <p className="text-slate-500 text-sm mt-4">
              Supported formats: MP3, WAV, M4A, OGG
            </p>
          </div>
        </div>
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          {(() => {
            const completed = files.filter(f => f.status === 'completed').length;
            const failed    = files.filter(f => f.status === 'error').length;
            const active    = files.filter(f => f.status === 'uploading' || f.status === 'processing').length;
            const total     = files.length;
            return (
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white">Uploads ({total})</h2>
                {total > 0 && (
                  <div className="flex items-center gap-3 text-sm">
                    {active > 0 && (
                      <span className="flex items-center gap-1.5 text-yellow-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {active} in progress
                      </span>
                    )}
                    {completed > 0 && (
                      <span className="flex items-center gap-1.5 text-green-400">
                        <CheckCircle className="w-3.5 h-3.5" />
                        {completed}/{total} done
                      </span>
                    )}
                    {failed > 0 && (
                      <span className="flex items-center gap-1.5 text-red-400">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {failed} failed
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
          <div className="space-y-3">
            {files.map((file) => (
              <div
                key={file.id}
                className="bg-slate-800 border border-slate-700 rounded-lg p-4"
              >
                <div className="flex items-start gap-4">
                  <div className="bg-blue-600/10 p-2 rounded flex-shrink-0">
                    <FileAudio className="w-5 h-5 text-blue-500" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-white mb-1 truncate">{file.name}</h4>
                        <p className="text-slate-500 text-xs truncate">{file.filename}</p>
                        {file.description && (
                          <p className="text-slate-400 text-sm mt-1">{file.description}</p>
                        )}
                        <p className="text-slate-400 text-sm">{formatFileSize(file.size)}</p>
                      </div>
                      <button
                        onClick={() => removeFile(file.id)}
                        className="text-slate-400 hover:text-white p-1 flex-shrink-0"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Status */}
                    <div className="flex items-center gap-3 mb-2">
                      {file.status === 'uploading' && (
                        <>
                          <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                          <span className="text-blue-500 text-sm">Uploading…</span>
                        </>
                      )}
                      {file.status === 'processing' && (
                        <>
                          <Loader2 className="w-4 h-4 text-yellow-500 animate-spin" />
                          <span className="text-yellow-500 text-sm">
                            {file.progressLabel || 'Analysing…'}
                          </span>
                          {file.progress > 0 && (
                            <span className="text-yellow-600 text-xs ml-1">{file.progress}%</span>
                          )}
                        </>
                      )}
                      {file.status === 'completed' && (
                        <>
                          <CheckCircle className="w-4 h-4 text-green-500" />
                          <span className="text-green-500 text-sm">Analysis complete</span>
                          {file.audioId && (
                            <Link
                              to={`/analysis/${file.audioId}`}
                              className="ml-auto flex items-center gap-1.5 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors"
                            >
                              View Analysis <ArrowRight className="w-3 h-3" />
                            </Link>
                          )}
                        </>
                      )}
                      {file.status === 'error' && (
                        <>
                          <AlertCircle className="w-4 h-4 text-red-500" />
                          <span className="text-red-500 text-sm">{file.errorMessage ?? 'Processing failed'}</span>
                        </>
                      )}
                    </div>

                    {/* Progress Bar */}
                    {file.status !== 'completed' && file.status !== 'error' && (
                      <div className="bg-slate-700 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-blue-500 h-full transition-all duration-300"
                          style={{ width: `${file.progress}%` }}
                        />
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