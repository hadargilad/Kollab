import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileAudio, Search, Filter, Calendar, CheckCircle, Clock, AlertCircle, PlayCircle, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { audios, type AudioRecord } from '../lib/api';

export default function AllUploads() {
  const navigate = useNavigate();
  const [uploads, setUploads] = useState<AudioRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [contentQuery, setContentQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [recordedFrom, setRecordedFrom] = useState('');
  const [recordedTo, setRecordedTo] = useState('');
  const [retrying, setRetrying] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<AudioRecord | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const fetchAndSchedule = () => {
      audios.list()
        .then(data => {
          if (cancelled) return;
          setUploads(data);
          setLoading(false);
          if (data.some(u => u.status === 'processing')) {
            setTimeout(() => { if (!cancelled) fetchAndSchedule(); }, 5000);
          }
        })
        .catch(() => {
          if (!cancelled) { setError('Failed to load uploads.'); setLoading(false); }
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
    let matchesRecorded = true;
    if (recordedFrom || recordedTo) {
      if (!upload.recordedAt) { matchesRecorded = false; }
      else {
        const recorded = upload.recordedAt.slice(0, 16);
        if (recordedFrom && recorded < recordedFrom) matchesRecorded = false;
        if (recordedTo && recorded > recordedTo) matchesRecorded = false;
      }
    }
    return matchesSearch && matchesStatus && matchesDate && matchesRecorded;
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

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('he-IL', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

  const handleRetry = async (id: number) => {
    setRetrying(prev => new Set(prev).add(id));
    try {
      await audios.retry(id);
      setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'processing' } : u));
    } catch { /* leave as failed */ }
    finally { setRetrying(prev => { const s = new Set(prev); s.delete(id); return s; }); }
  };

  const handleDelete = async (id: number) => {
    setDeleting(prev => new Set(prev).add(id));
    try {
      await audios.remove(id);
      setUploads(prev => prev.filter(u => u.id !== id));
      setConfirmDelete(null);
    } catch { setError('Failed to delete file.'); }
    finally { setDeleting(prev => { const s = new Set(prev); s.delete(id); return s; }); }
  };

  const toggleSelected = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setBatchBusy(true); setBatchError('');
    try {
      const ids = Array.from(selectedIds);
      const res = await audios.batchDelete(ids);
      const deletedSet = new Set(res.deleted);
      setUploads(prev => prev.filter(u => !deletedSet.has(u.id)));
      setSelectedIds(new Set());
      setBatchConfirmOpen(false);
      if (res.failed.length > 0) {
        setBatchError(`${res.failed.length} item(s) could not be deleted.`);
      }
    } catch (e: any) {
      setBatchError(e?.message ?? 'Batch delete failed.');
    } finally {
      setBatchBusy(false);
    }
  };

  const statusBadge = (status: string) => {
    if (status === 'processed')  return 'text-emerald-400';
    if (status === 'processing') return 'text-amber-400';
    return 'text-red-400';
  };

  const statusIcon = (status: string) => {
    if (status === 'processed')  return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
    if (status === 'processing') return <Clock className="w-3.5 h-3.5 text-amber-400" />;
    return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
  };

  const inputCls = 'w-full bg-black border border-zinc-800 rounded px-3 py-2 text-white text-sm placeholder-zinc-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 transition-all font-mono';
  const selectCls = 'w-full bg-black border border-zinc-800 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 appearance-none transition-all font-mono';

  const handleContentSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !contentQuery.trim()) return;
    navigate(`/search?q=${encodeURIComponent(contentQuery.trim())}`);
  };

  return (
    <div className="p-6 space-y-5">
      <div>
        <div className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest mb-1">Files</div>
        <h1 className="text-white text-2xl font-bold tracking-tight">All Uploads</h1>
        <p className="text-zinc-300 text-sm mt-0.5">Search and manage uploaded audio recordings</p>
      </div>

      {/* Filters */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-200" />
              <input
                type="text"
                placeholder="Name or description…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={inputCls + ' pl-9'}
              />
            </div>
          </div>
          <div>
            <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">Search Content</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-200" />
              <input
                type="text"
                placeholder="Search what was said… (Enter)"
                value={contentQuery}
                onChange={(e) => setContentQuery(e.target.value)}
                onKeyDown={handleContentSearchKey}
                className={inputCls + ' pl-9'}
              />
            </div>
          </div>
          <div>
            <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">Status</label>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-200" />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls + ' pl-9'}>
                <option value="all">All Status</option>
                <option value="processed">Processed</option>
                <option value="processing">Processing</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">Upload Date</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-200" />
              <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className={selectCls + ' pl-9'}>
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="week">Last 7 Days</option>
                <option value="month">Last 30 Days</option>
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2 grid grid-cols-2 gap-3">
            <div>
              <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">Recorded From</label>
              <input type="datetime-local" value={recordedFrom} onChange={(e) => setRecordedFrom(e.target.value)}
                className={inputCls + ' scheme-dark'} />
            </div>
            <div>
              <label className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest block mb-1.5">Recorded To</label>
              <input type="datetime-local" value={recordedTo} onChange={(e) => setRecordedTo(e.target.value)}
                className={inputCls + ' scheme-dark'} />
            </div>
          </div>
          <div className="flex items-end gap-2">
            {(recordedFrom || recordedTo) && (
              <button
                onClick={() => { setRecordedFrom(''); setRecordedTo(''); }}
                className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs rounded transition-colors font-mono"
              >
                Clear Range
              </button>
            )}
          </div>
        </div>

        <div className="pt-2 border-t border-zinc-800">
          <p className="text-zinc-200 text-xs font-mono">
            {loading ? 'Loading…' : `${filteredUploads.length} / ${uploads.length} files`}
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-md p-5 text-center">
          <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-2" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-2">
          {filteredUploads.length > 0 && (() => {
            const visibleIds = filteredUploads.map(u => u.id);
            const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
            const someVisibleSelected = visibleIds.some(id => selectedIds.has(id));
            return (
              <div className="bg-zinc-900 border border-zinc-800 rounded-md px-4 py-2 flex items-center gap-3 flex-wrap">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={el => { if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected; }}
                  onChange={() => {
                    setSelectedIds(prev => {
                      const next = new Set(prev);
                      if (allVisibleSelected) visibleIds.forEach(id => next.delete(id));
                      else visibleIds.forEach(id => next.add(id));
                      return next;
                    });
                  }}
                  className="w-4 h-4 accent-blue-500"
                  title="Select all currently visible"
                />
                <span className="text-zinc-200 text-xs font-mono">
                  {selectedIds.size === 0
                    ? 'Select files to enable bulk actions'
                    : `${selectedIds.size} selected`}
                </span>
                {selectedIds.size > 0 && (
                  <>
                    <button
                      onClick={() => setBatchConfirmOpen(true)}
                      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs rounded transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete {selectedIds.size}
                    </button>
                    <button
                      onClick={clearSelection}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs rounded transition-colors"
                    >
                      Clear
                    </button>
                  </>
                )}
                {batchError && (
                  <span className="text-red-400 text-xs font-mono w-full">{batchError}</span>
                )}
              </div>
            );
          })()}
          {filteredUploads.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-md p-10 text-center">
              <FileAudio className="w-10 h-10 text-zinc-800 mx-auto mb-3" />
              <p className="text-zinc-300 text-sm">
                {uploads.length === 0 ? 'No files uploaded yet.' : 'No files match your filters.'}
              </p>
            </div>
          ) : (
            filteredUploads.map((upload) => (
              <div key={upload.id}
                className={`bg-zinc-900 border rounded-md px-5 py-4 hover:border-zinc-700 transition-colors ${
                  selectedIds.has(upload.id) ? 'border-blue-500/40 bg-blue-500/4' : 'border-zinc-800'
                }`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(upload.id)}
                      onChange={() => toggleSelected(upload.id)}
                      className="w-4 h-4 accent-blue-500 mt-2.5 shrink-0"
                    />
                    <div className="w-8 h-8 bg-zinc-800 border border-zinc-700 rounded flex items-center justify-center shrink-0 mt-0.5">
                      <FileAudio className="w-4 h-4 text-zinc-200" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5 mb-1">
                        <h3 className="text-white font-medium truncate">{upload.name}</h3>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {statusIcon(upload.status)}
                          <span className={`text-xs font-mono uppercase ${statusBadge(upload.status)}`}>
                            {upload.status}
                          </span>
                        </div>
                      </div>
                      {upload.description && (
                        <p className="text-zinc-300 text-sm mb-1.5">{upload.description}</p>
                      )}
                      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs font-mono text-zinc-200">
                        {upload.recordedAt && (
                          <span className="flex items-center gap-1.5 text-zinc-300">
                            <Calendar className="w-3 h-3" />
                            {formatDate(upload.recordedAt)}
                          </span>
                        )}
                        <span className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3" />
                          {formatDate(upload.uploadedAt)}
                        </span>
                        <span>{formatDuration(upload.duration)}</span>
                        <span>{formatFileSize(upload.fileSize)}</span>
                        <span>{upload.speakerCount} spk</span>
                        {upload.uploadedBy && <span>by {upload.uploadedBy}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {upload.status === 'processed' && (
                      <Link
                        to={`/analysis/${upload.id}`}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
                      >
                        <PlayCircle className="w-3.5 h-3.5" />
                        Analysis
                      </Link>
                    )}
                    {upload.status === 'processing' && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 text-zinc-300 text-xs rounded cursor-not-allowed">
                        <Clock className="w-3.5 h-3.5" />
                        Processing
                      </div>
                    )}
                    {upload.status === 'failed' && (
                      <button
                        onClick={() => handleRetry(upload.id)}
                        disabled={retrying.has(upload.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 disabled:opacity-50 text-red-400 text-xs rounded transition-colors"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${retrying.has(upload.id) ? 'animate-spin' : ''}`} />
                        {retrying.has(upload.id) ? 'Retrying…' : 'Retry'}
                      </button>
                    )}
                    <button
                      onClick={() => setConfirmDelete(upload)}
                      disabled={deleting.has(upload.id)}
                      className="p-1.5 text-zinc-200 hover:text-red-400 hover:bg-red-500/8 rounded transition-colors disabled:opacity-50"
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

      {/* Batch delete modal */}
      {batchConfirmOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-md w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-zinc-800">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-red-500/10 border border-red-500/25 rounded flex items-center justify-center">
                  <Trash2 className="w-4 h-4 text-red-400" />
                </div>
                <h2 className="text-white font-semibold">Delete {selectedIds.size} recording(s)?</h2>
              </div>
              <p className="text-zinc-200 text-sm">
                This permanently removes the selected files, their audio data, transcripts and speaker segments. This action cannot be undone.
              </p>
            </div>
            <div className="p-4 flex gap-2 justify-end">
              <button
                onClick={() => setBatchConfirmOpen(false)}
                disabled={batchBusy}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white text-sm rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={batchBusy}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm rounded transition-colors flex items-center gap-2"
              >
                {batchBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Delete {selectedIds.size}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-md w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-zinc-800">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-red-500/10 border border-red-500/25 rounded flex items-center justify-center">
                  <Trash2 className="w-4 h-4 text-red-400" />
                </div>
                <h2 className="text-white font-semibold">Delete recording?</h2>
              </div>
              <p className="text-zinc-200 text-sm">
                This permanently removes{' '}
                <span className="text-white font-medium">{confirmDelete.name}</span>,
                its audio file, transcript and speaker segments. This action cannot be undone.
              </p>
            </div>
            <div className="p-4 flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting.has(confirmDelete.id)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white text-sm rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete.id)}
                disabled={deleting.has(confirmDelete.id)}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm rounded transition-colors flex items-center gap-2"
              >
                {deleting.has(confirmDelete.id) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
