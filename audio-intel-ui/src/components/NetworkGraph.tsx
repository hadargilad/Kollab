import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Filter, ZoomIn, ZoomOut, Maximize2, User, Phone, Loader2, AlertCircle,
  Network as NetworkIcon, Plus, Trash2, X, Users, GitBranch,
} from 'lucide-react';
import {
  speakers as speakersApi, relations as relationsApi, groups as groupsApi,
  type SpeakerRecord, type RelationRecord, type GroupRecord,
} from '../lib/api';

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

const CANVAS_W = 1100;
const CANVAS_H = 620;

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

const GROUP_COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
];

type Tab = 'filters' | 'groups' | 'bridges';

export default function NetworkGraph({ isAdmin = false }: { isAdmin?: boolean }) {
  const [allSpeakers, setAllSpeakers] = useState<SpeakerRecord[]>([]);
  const [allRelations, setAllRelations] = useState<RelationRecord[]>([]);
  const [allGroups, setAllGroups] = useState<GroupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [zoom, setZoom] = useState(1);
  const [filter, setFilter] = useState({ minConnections: 0, topic: 'all' });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [activeTab, setActiveTab] = useState<Tab>('filters');

  // Group management UI state
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[0]);
  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [groupError, setGroupError] = useState('');

  // Bridge finder state
  const [bridgeGroupA, setBridgeGroupA] = useState<number | ''>('');
  const [bridgeGroupB, setBridgeGroupB] = useState<number | ''>('');
  const [bridgeSpeakers, setBridgeSpeakers] = useState<SpeakerRecord[]>([]);
  const [bridgeLoading, setBridgeLoading] = useState(false);

  const refreshGroups = useCallback(() =>
    groupsApi.list().then(setAllGroups).catch(() => {}), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([speakersApi.list(), relationsApi.list(), groupsApi.list()])
      .then(([sp, rl, gr]) => {
        if (cancelled) return;
        setAllSpeakers(sp);
        setAllRelations(rl);
        setAllGroups(gr);
      })
      .catch(() => { if (!cancelled) setError('Failed to load network data. Make sure the backend is running.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

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

  // speaker_id → group (for ring color and same-group edge detection)
  const speakerGroupMap = useMemo(() => {
    const map = new Map<number, GroupRecord>();
    for (const group of allGroups) {
      for (const member of group.members) map.set(member.id, group);
    }
    return map;
  }, [allGroups]);

  const bridgeNodeIds = useMemo(
    () => new Set(bridgeSpeakers.map(s => s.id)),
    [bridgeSpeakers],
  );

  // Canvas draw
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
    const nodeById = new Map(nodes.map(n => [n.id, n]));

    // Edges
    for (const edge of allRelations) {
      if (!visibleNodeIds.has(edge.speakerA.id) || !visibleNodeIds.has(edge.speakerB.id)) continue;
      if (filter.topic !== 'all' && edge.topic !== filter.topic) continue;

      const fromNode = nodeById.get(edge.speakerA.id);
      const toNode = nodeById.get(edge.speakerB.id);
      if (!fromNode || !toNode) continue;

      const groupA = speakerGroupMap.get(edge.speakerA.id);
      const groupB = speakerGroupMap.get(edge.speakerB.id);
      const sameGroup = groupA && groupB && groupA.id === groupB.id;
      const isSelectedEdge = selectedNode &&
        (edge.speakerA.id === selectedNode.id || edge.speakerB.id === selectedNode.id);

      ctx.beginPath();
      ctx.moveTo(fromNode.x, fromNode.y);
      ctx.lineTo(toNode.x, toNode.y);
      ctx.strokeStyle = isSelectedEdge ? '#60a5fa' : sameGroup ? groupA.color + 'cc' : '#475569';
      ctx.lineWidth = Math.max(1, Math.min(edge.interactionCount, 8) / 2);
      ctx.stroke();
    }

    // Nodes
    for (const node of nodes) {
      if (!visibleNodeIds.has(node.id)) continue;
      const isSelected = selectedNode?.id === node.id;
      const isBridge = bridgeNodeIds.has(node.id);
      const nodeRadius = isSelected ? 32 : 22 + Math.min(node.connections, 8);
      const groupColor = speakerGroupMap.get(node.id)?.color;

      if (isBridge) {
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 18;
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, nodeRadius, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();

      ctx.shadowBlur = 0;

      // Group ring (outermost — drawn first so selected ring sits on top)
      if (groupColor) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, nodeRadius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = groupColor;
        ctx.lineWidth = 3;
        ctx.setLineDash([]);
        ctx.stroke();
      }

      // Selected ring
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, nodeRadius + (groupColor ? 8 : 3), 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([]);
        ctx.stroke();
      }

      // Bridge ring
      if (isBridge) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, nodeRadius + (groupColor ? 9 : 4), 0, Math.PI * 2);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = '#ffffff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.label, node.x, node.y + nodeRadius + (groupColor ? 20 : 14));
    }

    ctx.restore();
  }, [nodes, allRelations, selectedNode, zoom, filter, speakerGroupMap, bridgeNodeIds]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
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
      return Math.sqrt(dx * dx + dy * dy) < r + 8;
    });
    setSelectedNode(clicked ?? null);
  };

  const connectedNodes = selectedNode
    ? allRelations
        .filter(r => r.speakerA.id === selectedNode.id || r.speakerB.id === selectedNode.id)
        .map(r => {
          const other = r.speakerA.id === selectedNode.id ? r.speakerB : r.speakerA;
          return { id: other.id, label: other.name, color: other.color, weight: r.interactionCount };
        })
    : [];

  // Group management handlers
  async function handleCreateGroup() {
    if (!newGroupName.trim()) return;
    setGroupError('');
    try {
      await groupsApi.create(newGroupName.trim(), newGroupColor);
      setNewGroupName('');
      setShowNewGroupForm(false);
      await refreshGroups();
    } catch (e: unknown) {
      setGroupError(e instanceof Error ? e.message : 'Failed to create group');
    }
  }

  async function handleDeleteGroup(groupId: number) {
    await groupsApi.remove(groupId);
    setBridgeSpeakers([]);
    await refreshGroups();
  }

  async function handleAddMember(groupId: number, speakerId: number) {
    await groupsApi.addMember(groupId, speakerId);
    await refreshGroups();
  }

  async function handleRemoveMember(groupId: number, speakerId: number) {
    await groupsApi.removeMember(groupId, speakerId);
    setBridgeSpeakers([]);
    await refreshGroups();
  }

  async function handleFindBridges() {
    if (bridgeGroupA === '' || bridgeGroupB === '' || bridgeGroupA === bridgeGroupB) return;
    setBridgeLoading(true);
    try {
      const result = await groupsApi.bridges(bridgeGroupA, bridgeGroupB);
      setBridgeSpeakers(result.bridges);
    } catch {
      setBridgeSpeakers([]);
    } finally {
      setBridgeLoading(false);
    }
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode; show: boolean }[] = [
    { id: 'filters', label: 'Filters', icon: <Filter className="w-3.5 h-3.5" />, show: true },
    { id: 'groups', label: 'Groups', icon: <Users className="w-3.5 h-3.5" />, show: isAdmin },
    { id: 'bridges', label: 'Bridges', icon: <GitBranch className="w-3.5 h-3.5" />, show: allGroups.length >= 2 },
  ].filter(t => t.show);

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-white text-3xl mb-1">Relationship Network</h1>
        <p className="text-slate-400 text-sm">
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
          </p>
          <Link to="/upload" className="inline-block mt-6 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
            Go to Upload
          </Link>
        </div>
      )}

      {!loading && !error && allSpeakers.length > 0 && (
        <div className="space-y-4">

          {/* Controls bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            {/* Tab header */}
            <div className="flex items-center border-b border-slate-800">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px ${
                    activeTab === tab.id
                      ? 'text-white border-blue-500 bg-slate-800/50'
                      : 'text-slate-400 border-transparent hover:text-slate-200'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.id === 'groups' && allGroups.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 text-xs bg-slate-700 rounded-full text-slate-300">
                      {allGroups.length}
                    </span>
                  )}
                  {tab.id === 'bridges' && bridgeSpeakers.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 text-xs bg-amber-600 rounded-full text-white">
                      {bridgeSpeakers.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="p-4">

              {/* Filters */}
              {activeTab === 'filters' && (
                <div className="flex items-center gap-6 flex-wrap">
                  <div className="flex items-center gap-3 min-w-[220px]">
                    <label className="text-slate-400 text-sm whitespace-nowrap">Min connections</label>
                    <input
                      type="range"
                      min="0"
                      max={Math.max(1, ...Array.from(connectionsBySpeaker.values()))}
                      value={filter.minConnections}
                      onChange={(e) => setFilter({ ...filter, minConnections: parseInt(e.target.value) })}
                      className="flex-1"
                    />
                    <span className="text-white text-sm w-4">{filter.minConnections}</span>
                  </div>
                  {topics.length > 0 && (
                    <div className="flex items-center gap-3">
                      <label className="text-slate-400 text-sm whitespace-nowrap">Topic</label>
                      <select
                        value={filter.topic}
                        onChange={(e) => setFilter({ ...filter, topic: e.target.value })}
                        className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="all">All</option>
                        {topics.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  )}
                  <button
                    onClick={() => setFilter({ minConnections: 0, topic: 'all' })}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded transition-colors"
                  >
                    Reset
                  </button>
                  <div className="ml-auto flex items-center gap-4 text-xs text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <div className="w-4 h-1 bg-slate-500 rounded" />
                      <span>Connection weight</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-white bg-blue-500" />
                      <span>Selected</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-amber-400 bg-blue-500" />
                      <span>Bridge</span>
                    </div>
                    {allGroups.map(g => (
                      <div key={g.id} className="flex items-center gap-1.5">
                        <div className="w-3.5 h-3.5 rounded-full border-2" style={{ borderColor: g.color, backgroundColor: g.color + '40' }} />
                        <span style={{ color: g.color }}>{g.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Groups */}
              {activeTab === 'groups' && isAdmin && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-sm">{allGroups.length} group{allGroups.length !== 1 ? 's' : ''}</span>
                    <button
                      onClick={() => { setShowNewGroupForm(v => !v); setGroupError(''); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-sm rounded transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      New Group
                    </button>
                  </div>

                  {showNewGroupForm && (
                    <div className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg flex-wrap">
                      <input
                        type="text"
                        placeholder="Group name"
                        value={newGroupName}
                        onChange={e => setNewGroupName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleCreateGroup()}
                        className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 w-40"
                        autoFocus
                      />
                      <div className="flex gap-1">
                        {GROUP_COLORS.map(c => (
                          <button
                            key={c}
                            onClick={() => setNewGroupColor(c)}
                            className="w-5 h-5 rounded-full border-2 transition-all"
                            style={{ backgroundColor: c, borderColor: newGroupColor === c ? '#fff' : 'transparent' }}
                          />
                        ))}
                      </div>
                      {groupError && <span className="text-red-400 text-xs">{groupError}</span>}
                      <button onClick={handleCreateGroup} className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded transition-colors">Create</button>
                      <button onClick={() => { setShowNewGroupForm(false); setGroupError(''); }} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded transition-colors">Cancel</button>
                    </div>
                  )}

                  {allGroups.length === 0 && !showNewGroupForm && (
                    <p className="text-slate-500 text-sm">No groups yet — create one to start organizing speakers.</p>
                  )}

                  <div className="flex flex-wrap gap-3">
                    {allGroups.map(group => {
                      const memberIds = new Set(group.members.map(m => m.id));
                      const unassigned = allSpeakers.filter(s => !memberIds.has(s.id));
                      return (
                        <div
                          key={group.id}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg border"
                          style={{ borderColor: group.color + '60', backgroundColor: group.color + '12' }}
                        >
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                          <span className="text-white text-sm font-medium">{group.name}</span>
                          <div className="flex gap-1 flex-wrap">
                            {group.members.map(m => (
                              <span
                                key={m.id}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-white"
                                style={{ backgroundColor: group.color + '40' }}
                              >
                                {m.name}
                                <button onClick={() => handleRemoveMember(group.id, m.id)} className="hover:text-red-400 transition-colors">
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </span>
                            ))}
                          </div>
                          {unassigned.length > 0 && (
                            <select
                              defaultValue=""
                              onChange={e => { if (e.target.value) { handleAddMember(group.id, parseInt(e.target.value)); e.target.value = ''; } }}
                              className="bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-slate-300 text-xs focus:outline-none"
                            >
                              <option value="" disabled>+ Add</option>
                              {unassigned.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          )}
                          <button onClick={() => handleDeleteGroup(group.id)} className="ml-1 p-0.5 hover:text-red-400 text-slate-500 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Bridges */}
              {activeTab === 'bridges' && (
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-slate-400 text-sm">Find speakers who connect two groups:</span>
                  <select
                    value={bridgeGroupA}
                    onChange={e => { setBridgeGroupA(e.target.value === '' ? '' : parseInt(e.target.value)); setBridgeSpeakers([]); }}
                    className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">Group A</option>
                    {allGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <span className="text-slate-500">↔</span>
                  <select
                    value={bridgeGroupB}
                    onChange={e => { setBridgeGroupB(e.target.value === '' ? '' : parseInt(e.target.value)); setBridgeSpeakers([]); }}
                    className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">Group B</option>
                    {allGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <button
                    onClick={handleFindBridges}
                    disabled={bridgeGroupA === '' || bridgeGroupB === '' || bridgeGroupA === bridgeGroupB || bridgeLoading}
                    className="flex items-center gap-2 px-4 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm rounded transition-colors"
                  >
                    {bridgeLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
                    Find
                  </button>
                  {bridgeSpeakers.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-amber-400 text-sm">{bridgeSpeakers.length} bridge{bridgeSpeakers.length !== 1 ? 's' : ''}:</span>
                      {bridgeSpeakers.map(s => (
                        <Link
                          key={s.id}
                          to={`/speaker/${s.id}`}
                          className="flex items-center gap-1.5 px-2 py-1 bg-amber-600/20 border border-amber-500/40 rounded text-sm text-white hover:bg-amber-600/30 transition-colors"
                        >
                          <div className="w-2 h-2 rounded-full border border-amber-400" style={{ backgroundColor: s.color }} />
                          {s.name}
                        </Link>
                      ))}
                    </div>
                  )}
                  {!bridgeLoading && bridgeSpeakers.length === 0 && bridgeGroupA !== '' && bridgeGroupB !== '' && bridgeGroupA !== bridgeGroupB && (
                    <span className="text-slate-500 text-sm">No bridges found.</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Graph */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-slate-400 text-sm">
                {allSpeakers.length} speaker{allSpeakers.length !== 1 ? 's' : ''} · {allRelations.length} connection{allRelations.length !== 1 ? 's' : ''}
                {allGroups.length > 0 && ` · ${allGroups.length} group${allGroups.length !== 1 ? 's' : ''}`}
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 text-xs mr-1">Click node to inspect</span>
                <button onClick={() => setZoom(Math.max(0.5, zoom - 0.1))} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded transition-colors" title="Zoom Out"><ZoomOut className="w-4 h-4" /></button>
                <button onClick={() => setZoom(Math.min(2, zoom + 0.1))} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded transition-colors" title="Zoom In"><ZoomIn className="w-4 h-4" /></button>
                <button onClick={() => setZoom(1)} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded transition-colors" title="Reset Zoom"><Maximize2 className="w-4 h-4" /></button>
              </div>
            </div>
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              onClick={handleCanvasClick}
              className="w-full bg-slate-800 rounded-lg cursor-pointer"
            />
          </div>

          {/* Selected node info — below graph */}
          {selectedNode && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${selectedNode.color}20` }}>
                    <User className="w-5 h-5" style={{ color: selectedNode.color }} />
                  </div>
                  <div>
                    <h3 className="text-white font-medium">{selectedNode.label}</h3>
                    <p className="text-slate-400 text-sm capitalize">{selectedNode.riskLevel} risk · {selectedNode.connections} interactions · {selectedNode.recordingCount} recordings</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {connectedNodes.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <span className="text-slate-400 text-xs">Connections:</span>
                      {connectedNodes.map(conn => (
                        <Link
                          key={conn.id}
                          to={`/speaker/${conn.id}`}
                          className="flex items-center gap-1.5 px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-sm transition-colors"
                        >
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: conn.color }} />
                          <span className="text-white">{conn.label}</span>
                          <span className="text-slate-500 text-xs flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" />{conn.weight}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                  <Link
                    to={`/speaker/${selectedNode.id}`}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors whitespace-nowrap"
                  >
                    View Profile
                  </Link>
                  <button onClick={() => setSelectedNode(null)} className="p-1.5 text-slate-400 hover:text-white transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
