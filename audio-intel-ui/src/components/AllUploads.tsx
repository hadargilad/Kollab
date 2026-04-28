import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileAudio, Search, Filter, Calendar, CheckCircle, Clock, AlertCircle, PlayCircle, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { audios, type AudioRecord } from '../lib/api';

export default function AllUploads() {
  const [uploads, setUploads] = useState<AudioRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [retrying, setRetrying] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<AudioRecord | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchAndSchedule = () => {
      audios.list()
        .then(data => {
          if (cancelled) return;
          setUploads(data);
          setLoading(false);
          // If any file is still processing, poll again in 5 s
          if (data.some(u => u.status === 'processing')) {
            setTimeout(() => { if (!cancelled) fetchAndSchedule(); }, 5000);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setError('Failed to load uploads. Make sure the backend is running.');
            setLoading(false);
          }
        });
    };

    fetchAndSchedule();
    return () => { cancelled = true; };
  }, []);

  const filteredUploads = uploads.filter(upload => {
    const matchesSearch =
      upload.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      upload.description.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' || upload.status === statusFilter;

    const uploadDate = new Date(upload.uploadedAt);
    const now = new Date();
    const daysDiff = Math.floor((now.getTime() - uploadDate.getTime()) / (1000 * 60 * 60 * 24));
    let matchesDate = true;
    if (dateFilter === 'today') matchesDate = daysDiff === 0;
    else if (dateFilter === 'week') matchesDate = daysDiff <= 7;
    else if (dateFilter === 'month') matchesDate = daysDiff <= 30;

    return matchesSearch && matchesStatus && matchesDate;
  });

  const formatDuration = (seconds: number) => {
    if (!seconds) return '—';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '—';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('he-IL', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleRetry = async (id: number) => {
    setRetrying(prev => new Set(prev).add(id));
    try {
      await audios.retry(id);
      setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'processing' } : u));
    } catch {
      // leave as failed
    } finally {
      setRetrying(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const handleDelete = async (id: number) => {
    setDeleting(prev => new Set(prev).add(id));
    try {
      await audios.remove(id);
      setUploads(prev => prev.filter(u => u.id !== id));
      setConfirmDelete(null);
    } catch {
      setError('Failed to delete file. Please try again.');
    } finally {
      setDeleting(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'processed':  return <CheckCircle className="w-5 h-5 text-green-400" />;
      case 'processing': return <Clock className="w-5 h-5 text-blue-400" />;
      case 'failed':     return <AlertCircle className="w-5 h-5 text-red-400" />;
      default:           return null;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'processed':  return 'Processed';
      case 'processing': return 'Processing';
      case 'failed':     return 'Failed';
      default:           return status;
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-white mb-2">All Uploads</h1>
        <p className="text-slate-400">View and search all uploaded audio files</p>
      </div>

      {/* Search and Filters */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-1">
            <label className="text-slate-400 text-sm mb-2 block">Search Files</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="Search by name or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="text-slate-400 text-sm mb-2 block">Status</label>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white appearance-none focus:outline-none focus:border-blue-500"
              >
                <option value="all">All Status</option>
                <option value="processed">Processed</option>
                <option value="processing">Processing</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-slate-400 text-sm mb-2 block">Date Range</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white appearance-none focus:outline-none focus:border-blue-500"
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="week">Last 7 Days</option>
                <option value="month">Last 30 Days</option>
              </select>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-800">
          <p className="text-slate-400 text-sm">
            {loading ? 'Loading...' : `Showing ${filteredUploads.length} of ${uploads.length} files`}
          </p>
        </div>
      </div>

      {/* States */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Uploads List */}
      {!loading && !error && (
        <div className="space-y-4">
          {filteredUploads.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-12 text-center">
              <FileAudio className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">
                {uploads.length === 0
                  ? 'No files uploaded yet. Go to Upload to add your first recording.'
                  : 'No files match your search criteria.'}
              </p>
            </div>
          ) : (
            filteredUploads.map((upload) => (
              <div
                key={upload.id}
                className="bg-slate-900 border border-slate-800 rounded-lg p-6 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4 flex-1">
                    <div className="bg-blue-600/20 p-3 rounded-lg">
                      <FileAudio className="w-6 h-6 text-blue-400" />
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-white">{upload.name}</h3>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(upload.status)}
                          <span className="text-sm text-slate-400">{getStatusText(upload.status)}</span>
                        </div>
                      </div>
                      {upload.description && (
                        <p className="text-slate-400 text-sm mb-3">{upload.description}</p>
                      )}
                      <div className="flex items-center gap-6 text-sm text-slate-500">
                        <span className="flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          {formatDate(upload.uploadedAt)}
                        </span>
                        <span>Duration: {formatDuration(upload.duration)}</span>
                        <span>Size: {formatFileSize(upload.fileSize)}</span>
                        <span>{upload.speakerCount} speaker{upload.speakerCount !== 1 ? 's' : ''}</span>
                        {upload.uploadedBy && (
                          <span>By: {upload.uploadedBy}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="ml-4 shrink-0 flex items-center gap-2">
                    {upload.status === 'processed' && (
                      <Link
                        to={`/analysis/${upload.id}`}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                      >
                        <PlayCircle className="w-4 h-4" />
                        View Analysis
                      </Link>
                    )}
                    {upload.status === 'processing' && (
                      <button
                        disabled
                        className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-slate-500 rounded-lg cursor-not-allowed"
                      >
                        <Clock className="w-4 h-4" />
                        Processing...
                      </button>
                    )}
                    {upload.status === 'failed' && (
                      <button
                        onClick={() => handleRetry(upload.id)}
                        disabled={retrying.has(upload.id)}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 disabled:opacity-50 text-red-400 rounded-lg transition-colors"
                      >
                        <RefreshCw className={`w-4 h-4 ${retrying.has(upload.id) ? 'animate-spin' : ''}`} />
                        {retrying.has(upload.id) ? 'Retrying…' : 'Retry'}
                      </button>
                    )}
                    <button
                      onClick={() => setConfirmDelete(upload)}
                      disabled={deleting.has(upload.id)}
                      title="Delete recording"
                      className="p-2 bg-slate-800 hover:bg-red-600/20 text-slate-400 hover:text-red-400 disabled:opacity-50 rounded-lg transition-colors"
                    >
                      {deleting.has(upload.id)
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg w-full max-w-md">
            <div className="p-6 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="bg-red-600/20 p-2 rounded-lg">
                  <Trash2 className="w-5 h-5 text-red-400" />
                </div>
                <h2 className="text-white text-lg">Delete recording?</h2>
              </div>
              <p className="text-slate-400 text-sm mt-3">
                This will permanently remove <span className="text-white font-medium">{confirmDelete.name}</span>,
                its audio file, transcript and speaker segments. This action cannot be undone.
              </p>
            </div>
            <div className="p-6 flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting.has(confirmDelete.id)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete.id)}
                disabled={deleting.has(confirmDelete.id)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                {deleting.has(confirmDelete.id) && <Loader2 className="w-4 h-4 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
