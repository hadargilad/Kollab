import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Filter, ZoomIn, ZoomOut, Maximize2, User, Phone } from 'lucide-react';

interface Node {
  id: string;
  label: string;
  x: number;
  y: number;
  connections: number;
  color: string;
}

interface Edge {
  from: string;
  to: string;
  weight: number;
  topic?: string;
}

const nodes: Node[] = [
  { id: 'spk-1', label: 'Speaker A', x: 400, y: 300, connections: 8, color: '#3b82f6' },
  { id: 'spk-2', label: 'Speaker B', x: 600, y: 250, connections: 12, color: '#a855f7' },
  { id: 'spk-3', label: 'Speaker C', x: 500, y: 450, connections: 5, color: '#06b6d4' },
  { id: 'spk-4', label: 'Speaker D', x: 300, y: 400, connections: 7, color: '#22c55e' },
  { id: 'spk-5', label: 'Speaker E', x: 700, y: 350, connections: 9, color: '#f59e0b' },
  { id: 'spk-6', label: 'Speaker F', x: 550, y: 150, connections: 4, color: '#ec4899' },
  { id: 'spk-7', label: 'Speaker G', x: 200, y: 250, connections: 3, color: '#8b5cf6' },
];

const edges: Edge[] = [
  { from: 'spk-1', to: 'spk-2', weight: 8, topic: 'Operations' },
  { from: 'spk-1', to: 'spk-3', weight: 3, topic: 'Logistics' },
  { from: 'spk-1', to: 'spk-4', weight: 5, topic: 'Planning' },
  { from: 'spk-2', to: 'spk-3', weight: 4, topic: 'Coordination' },
  { from: 'spk-2', to: 'spk-5', weight: 6, topic: 'Operations' },
  { from: 'spk-2', to: 'spk-6', weight: 7, topic: 'Strategy' },
  { from: 'spk-4', to: 'spk-7', weight: 2, topic: 'General' },
  { from: 'spk-5', to: 'spk-6', weight: 3, topic: 'Coordination' },
];

export default function NetworkGraph() {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [zoom, setZoom] = useState(1);
  const [filter, setFilter] = useState({ minConnections: 0, topic: 'all' });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2 - 450, canvas.height / 2 - 300);
    ctx.scale(zoom, zoom);

    // Draw edges
    edges.forEach(edge => {
      const fromNode = nodes.find(n => n.id === edge.from);
      const toNode = nodes.find(n => n.id === edge.to);
      if (!fromNode || !toNode) return;

      if (filter.minConnections > 0 && 
          (fromNode.connections < filter.minConnections || toNode.connections < filter.minConnections)) {
        return;
      }

      ctx.beginPath();
      ctx.moveTo(fromNode.x, fromNode.y);
      ctx.lineTo(toNode.x, toNode.y);
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = Math.max(1, edge.weight / 2);
      ctx.stroke();
    });

    // Draw nodes
    nodes.forEach(node => {
      if (filter.minConnections > 0 && node.connections < filter.minConnections) {
        return;
      }

      const isSelected = selectedNode?.id === node.id;
      const radius = isSelected ? 35 : 25;

      // Draw node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();
      
      if (isSelected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // Draw label
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.label, node.x, node.y + radius + 15);
    });

    ctx.restore();
  }, [selectedNode, zoom, filter]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - canvas.width / 2 + 450) / zoom;
    const y = (e.clientY - rect.top - canvas.height / 2 + 300) / zoom;

    const clickedNode = nodes.find(node => {
      const dx = x - node.x;
      const dy = y - node.y;
      return Math.sqrt(dx * dx + dy * dy) < 25;
    });

    setSelectedNode(clickedNode || null);
  };

  const connectedNodes = selectedNode 
    ? edges
        .filter(e => e.from === selectedNode.id || e.to === selectedNode.id)
        .map(e => {
          const otherId = e.from === selectedNode.id ? e.to : e.from;
          const node = nodes.find(n => n.id === otherId);
          return { ...node, ...e };
        })
    : [];

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-white text-3xl mb-2">Relationship Network</h1>
        <p className="text-slate-400">Interactive communication network visualization</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Network Canvas */}
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
              width={900}
              height={600}
              onClick={handleCanvasClick}
              className="w-full bg-slate-800 rounded-lg cursor-pointer"
            />

            <div className="mt-4 text-slate-400 text-sm">
              <p>Click on a node to view details • Scroll to zoom • Drag to pan</p>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Filters */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="w-5 h-5 text-blue-500" />
              <h3 className="text-white">Filters</h3>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-slate-400 text-sm mb-2">
                  Min Connections
                </label>
                <input
                  type="range"
                  min="0"
                  max="10"
                  value={filter.minConnections}
                  onChange={(e) => setFilter({ ...filter, minConnections: parseInt(e.target.value) })}
                  className="w-full"
                />
                <div className="text-white text-sm mt-1">{filter.minConnections}</div>
              </div>

              <div>
                <label className="block text-slate-400 text-sm mb-2">
                  Topic Filter
                </label>
                <select
                  value={filter.topic}
                  onChange={(e) => setFilter({ ...filter, topic: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Topics</option>
                  <option value="operations">Operations</option>
                  <option value="logistics">Logistics</option>
                  <option value="coordination">Coordination</option>
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
                  <p className="text-slate-400 text-sm">{selectedNode.id}</p>
                </div>
              </div>

              <div className="space-y-3 mb-4">
                <div className="flex justify-between">
                  <span className="text-slate-400 text-sm">Total Connections</span>
                  <span className="text-white">{selectedNode.connections}</span>
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
                    {connectedNodes.map((conn: any) => (
                      <div
                        key={conn.id}
                        className="flex items-center justify-between p-2 bg-slate-800 rounded"
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
                      </div>
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

          {/* Legend */}
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
    </div>
  );
}
