import { useState, useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Filter, ZoomIn, ZoomOut, Maximize2, User, Phone, Loader2, AlertCircle, Network as NetworkIcon } from 'lucide-react';
import { speakers as speakersApi, relations as relationsApi, type SpeakerRecord, type RelationRecord } from '../lib/api';

interface Node {
  id: number;
  label: string;
  x: number;
  y: number;
  connections: number;
  color: string;
  riskLevel: 'low' | 'medium' | 'high';
  recordingCount: number;
}

const CANVAS_W = 900;
const CANVAS_H = 600;

// Lay out speakers on a circle so the graph stays readable without a physics sim.
function layoutNodes(speakers: SpeakerRecord[], connectionsBySpeaker: Map<number, number>): Node[] {
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  const radius = Math.min(CANVAS_W, CANVAS_H) / 2 - 80;
  const n = speakers.length;
  return speakers.map((s, i) => {
    const angle = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
    return {
      id: s.id,
      label: s.name,
      x: n === 1 ? cx : cx + radius * Math.cos(angle),
      y: n === 1 ? cy : cy + radius * Math.sin(angle),
      connections: connectionsBySpeaker.get(s.id) ?? 0,
      color: s.color,
      riskLevel: s.riskLevel,
      recordingCount: s.recordingCount,
    };
  });
}

