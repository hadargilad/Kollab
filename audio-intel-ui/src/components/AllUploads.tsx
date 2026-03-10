import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileAudio, Search, Filter, Calendar, CheckCircle, Clock, AlertCircle, PlayCircle } from 'lucide-react';

interface Upload {
  id: string;
  name: string;
  filename: string;
  description: string;
  uploadDate: string;
  duration: string;
  size: string;
  status: 'processed' | 'processing' | 'failed';
  speakers: number;
}

export default function AllUploads() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');

  // Mock data - in real app would come from API/database
  const allUploads: Upload[] = [
    {
      id: 'aud-001',
      name: 'Intercept Alpha',
      filename: 'intercept_alpha_dec_20.wav',
      description: 'Intercepted communication between suspects',
      uploadDate: '2025-12-20T08:47:00',
      duration: '12:34',
      size: '24.5 MB',
      status: 'processed',
      speakers: 2
    },
    {
      id: 'aud-002',
      name: 'Call Monitoring 546',
      filename: 'call_monitoring_546.mp3',
      description: 'Routine monitoring call',
      uploadDate: '2025-12-19T14:23:00',
      duration: '08:12',
      size: '15.8 MB',
      status: 'processed',
      speakers: 2
    },
    {
      id: 'aud-003',
      name: 'Meeting Recording',
      filename: 'meeting_transcript_12.wav',
      description: 'Internal meeting recording',
      uploadDate: '2025-12-18T10:15:00',
      duration: '45:23',
      size: '89.2 MB',
      status: 'processing',
      speakers: 5
    },
    {
      id: 'aud-004',
      name: 'Phone Call 789',
      filename: 'phone_call_789.mp3',
      description: 'Suspect phone communication',
      uploadDate: '2025-12-17T16:30:00',
      duration: '05:45',
      size: '11.3 MB',
      status: 'processed',
      speakers: 2
    },
    {
      id: 'aud-005',
      name: 'Interview Recording',
      filename: 'interview_subject_45.wav',
      description: 'Subject interview session',
      uploadDate: '2025-12-16T11:00:00',
      duration: '32:18',
      size: '63.7 MB',
      status: 'failed',
      speakers: 3
    },
    {
      id: 'aud-006',
      name: 'Surveillance Audio',
      filename: 'surveillance_loc_12.mp3',
      description: 'Location 12 surveillance recording',
      uploadDate: '2025-12-15T09:22:00',
      duration: '18:56',
      size: '37.4 MB',
      status: 'processed',
      speakers: 4
    }
  ];

  // Filter uploads based on search and filters
  const filteredUploads = allUploads.filter(upload => {
    const matchesSearch = 
      upload.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      upload.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
      upload.description.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || upload.status === statusFilter;
    
    const uploadDate = new Date(upload.uploadDate);
    const now = new Date();
    const daysDiff = Math.floor((now.getTime() - uploadDate.getTime()) / (1000 * 60 * 60 * 24));
    
    let matchesDate = true;
    if (dateFilter === 'today') matchesDate = daysDiff === 0;
    else if (dateFilter === 'week') matchesDate = daysDiff <= 7;
    else if (dateFilter === 'month') matchesDate = daysDiff <= 30;
    
    return matchesSearch && matchesStatus && matchesDate;
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'processed':
        return <CheckCircle className="w-5 h-5 text-green-400" />;
      case 'processing':
        return <Clock className="w-5 h-5 text-blue-400" />;
      case 'failed':
        return <AlertCircle className="w-5 h-5 text-red-400" />;
      default:
        return null;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'processed':
        return 'Processed';
      case 'processing':
        return 'Processing';
      case 'failed':
        return 'Failed';
      default:
        return status;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('he-IL', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-white mb-2">All Uploads</h1>
        <p className="text-slate-400">View and search all uploaded audio files</p>
      </div>

      {/* Search and Filters */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Search */}
          <div className="md:col-span-1">
            <label className="text-slate-400 text-sm mb-2 block">Search Files</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="Search by name, filename, or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Status Filter */}
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

          {/* Date Filter */}
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

        {/* Results Count */}
        <div className="mt-4 pt-4 border-t border-slate-800">
          <p className="text-slate-400 text-sm">
            Showing {filteredUploads.length} of {allUploads.length} files
          </p>
        </div>
      </div>

      {/* Uploads List */}
      <div className="space-y-4">
        {filteredUploads.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-12 text-center">
            <FileAudio className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">No files found matching your search criteria</p>
          </div>
        ) : (
          filteredUploads.map((upload) => (
            <div
              key={upload.id}
              className="bg-slate-900 border border-slate-800 rounded-lg p-6 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4 flex-1">
                  {/* File Icon */}
                  <div className="bg-blue-600/20 p-3 rounded-lg">
                    <FileAudio className="w-6 h-6 text-blue-400" />
                  </div>

                  {/* File Info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-white">{upload.name}</h3>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(upload.status)}
                        <span className="text-sm text-slate-400">{getStatusText(upload.status)}</span>
                      </div>
                    </div>
                    <p className="text-slate-400 text-sm mb-3">{upload.description}</p>
                    <div className="flex items-center gap-6 text-sm text-slate-500">
                      <span className="flex items-center gap-2">
                        <FileAudio className="w-4 h-4" />
                        {upload.filename}
                      </span>
                      <span className="flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        {formatDate(upload.uploadDate)}
                      </span>
                      <span>Duration: {upload.duration}</span>
                      <span>Size: {upload.size}</span>
                      <span>{upload.speakers} speakers</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
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
                  <button className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors">
                    <AlertCircle className="w-4 h-4" />
                    Retry
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
