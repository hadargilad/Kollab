import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Play, Pause, Volume2, FileText, Network, Clock, Waves, Loader2, AlertCircle, RefreshCw, UserX, Merge } from 'lucide-react';
import { audios, speakers as speakersApi, type AudioRecord, type SegmentRecord, type SpeakerRecord } from '../lib/api';


interface Speaker {
  id: number;
  name: string;
  color: string;
}

export default function AudioAnalysis() {
  const { id } = useParams<{ id: string }>();
  const audioId = Number(id);

  const [audio, setAudio] = useState<AudioRecord | null>(null);
  const [segments, setSegments] = useState<SegmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [reassignTarget, setReassignTarget] = useState<Speaker | null>(null);
  const [reassignName, setReassignName] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [knownSpeakers, setKnownSpeakers] = useState<SpeakerRecord[]>([]);
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!audioId) return;
    let cancelled = false;

    const fetchAll = async () => {
      try {
        const [audioData, segsData] = await Promise.all([
          audios.get(audioId),
          audios.getSegments(audioId),
        ]);
        if (cancelled) return;
        setAudio(audioData);
        setSegments(segsData);
        setLoading(false);
        // If still processing, poll every 5 s until done
        if (audioData.status === 'processing') {
          setTimeout(() => { if (!cancelled) fetchAll(); }, 5000);
        }
      } catch {
        if (!cancelled) {
          setError('Failed to load analysis data.');
          setLoading(false);
        }
      }
    };

    fetchAll();
    speakersApi.list().then(s => { if (!cancelled) setKnownSpeakers(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [audioId]);

  // Derive unique speakers from segments in order of appearance
  const speakers: Speaker[] = [];
  const seenSpeakers = new Set<number>();
  for (const seg of segments) {
    if (!seenSpeakers.has(seg.speakerId)) {
      seenSpeakers.add(seg.speakerId);
      speakers.push({ id: seg.speakerId, name: seg.speakerName, color: seg.speakerColor });
    }
  }

  const duration = audio?.duration ?? 0;

  const getCurrentSegment = () =>
    segments.find(seg => currentTime >= seg.startTime && currentTime < seg.endTime);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Detect a name collision against the known speaker list so we can label the
  // confirmation button as "Merge" rather than "Save as new person".
  const reassignTrimmed = reassignName.trim();
  const reassignMatch = reassignTrimmed
    ? knownSpeakers.find(
        s =>
          s.id !== reassignTarget?.id &&
          s.name.trim().toLowerCase() === reassignTrimmed.toLowerCase(),
      )
    : undefined;

  const handleReassign = async (forceSeparate = false) => {
    if (!reassignTarget || !audio) return;
    setReassigning(true);
    try {
      await speakersApi.reassign(
        audioId,
        reassignTarget.id,
        reassignTrimmed || 'Unknown',
        forceSeparate,
      );
      const [newAudio, newSegs, newKnown] = await Promise.all([
        audios.get(audioId),
        audios.getSegments(audioId),
        speakersApi.list(),
      ]);
      setAudio(newAudio);
      setSegments(newSegs);
      setKnownSpeakers(newKnown);
      if (reassignMatch && !forceSeparate) {
        setMergeNotice(`Folded into existing profile "${reassignMatch.name}". Voice samples were combined.`);
        setTimeout(() => setMergeNotice(null), 6000);
      }
      setReassignTarget(null);
      setReassignName('');
    } finally {
      setReassigning(false);
    }
  };

  // Sync play/pause
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) el.play().catch(() => setIsPlaying(false));
    else el.pause();
  }, [isPlaying]);

  // Sync volume
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
    </div>
  );

  if (error || !audio) return (
    <div className="p-8">
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-red-400">{error || 'Audio not found.'}</p>
      </div>
    </div>
  );

  const currentSegment = getCurrentSegment();
  const isProcessing = audio.status === 'processing';

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-white text-3xl mb-2">Audio Analysis</h1>
        <p className="text-slate-400">File ID: {id}</p>
      </div>

      {isProcessing && (
        <div className="mb-6 flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-5 py-4">
          <RefreshCw className="w-5 h-5 text-yellow-400 animate-spin shrink-0" />
          <div>
            <p className="text-yellow-300 text-sm font-medium">ML pipeline is running</p>
            <p className="text-slate-400 text-xs">Transcription and speaker segments will appear automatically when done.</p>
          </div>
        </div>
      )}

      {mergeNotice && (
        <div className="mb-6 flex items-center gap-3 bg-blue-500/10 border border-blue-500/30 rounded-lg px-5 py-4">
          <Merge className="w-5 h-5 text-blue-400 shrink-0" />
          <p className="text-blue-200 text-sm">{mergeNotice}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Player */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <div className="flex items-start justify-between mb-6 gap-4">
              <div>
                <h2 className="text-white mb-1">{audio.name}</h2>
                <div className="flex items-center gap-4 text-slate-400 text-sm flex-wrap">
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    Duration: {formatTime(duration)}
                  </span>
                  <span>{speakers.length} Speaker{speakers.length !== 1 ? 's' : ''} Detected</span>
                  {audio.uploadedBy && <span>By: {audio.uploadedBy}</span>}
                </div>
              </div>
              <div className="flex gap-2 flex-wrap shrink-0">
                <Link
                  to={`/waveform/${id}`}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg flex items-center gap-2 transition-colors"
                >
                  <Waves className="w-4 h-4" />
                  Waveform
                </Link>
                <Link
                  to={`/transcript/${id}`}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg flex items-center gap-2 transition-colors"
                >
                  <FileText className="w-4 h-4" />
                  Transcript
                </Link>
                <Link
                  to="/network"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors"
                >
                  <Network className="w-4 h-4" />
                  Network
                </Link>
              </div>
            </div>

            {/* Timeline */}
            {duration > 0 && (
              <div className="mb-6">
                <div className="bg-slate-800 rounded-lg p-4 h-24 relative overflow-hidden">
                  {segments.map(seg => {
                    const left = (seg.startTime / duration) * 100;
                    const width = ((seg.endTime - seg.startTime) / duration) * 100;
                    return (
                      <div
                        key={seg.id}
                        className="absolute h-16 top-4 rounded cursor-pointer hover:opacity-80 transition-opacity"
                        style={{ left: `${left}%`, width: `${Math.max(width, 0.3)}%`, backgroundColor: seg.speakerColor }}
                        onClick={() => {
                          if (audioRef.current) audioRef.current.currentTime = seg.startTime;
                          setCurrentTime(seg.startTime);
                        }}
                        title={`${seg.speakerName}: ${seg.text}`}
                      />
                    );
                  })}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white z-10"
                    style={{ left: `${(currentTime / duration) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between text-slate-400 text-sm mt-2">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>
            )}

            {/* Hidden real audio element */}
            <audio
              ref={audioRef}
              src={audios.fileUrl(audioId)}
              onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
              onEnded={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
            />

            {/* Controls */}
            <div className="flex items-center gap-4">
              <button
                onClick={() => setIsPlaying(p => !p)}
                className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-full transition-colors"
              >
                {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
              </button>
              <div className="flex items-center gap-2 flex-1">
                <Volume2 className="w-5 h-5 text-slate-400" />
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="flex-1"
                />
              </div>
              {currentSegment && (
                <div className="text-slate-300 text-sm">Speaking: {currentSegment.speakerName}</div>
              )}
            </div>

            {currentSegment && (
              <div className="mt-6 p-4 bg-slate-800 rounded-lg border border-slate-700">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: currentSegment.speakerColor }} />
                  <span className="text-white">{currentSegment.speakerName}</span>
                  <span className="text-slate-400 text-sm">
                    [{formatTime(currentSegment.startTime)} – {formatTime(currentSegment.endTime)}]
                  </span>
                </div>
                <p className="text-slate-300">{currentSegment.text}</p>
              </div>
            )}
          </div>

          {/* Segment List */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">Speaker Segments</h3>
            {segments.length === 0 ? (
              <p className="text-slate-400 text-sm">No segments found.</p>
            ) : (
              <div className="space-y-3">
                {segments.map((seg) => {
                  const isActive = currentSegment?.id === seg.id;
                  return (
                    <div
                      key={seg.id}
                      onClick={() => {
                        if (audioRef.current) audioRef.current.currentTime = seg.startTime;
                        setCurrentTime(seg.startTime);
                      }}
                      className={`p-4 rounded-lg cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-blue-600/20 border border-blue-500'
                          : 'bg-slate-800 border border-slate-700 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: seg.speakerColor }} />
                        <span className="text-white">{seg.speakerName}</span>
                        <span className="text-slate-400 text-sm ml-auto">
                          {formatTime(seg.startTime)} – {formatTime(seg.endTime)}
                        </span>
                      </div>
                      <p className="text-slate-300 text-sm">{seg.text}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Reassign modal */}
        {reassignTarget && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-lg w-full max-w-md">
              <div className="p-6 border-b border-slate-800">
                <h2 className="text-white text-lg">Not the right person?</h2>
                <p className="text-slate-400 text-sm mt-1">
                  The system identified this speaker as <span className="text-white font-medium">{reassignTarget.name}</span>.
                  Type a name — if a profile with that name already exists, this voice will be merged into it
                  and the voice print will improve.
                </p>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-slate-400 text-sm mb-2 block">Name</label>
                  <input
                    type="text"
                    value={reassignName}
                    onChange={e => setReassignName(e.target.value)}
                    placeholder="e.g. Ofir, Sister, Unknown Person…"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && handleReassign(false)}
                    list="known-speaker-names"
                  />
                  <datalist id="known-speaker-names">
                    {knownSpeakers
                      .filter(s => s.id !== reassignTarget.id)
                      .map(s => <option key={s.id} value={s.name} />)}
                  </datalist>
                  {reassignMatch && (
                    <div className="mt-3 flex items-start gap-2 bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2 text-sm text-blue-200">
                      <Merge className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>
                        Will merge into existing profile <span className="font-medium">{reassignMatch.name}</span>
                        {reassignMatch.recordingCount > 0 && ` (${reassignMatch.recordingCount} recording${reassignMatch.recordingCount !== 1 ? 's' : ''})`}.
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="p-6 border-t border-slate-800 flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
                <button
                  onClick={() => { setReassignTarget(null); setReassignName(''); }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
                >
                  Cancel
                </button>
                {reassignMatch && (
                  <button
                    onClick={() => handleReassign(true)}
                    disabled={reassigning}
                    title={`Save as a different person who happens to share the name "${reassignMatch.name}"`}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-lg transition-colors"
                  >
                    No, different person
                  </button>
                )}
                <button
                  onClick={() => handleReassign(false)}
                  disabled={reassigning}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-2 justify-center"
                >
                  {reassigning && <Loader2 className="w-4 h-4 animate-spin" />}
                  {reassignMatch ? 'Merge into existing' : 'Save as new person'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Speakers */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">Identified Speakers</h3>
            {speakers.length === 0 ? (
              <p className="text-slate-400 text-sm">No speakers identified.</p>
            ) : (
              <div className="space-y-3">
                {speakers.map((spk) => {
                  const spkSegs = segments.filter(s => s.speakerId === spk.id);
                  const totalTime = spkSegs.reduce((acc, s) => acc + (s.endTime - s.startTime), 0);
                  return (
                    <div key={spk.id} className="p-4 bg-slate-800 rounded-lg border border-slate-700">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: spk.color }} />
                        <Link to={`/speaker/${spk.id}`} className="text-white hover:text-blue-400 transition-colors flex-1 truncate">
                          {spk.name}
                        </Link>
                        <button
                          onClick={() => { setReassignTarget(spk); setReassignName(''); }}
                          title="This isn't the right person"
                          className="text-slate-500 hover:text-red-400 transition-colors p-1 shrink-0"
                        >
                          <UserX className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="text-slate-400 text-sm space-y-1">
                        <div>Segments: {spkSegs.length}</div>
                        <div>Duration: {formatTime(totalTime)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">File Metadata</h3>
            <div className="space-y-3 text-sm">
              {audio.description && (
                <div>
                  <div className="text-slate-400 mb-1">Description</div>
                  <div className="text-white">{audio.description}</div>
                </div>
              )}
              <div>
                <div className="text-slate-400 mb-1">Uploaded</div>
                <div className="text-white">
                  {new Date(audio.uploadedAt).toLocaleDateString('en-GB', {
                    year: 'numeric', month: 'short', day: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </div>
              </div>
              <div>
                <div className="text-slate-400 mb-1">Duration</div>
                <div className="text-white">{formatTime(duration)}</div>
              </div>
              <div>
                <div className="text-slate-400 mb-1">Size</div>
                <div className="text-white">
                  {audio.fileSize > 0 ? (audio.fileSize / (1024 * 1024)).toFixed(1) + ' MB' : '—'}
                </div>
              </div>
              <div>
                <div className="text-slate-400 mb-1">Uploaded By</div>
                <div className="text-white">{audio.uploadedBy || '—'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