export default function NetworkGraph() {
  const [allSpeakers, setAllSpeakers] = useState<SpeakerRecord[]>([]);
  const [allRelations, setAllRelations] = useState<RelationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [zoom, setZoom] = useState(1);
  const [filter, setFilter] = useState({ minConnections: 0, topic: 'all' });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([speakersApi.list(), relationsApi.list()])
      .then(([sp, rl]) => {
        if (cancelled) return;
        setAllSpeakers(sp);
        setAllRelations(rl);
      })
      .catch(() => { if (!cancelled) setError('Failed to load network data. Make sure the backend is running.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Compute connection counts per speaker — use this both for the node radius
  // and the "min connections" filter slider.
  const connectionsBySpeaker = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of allRelations) {
      map.set(r.speakerA.id, (map.get(r.speakerA.id) ?? 0) + r.interactionCount);
      map.set(r.speakerB.id, (map.get(r.speakerB.id) ?? 0) + r.interactionCount);
    }
    return map;
  }, [allRelations]);

  const nodes = useMemo(
    () => layoutNodes(allSpeakers, connectionsBySpeaker),
    [allSpeakers, connectionsBySpeaker],
  );

  const topics = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRelations) if (r.topic) set.add(r.topic);
    return Array.from(set).sort();
  }, [allRelations]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-canvas.width / 2, -canvas.height / 2);

    const visibleNodeIds = new Set(
      nodes.filter(n => n.connections >= filter.minConnections).map(n => n.id),
    );

    // Edges
    for (const edge of allRelations) {
      if (!visibleNodeIds.has(edge.speakerA.id) || !visibleNodeIds.has(edge.speakerB.id)) continue;
      if (filter.topic !== 'all' && edge.topic !== filter.topic) continue;

      const fromNode = nodes.find(n => n.id === edge.speakerA.id);
      const toNode = nodes.find(n => n.id === edge.speakerB.id);
      if (!fromNode || !toNode) continue;

      ctx.beginPath();
      ctx.moveTo(fromNode.x, fromNode.y);
      ctx.lineTo(toNode.x, toNode.y);
      const isSelectedEdge = selectedNode && (edge.speakerA.id === selectedNode.id || edge.speakerB.id === selectedNode.id);
      ctx.strokeStyle = isSelectedEdge ? '#60a5fa' : '#475569';
      ctx.lineWidth = Math.max(1, Math.min(edge.interactionCount, 8) / 2);
      ctx.stroke();
    }

    // Nodes
    for (const node of nodes) {
      if (!visibleNodeIds.has(node.id)) continue;
      const isSelected = selectedNode?.id === node.id;
      const radius = isSelected ? 32 : 22 + Math.min(node.connections, 8);

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      ctx.fillStyle = '#ffffff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.label, node.x, node.y + radius + 14);
    }

    ctx.restore();
  }, [nodes, allRelations, selectedNode, zoom, filter]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    // Map screen → world coords (matches the translate/scale chain in the draw step)
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const wx = (px - canvas.width / 2) / zoom + canvas.width / 2;
    const wy = (py - canvas.height / 2) / zoom + canvas.height / 2;

    const clicked = nodes.find(node => {
      const dx = wx - node.x;
      const dy = wy - node.y;
      const r = 22 + Math.min(node.connections, 8);
      return Math.sqrt(dx * dx + dy * dy) < r + 4;
    });
    setSelectedNode(clicked ?? null);
  };

  const connectedNodes = selectedNode
    ? allRelations
        .filter(r => r.speakerA.id === selectedNode.id || r.speakerB.id === selectedNode.id)
        .map(r => {
          const other = r.speakerA.id === selectedNode.id ? r.speakerB : r.speakerA;
          return { id: other.id, label: other.name, color: other.color, weight: r.interactionCount, topic: r.topic };
        })
    : [];

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-white text-3xl mb-2">Relationship Network</h1>
        <p className="text-slate-400">
          Built automatically from uploaded recordings — every audio with multiple speakers becomes one or more connections.
        </p>
      </div>

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

      {!loading && !error && allSpeakers.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-12 text-center">
          <NetworkIcon className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h3 className="text-white text-lg mb-2">No connections yet</h3>
          <p className="text-slate-400 max-w-md mx-auto">
            Upload audio recordings with two or more speakers and connections will appear here.
            Use the <span className="text-white">"Not the same person"</span> action on the analysis page if a speaker was misidentified.
          </p>
          <Link
            to="/upload"
            className="inline-block mt-6 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Go to Upload
          </Link>
        </div>
      )}

      {!loading && !error && allSpeakers.length > 0 && (
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white">Network Graph</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setZoom(Math.min(2, zoom + 0.1))}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
                  title="Zoom In"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setZoom(1)}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
                  title="Reset"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              onClick={handleCanvasClick}
              className="w-full bg-slate-800 rounded-lg cursor-pointer"
            />

            <div className="mt-4 text-slate-400 text-sm flex items-center justify-between">
              <span>
                {allSpeakers.length} speaker{allSpeakers.length !== 1 ? 's' : ''} • {allRelations.length} connection{allRelations.length !== 1 ? 's' : ''}
              </span>
              <span>Click a node to view details</span>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {/* Filters */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="w-5 h-5 text-blue-500" />
              <h3 className="text-white">Filters</h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-slate-400 text-sm mb-2">Min Connections</label>
                <input
                  type="range"
                  min="0"
                  max={Math.max(1, ...Array.from(connectionsBySpeaker.values()))}
                  value={filter.minConnections}
                  onChange={(e) => setFilter({ ...filter, minConnections: parseInt(e.target.value) })}
                  className="w-full"
                />
                <div className="text-white text-sm mt-1">{filter.minConnections}</div>
              </div>

              <div>
                <label className="block text-slate-400 text-sm mb-2">Topic Filter</label>
                <select
                  value={filter.topic}
                  onChange={(e) => setFilter({ ...filter, topic: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Topics</option>
                  {topics.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <button
                onClick={() => setFilter({ minConnections: 0, topic: 'all' })}
                className="w-full px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
              >
                Reset Filters
              </button>
            </div>
          </div>

          {/* Selected Node Info */}
          {selectedNode ? (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: `${selectedNode.color}20` }}
                >
                  <User className="w-6 h-6" style={{ color: selectedNode.color }} />
                </div>
                <div>
                  <h3 className="text-white">{selectedNode.label}</h3>
                  <p className="text-slate-400 text-sm capitalize">{selectedNode.riskLevel} risk</p>
                </div>
              </div>

              <div className="space-y-2 mb-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Interactions</span>
                  <span className="text-white">{selectedNode.connections}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Recordings</span>
                  <span className="text-white">{selectedNode.recordingCount}</span>
                </div>
              </div>

              <Link
                to={`/speaker/${selectedNode.id}`}
                className="block w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-center transition-colors"
              >
                View Full Profile
              </Link>

              {connectedNodes.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-slate-400 text-sm mb-2">Direct Connections</h4>
                  <div className="space-y-2">
                    {connectedNodes.map((conn) => (
                      <Link
                        key={conn.id}
                        to={`/speaker/${conn.id}`}
                        className="flex items-center justify-between p-2 bg-slate-800 hover:bg-slate-700 rounded transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: conn.color }}
                          />
                          <span className="text-white text-sm">{conn.label}</span>
                        </div>
                        <div className="flex items-center gap-1 text-slate-400 text-xs">
                          <Phone className="w-3 h-3" />
                          {conn.weight}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
              <div className="text-center text-slate-400 py-8">
                <User className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p>Click on a node to view speaker details</p>
              </div>
            </div>
          )}

          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <h3 className="text-white mb-4">Legend</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-6 h-1 bg-slate-500 rounded" />
                <span className="text-slate-400">Connection strength</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-blue-500" />
                <span className="text-slate-400">Speaker node</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full border-2 border-white bg-purple-500" />
                <span className="text-slate-400">Selected node</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
