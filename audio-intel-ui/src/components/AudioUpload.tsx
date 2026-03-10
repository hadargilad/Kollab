import { useState } from 'react';
import { Upload, FileAudio, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

interface UploadedFile {
  id: string;
  name: string;
  filename: string;
  description: string;
  size: number;
  duration?: string;
  source?: string;
  status: 'uploading' | 'processing' | 'completed' | 'error';
  progress: number;
}

export default function AudioUpload() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [showFileDetailsModal, setShowFileDetailsModal] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileDetails, setFileDetails] = useState({
    name: '',
    description: '',
    source: '',
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
    });
  };

  const confirmFileUpload = () => {
    if (!fileDetails.name.trim()) {
      alert('Please provide a name for the file(s)');
      return;
    }

    const newFiles: UploadedFile[] = pendingFiles.map((file, index) => ({
      id: `file-${Date.now()}-${index}`,
      name: fileDetails.name + (pendingFiles.length > 1 ? ` (${index + 1})` : ''),
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

    // Simulate upload and processing
    newFiles.forEach(file => {
      simulateUpload(file.id);
    });
  };

  const simulateUpload = (fileId: string) => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 30;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        setFiles(prev => prev.map(f => 
          f.id === fileId ? { ...f, status: 'processing', progress: 100 } : f
        ));
        setTimeout(() => {
          setFiles(prev => prev.map(f => 
            f.id === fileId ? { ...f, status: 'completed' } : f
          ));
        }, 2000);
      } else {
        setFiles(prev => prev.map(f => 
          f.id === fileId ? { ...f, progress: Math.min(progress, 100) } : f
        ));
      }
    }, 500);
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
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
            dragActive
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
            <label className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg cursor-pointer transition-colors">
              Select Files
              <input
                type="file"
                multiple
                accept="audio/*,.mp3,.wav,.m4a,.ogg"
                onChange={handleFileInput}
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
          <h2 className="text-white mb-4">Uploads ({files.length})</h2>
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
                    <div className="flex items-center gap-2 mb-2">
                      {file.status === 'uploading' && (
                        <>
                          <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                          <span className="text-blue-500 text-sm">Uploading...</span>
                        </>
                      )}
                      {file.status === 'processing' && (
                        <>
                          <Loader2 className="w-4 h-4 text-yellow-500 animate-spin" />
                          <span className="text-yellow-500 text-sm">Processing audio...</span>
                        </>
                      )}
                      {file.status === 'completed' && (
                        <>
                          <CheckCircle className="w-4 h-4 text-green-500" />
                          <span className="text-green-500 text-sm">Analysis complete</span>
                        </>
                      )}
                      {file.status === 'error' && (
                        <>
                          <AlertCircle className="w-4 h-4 text-red-500" />
                          <span className="text-red-500 text-sm">Processing failed</span>
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