import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Filter, ZoomIn, ZoomOut, Maximize2, User, Phone, Loader2, AlertCircle,
  Network as NetworkIcon, Plus, Trash2, X, Users, GitBranch, ChevronDown,
} from 'lucide-react';
import {
  speakers as speakersApi, relations as relationsApi, groups as groupsApi,
  type SpeakerRecord, type RelationRecord, type GroupRecord,
  API_BASE,
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
  imagePath: string | null;
  isGhost: boolean;
}

const CANVAS_W = 1100;
const CANVAS_H = 460;
const LABEL_FONT = '12px ui-monospace, SFMono-Regular, Menlo, monospace';

function layoutNodes(speakers: SpeakerRecord[], connectionsBySpeaker: Map<number, number>): Node[] {
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  const radius = Math.min(CANVAS_W, CANVAS_H) / 2 - 70;
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
      imagePath: s.imagePath,
      isGhost: s.isGhost ?? false,
    };
  });
}

const GROUP_COLORS = [
  '#f43f5e', '#f97316', '#facc15', '#4ade80', '#22d3ee',
  '#60a5fa', '#a78bfa', '#e879f9', '#34d399', '#fb923c',
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
  const [filter, setFilter] = useState({ minConnections: 0, topic: 'all', riskLevel: 'all' });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [activeTab, setActiveTab] = useState<Tab>('filters');
  const [expandedGroupId, setExpandedGroupId] = useState<number | null>(null);

  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[0]);
  const [newGroupParentId, setNewGroupParentId] = useState<number | null>(null);
  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [groupError, setGroupError] = useState('');
  const [projectFilterId, setProjectFilterId] = useState<number | null>(null);
  const [subgroupFilterId, setSubgroupFilterId] = useState<number | null>(null);
  const [addToGroupTarget, setAddToGroupTarget] = useState<GroupRecord | null>(null);
  const [addToGroupSearch, setAddToGroupSearch] = useState('');
  const [addToGroupSelectedIds, setAddToGroupSelectedIds] = useState<Set<number>>(new Set());
  const [addToGroupBusy, setAddToGroupBusy] = useState(false);
  const [addToGroupError, setAddToGroupError] = useState('');
  // Speaker-node action popup on the canvas: clicking a node sets this to that
  // speaker, the popup floats near the node with "Add to group" / "View profile".
  const [nodeAction, setNodeAction] = useState<{ node: Node; x: number; y: number } | null>(null);
  const [nodeActionGroupPicker, setNodeActionGroupPicker] = useState(false);

  const [showGhosts, setShowGhosts] = useState(false);

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
        setAllSpeakers(sp); setAllRelations(rl); setAllGroups(gr);
      })
      .catch(() => { if (!cancelled) setError('Failed to load network data.'); })
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

  // Speakers in the currently-filtered group(s). null means "no group filter"
  // — the canvas shows all tracked speakers. Subgroup wins over project.
  const filteredSpeakerIds = useMemo<Set<number> | null>(() => {
    if (subgroupFilterId != null) {
      const sg = allGroups.find(g => g.id === subgroupFilterId);
      return sg ? new Set(sg.members.map(m => m.id)) : new Set<number>();
    }
    if (projectFilterId != null) {
      const ids = new Set<number>();
      for (const g of allGroups) {
        if (g.parentGroupId === projectFilterId) g.members.forEach(m => ids.add(m.id));
      }
      return ids;
    }
    return null;
  }, [allGroups, projectFilterId, subgroupFilterId]);

  const trackedSpeakers = useMemo(
    () => allSpeakers.filter(s => {
      if (s.isUntracked) return false;
      if (s.isGhost && !showGhosts) return false;
      if (filteredSpeakerIds && !filteredSpeakerIds.has(s.id)) return false;
      return true;
    }),
    [allSpeakers, filteredSpeakerIds, showGhosts],
  );

  const nodes = useMemo(
    () => layoutNodes(trackedSpeakers, connectionsBySpeaker),
    [trackedSpeakers, connectionsBySpeaker],
  );

  const topics = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRelations) if (r.topic) set.add(r.topic);
    return Array.from(set).sort();
  }, [allRelations]);

  const speakerGroupMap = useMemo(() => {
    const map = new Map<number, GroupRecord>();
    for (const group of allGroups)
      for (const member of group.members) map.set(member.id, group);
    return map;
  }, [allGroups]);

  // Top-level groups (projects) drive the filter dropdown.
  const projects = useMemo(
    () => allGroups.filter(g => g.parentGroupId == null),
    [allGroups],
  );

  // When a project is selected, show ONLY its subgroups (not the project row
  // itself). Stacks with the subgroup-level filter for an even narrower view.
  const subgroupsOfProject = useMemo(() => {
    if (projectFilterId == null) return [];
    return allGroups.filter(g => g.parentGroupId === projectFilterId);
  }, [allGroups, projectFilterId]);

  const filteredGroups = useMemo(() => {
    if (projectFilterId == null) return allGroups;
    if (subgroupFilterId != null) {
      return allGroups.filter(g => g.id === subgroupFilterId);
    }
    return subgroupsOfProject;
  }, [allGroups, projectFilterId, subgroupFilterId, subgroupsOfProject]);

  // Reset subgroup filter when project changes.
  useEffect(() => { setSubgroupFilterId(null); }, [projectFilterId]);

  // Reset Bridges selections if they fall out of the filtered set.
  useEffect(() => {
    const ids = new Set(filteredGroups.map(g => g.id));
    if (bridgeGroupA !== '' && !ids.has(bridgeGroupA)) setBridgeGroupA('');
    if (bridgeGroupB !== '' && !ids.has(bridgeGroupB)) setBridgeGroupB('');
    setBridgeSpeakers([]);
  }, [filteredGroups, bridgeGroupA, bridgeGroupB]);

  const bridgeNodeIds = useMemo(() => new Set(bridgeSpeakers.map(s => s.id)), [bridgeSpeakers]);

  // Speaker-image cache for canvas node fills. Each id resolves to a fully
  // loaded HTMLImageElement once its image has been fetched. Bumping
  // `imageVersion` forces a redraw when new images finish loading.
  const speakerImagesRef = useRef<Map<number, HTMLImageElement>>(new Map());
  const [imageVersion, setImageVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    for (const sp of trackedSpeakers) {
      if (!sp.imagePath) continue;
      if (speakerImagesRef.current.has(sp.id)) continue;
      const img = new Image();
      img.crossOrigin = 'anonymous';  // backend CORS allows *
      // Cache-bust by id so the canvas refetches when a fresh image is uploaded;
      // querystring keeps a stable cache key when nothing changed.
      img.src = `${API_BASE}/speakers/${sp.id}/image?v=${encodeURIComponent(sp.imagePath)}`;
      img.onload = () => {
        if (cancelled) return;
        speakerImagesRef.current.set(sp.id, img);
        setImageVersion(v => v + 1);
      };
      img.onerror = () => { /* silent — fall back to color fill */ };
    }
    return () => { cancelled = true; };
  }, [trackedSpeakers]);

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

    const visibleNodeIds = new Set(nodes.filter(n =>
      n.connections >= filter.minConnections &&
      (filter.riskLevel === 'all' || n.riskLevel === filter.riskLevel)
    ).map(n => n.id));
    const nodeById = new Map(nodes.map(n => [n.id, n]));

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
      const isMentioned = edge.topic === 'mentioned';
      ctx.beginPath();
      ctx.moveTo(fromNode.x, fromNode.y);
      ctx.lineTo(toNode.x, toNode.y);
      ctx.strokeStyle = isSelectedEdge ? '#93c5fd' : isMentioned ? '#a78bfa88' : sameGroup ? groupA.color + 'bb' : '#3f3f46';
      ctx.lineWidth = Math.max(1, Math.min(edge.interactionCount, 8) / 2);
      ctx.setLineDash(isMentioned ? [5, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const node of nodes) {
      if (!visibleNodeIds.has(node.id)) continue;
      const isSelected = selectedNode?.id === node.id;
      const isBridge = bridgeNodeIds.has(node.id);
      const nodeRadius = isSelected ? 26 : 18 + Math.min(node.connections, 6);
      const groupColor = speakerGroupMap.get(node.id)?.color;

      if (isBridge) { ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 16; }

      if (node.isGhost) {
        // Ghost nodes: hollow triangle with dashed outline and violet tint
        const h = nodeRadius * 2;
        ctx.beginPath();
        ctx.moveTo(node.x, node.y - h * 0.6);
        ctx.lineTo(node.x + h * 0.6, node.y + h * 0.4);
        ctx.lineTo(node.x - h * 0.6, node.y + h * 0.4);
        ctx.closePath();
        ctx.fillStyle = '#7c3aed22';
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#a78bfa';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // Color fill first — always drawn so the circle has a visible base
        // before the (possibly still-loading) image arrives, and so the area
        // outside the photo's aspect ratio remains the speaker's color.
        ctx.beginPath();
        ctx.arc(node.x, node.y, nodeRadius, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();
        ctx.shadowBlur = 0;

        // If the speaker has an uploaded image, clip to the circle and draw it
        // inside (object-fit: cover style — fills the disc, may crop edges).
        const img = node.imagePath ? speakerImagesRef.current.get(node.id) : undefined;
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(node.x, node.y, nodeRadius, 0, Math.PI * 2);
          ctx.clip();
          const diameter = nodeRadius * 2;
          const scale = Math.max(diameter / img.naturalWidth, diameter / img.naturalHeight);
          const drawW = img.naturalWidth * scale;
          const drawH = img.naturalHeight * scale;
          ctx.drawImage(img, node.x - drawW / 2, node.y - drawH / 2, drawW, drawH);
          ctx.restore();
        }
      }

      if (groupColor) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, nodeRadius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = groupColor;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([]);
        ctx.stroke();
      }

      if (isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, nodeRadius + (groupColor ? 7 : 3), 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.stroke();
      }

      if (isBridge) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, nodeRadius + (groupColor ? 8 : 4), 0, Math.PI * 2);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const labelY = node.y + nodeRadius + (groupColor ? 18 : 13);
      ctx.font = LABEL_FONT;
      ctx.textAlign = 'center';
      const tw = ctx.measureText(node.label).width;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(node.x - tw / 2 - 3, labelY - 10, tw + 6, 13);
      ctx.fillStyle = '#d4d4d8';
      ctx.fillText(node.label, node.x, labelY);
    }

    ctx.restore();
  }, [nodes, allRelations, selectedNode, zoom, filter, speakerGroupMap, bridgeNodeIds, imageVersion]);

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
      const dx = wx - node.x, dy = wy - node.y;
      return Math.sqrt(dx * dx + dy * dy) < 18 + Math.min(node.connections, 6) + 8;
    });
    setSelectedNode(clicked ?? null);
    if (clicked) {
      // Popup floats at the click position; we keep both viewport-relative
      // coords so the popup renders correctly regardless of zoom / scroll.
      setNodeAction({ node: clicked, x: e.clientX, y: e.clientY });
      setNodeActionGroupPicker(false);
    } else {
      setNodeAction(null);
      setNodeActionGroupPicker(false);
    }
  };

  async function handleNodePopupAddToGroup(groupId: number) {
    if (!nodeAction) return;
    try {
      await groupsApi.addMember(groupId, nodeAction.node.id);
      await refreshGroups();
      setNodeAction(null);
      setNodeActionGroupPicker(false);
    } catch { /* show inline? for now swallow */ }
  }

  const connectedNodes = selectedNode
    ? allRelations
        .filter(r => r.speakerA.id === selectedNode.id || r.speakerB.id === selectedNode.id)
        .map(r => {
          const other = r.speakerA.id === selectedNode.id ? r.speakerB : r.speakerA;
          return { id: other.id, label: other.name, color: other.color, weight: r.interactionCount };
        })
    : [];

  async function handleCreateGroup() {
    if (!newGroupName.trim()) return;
    setGroupError('');
    try {
      const created = await groupsApi.create({
        name: newGroupName.trim(),
        color: newGroupColor,
        parentGroupId: newGroupParentId,
        description: null,
      });
      setNewGroupName(''); setNewGroupParentId(null); setShowNewGroupForm(false);
      setExpandedGroupId(created.id);
      await refreshGroups();
    } catch (e: unknown) {
      setGroupError(e instanceof Error ? e.message : 'Failed to create group');
    }
  }

  async function handleDeleteGroup(groupId: number) {
    await groupsApi.remove(groupId);
    if (expandedGroupId === groupId) setExpandedGroupId(null);
    setBridgeSpeakers([]);
    await refreshGroups();
  }

  async function handleAddMember(groupId: number, speakerId: number) {
    await groupsApi.addMember(groupId, speakerId);
    await refreshGroups();
  }

  async function submitAddToGroup() {
    if (!addToGroupTarget || addToGroupSelectedIds.size === 0) return;
    setAddToGroupBusy(true); setAddToGroupError('');
    try {
      await groupsApi.addMembersBatch(addToGroupTarget.id, Array.from(addToGroupSelectedIds));
      await refreshGroups();
      setAddToGroupTarget(null);
      setAddToGroupSelectedIds(new Set());
      setAddToGroupSearch('');
    } catch (e: any) {
      setAddToGroupError(e?.message ?? 'Failed to add members.');
    } finally {
      setAddToGroupBusy(false);
    }
  }

  const toggleAddSpeakerSelected = (id: number) => {
    setAddToGroupSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

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
    } catch { setBridgeSpeakers([]); } finally { setBridgeLoading(false); }
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode; show: boolean }[] = [
    { id: 'filters',  label: 'Filters',  icon: <Filter className="w-3 h-3" />,    show: true },
    { id: 'groups',   label: 'Groups',   icon: <Users className="w-3 h-3" />,     show: isAdmin },
    { id: 'bridges',  label: 'Bridges',  icon: <GitBranch className="w-3 h-3" />, show: allGroups.length >= 2 },
  ].filter(t => t.show);

  const selectCls = 'bg-black border border-zinc-800 rounded px-3 py-1.5 text-white text-xs font-mono focus:outline-none focus:border-blue-500 appearance-none transition-all';

  return (
    <div className="p-6 space-y-4">
      <div>
        <div className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest mb-1">Analysis</div>
        <h1 className="text-white text-2xl font-bold tracking-tight">Relationship Network</h1>
        <p className="text-zinc-300 text-sm mt-0.5">
          Auto-built from recordings — every audio with multiple speakers creates connections.
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-md p-6 text-center">
          <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-2" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && allSpeakers.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-md p-12 text-center">
          <NetworkIcon className="w-10 h-10 text-zinc-300 mx-auto mb-4" />
          <h3 className="text-white text-lg font-semibold mb-2">No connections yet</h3>
          <p className="text-zinc-300 text-sm max-w-md mx-auto">
            Upload audio recordings with two or more speakers and connections will appear here.
          </p>
          <Link to="/upload"
            className="inline-block mt-5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors">
            Go to Upload
          </Link>
        </div>
      )}

      {!loading && !error && allSpeakers.length > 0 && (
        <>
          {/* Controls */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-md overflow-hidden">
            <div className="flex items-center border-b border-zinc-800">
              {tabs.map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono uppercase tracking-wider transition-colors border-b-2 -mb-px ${
                    activeTab === tab.id
                      ? 'text-white border-blue-500 bg-blue-500/8'
                      : 'text-zinc-300 border-transparent hover:text-zinc-200 hover:bg-white/4'
                  }`}
                >
                  {tab.icon}{tab.label}
                  {tab.id === 'groups' && allGroups.length > 0 && (
                    <span className="ml-1 px-1 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded font-mono text-zinc-300">
                      {allGroups.length}
                    </span>
                  )}
                  {tab.id === 'bridges' && bridgeSpeakers.length > 0 && (
                    <span className="ml-1 px-1 py-0.5 text-[10px] bg-amber-600/20 border border-amber-500/30 rounded font-mono text-amber-300">
                      {bridgeSpeakers.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="p-4">
              {activeTab === 'filters' && (
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <label className="text-zinc-300 text-xs font-mono uppercase tracking-wider whitespace-nowrap">Min connections</label>
                    <input
                      type="number"
                      min="0"
                      value={filter.minConnections}
                      onChange={(e) => setFilter({ ...filter, minConnections: Math.max(0, parseInt(e.target.value) || 0) })}
                      className="w-16 bg-black border border-zinc-800 rounded px-2 py-1.5 text-white text-xs font-mono focus:outline-none focus:border-blue-500 transition-all text-center"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-zinc-300 text-xs font-mono uppercase tracking-wider whitespace-nowrap">Risk level</label>
                    <select value={filter.riskLevel} onChange={(e) => setFilter({ ...filter, riskLevel: e.target.value })}
                      className={selectCls}>
                      <option value="all">All</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                  {topics.length > 0 && (
                    <div className="flex items-center gap-2">
                      <label className="text-zinc-300 text-xs font-mono uppercase tracking-wider whitespace-nowrap">Topic</label>
                      <select value={filter.topic} onChange={(e) => setFilter({ ...filter, topic: e.target.value })}
                        className={selectCls}>
                        <option value="all">All</option>
                        {topics.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  )}
                  <button onClick={() => setFilter({ minConnections: 0, topic: 'all', riskLevel: 'all' })}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs rounded transition-colors">
                    Reset
                  </button>
                  <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-zinc-200">
                    <input
                      type="checkbox"
                      checked={showGhosts}
                      onChange={e => setShowGhosts(e.target.checked)}
                      className="accent-violet-500"
                    />
                    Include Ghost speakers
                  </label>
                  <div className="ml-auto flex items-center gap-4 text-[10px] text-zinc-200 font-mono">
                    <div className="flex items-center gap-1.5">
                      <div className="w-4 h-px bg-zinc-700" /><span>Weight</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full border-2 border-white bg-zinc-700" /><span>Selected</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full border-2 border-dashed border-amber-400 bg-zinc-700" /><span>Bridge</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 border border-dashed border-violet-400" style={{ clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)' }} /><span>Ghost</span>
                    </div>
                    {allGroups.map(g => (
                      <div key={g.id} className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-full border-2" style={{ borderColor: g.color, backgroundColor: g.color + '28' }} />
                        <span style={{ color: g.color }}>{g.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'groups' && isAdmin && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-zinc-300 text-xs font-mono">
                        {filteredGroups.length}{projectFilterId != null && ` / ${allGroups.length}`} group{filteredGroups.length !== 1 ? 's' : ''}
                      </span>
                      {projects.length > 0 && (
                        <select
                          value={projectFilterId == null ? '' : String(projectFilterId)}
                          onChange={e => setProjectFilterId(e.target.value === '' ? null : Number(e.target.value))}
                          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-200 text-xs font-mono focus:outline-none focus:border-blue-500"
                          title="Filter by project"
                        >
                          <option value="">All projects</option>
                          {projects.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      )}
                      {projectFilterId != null && subgroupsOfProject.length > 0 && (
                        <select
                          value={subgroupFilterId == null ? '' : String(subgroupFilterId)}
                          onChange={e => setSubgroupFilterId(e.target.value === '' ? null : Number(e.target.value))}
                          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-200 text-xs font-mono focus:outline-none focus:border-blue-500"
                          title="Filter by subgroup"
                        >
                          <option value="">All subgroups</option>
                          {subgroupsOfProject.map(sg => (
                            <option key={sg.id} value={sg.id}>{sg.name}</option>
                          ))}
                        </select>
                      )}
                      {subgroupFilterId != null && (
                        <button
                          onClick={() => {
                            const sg = allGroups.find(g => g.id === subgroupFilterId);
                            if (sg) {
                              setAddToGroupTarget(sg);
                              setAddToGroupSearch('');
                              setAddToGroupSelectedIds(new Set());
                              setAddToGroupError('');
                            }
                          }}
                          className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
                          title="Add speakers to the selected subgroup"
                        >
                          <Plus className="w-3 h-3" /> Add to {allGroups.find(g => g.id === subgroupFilterId)?.name}
                        </button>
                      )}
                    </div>
                    <button onClick={() => { setShowNewGroupForm(v => !v); setGroupError(''); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs rounded transition-colors">
                      <Plus className="w-3 h-3" /> New Group
                    </button>
                  </div>

                  {showNewGroupForm && (
                    <div className="flex items-center gap-3 p-3 bg-black border border-zinc-800 rounded flex-wrap">
                      <input type="text" placeholder="Group name" value={newGroupName}
                        onChange={e => setNewGroupName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleCreateGroup()}
                        className="bg-black border border-zinc-700 rounded px-3 py-1.5 text-white text-xs font-mono focus:outline-none focus:border-blue-500 w-36"
                        autoFocus />
                      <div className="flex gap-1">
                        {GROUP_COLORS.map(c => (
                          <button key={c} onClick={() => setNewGroupColor(c)}
                            className="w-4 h-4 rounded-full border-2 transition-all"
                            style={{ backgroundColor: c, borderColor: newGroupColor === c ? '#fff' : 'transparent' }} />
                        ))}
                      </div>
                      <select
                        value={newGroupParentId == null ? '' : String(newGroupParentId)}
                        onChange={e => setNewGroupParentId(e.target.value === '' ? null : Number(e.target.value))}
                        className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-200 text-xs font-mono focus:outline-none focus:border-blue-500"
                        title="Parent group — leave as 'Top-level' to create a project"
                      >
                        <option value="">Top-level (project)</option>
                        {allGroups.filter(g => g.parentGroupId === null).map(g => (
                          <option key={g.id} value={g.id}>under {g.name}</option>
                        ))}
                      </select>
                      {groupError && <span className="text-red-400 text-xs font-mono">{groupError}</span>}
                      <button onClick={handleCreateGroup}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors">Create</button>
                      <button onClick={() => { setShowNewGroupForm(false); setGroupError(''); setNewGroupParentId(null); }}
                        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs rounded transition-colors">Cancel</button>
                    </div>
                  )}

                  {allGroups.length === 0 && !showNewGroupForm && (
                    <p className="text-zinc-300 text-xs font-mono">No groups yet — create one to start organizing speakers.</p>
                  )}
                  {allGroups.length > 0 && filteredGroups.length === 0 && (
                    <p className="text-zinc-300 text-xs font-mono">
                      No groups under {projects.find(p => p.id === projectFilterId)?.name ?? 'this project'}.
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {filteredGroups.map(group => {
                      const isExpanded = expandedGroupId === group.id;
                      const memberIds = new Set(group.members.map(m => m.id));
                      const unassigned = allSpeakers.filter(s => !memberIds.has(s.id));
                      const isSubgroup = group.parentGroupId != null;
                      return (
                        <div key={group.id}
                          className={`rounded border overflow-hidden ${isSubgroup ? 'ml-6' : ''}`}
                          style={{ borderColor: group.color + '40' }}>
                          <button onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
                            className="flex items-center gap-2 px-3 py-2 w-full text-left transition-colors hover:bg-white/4"
                            style={{ backgroundColor: group.color + '12' }}>
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                            {isSubgroup && (
                              <span className="text-zinc-200 text-[10px] font-mono" title={`subgroup of ${group.parentGroupName}`}>↳</span>
                            )}
                            <span className="text-white text-xs font-medium">{group.name}</span>
                            {isSubgroup && group.parentGroupName && (
                              <span className="text-zinc-200 text-[10px] font-mono">/ {group.parentGroupName}</span>
                            )}
                            <span className="text-[10px] font-mono ml-0.5" style={{ color: group.color + 'aa' }}>{group.members.length}</span>
                            <ChevronDown className="w-3 h-3 ml-auto text-zinc-200 transition-transform"
                              style={{ transform: isExpanded ? 'rotate(180deg)' : undefined }} />
                          </button>
                          {isExpanded && (
                            <div className="px-3 pb-3 pt-2 space-y-2 bg-black/50">
                              <div className="flex flex-wrap gap-1">
                                {group.members.map(m => (
                                  <span key={m.id} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-white"
                                    style={{ backgroundColor: group.color + '25', border: `1px solid ${group.color}40` }}>
                                    {m.name}
                                    <button onClick={() => handleRemoveMember(group.id, m.id)}
                                      className="hover:text-red-400 transition-colors ml-0.5">
                                      <X className="w-2.5 h-2.5" />
                                    </button>
                                  </span>
                                ))}
                                {group.members.length === 0 && <span className="text-zinc-300 text-[10px] font-mono">No members yet</span>}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    setAddToGroupTarget(group);
                                    setAddToGroupSearch('');
                                    setAddToGroupSelectedIds(new Set());
                                    setAddToGroupError('');
                                  }}
                                  className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
                                >
                                  <Plus className="w-3 h-3" /> Add speakers
                                </button>
                                <button onClick={() => handleDeleteGroup(group.id)}
                                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-zinc-200 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors ml-auto">
                                  <Trash2 className="w-3 h-3" /> Delete
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeTab === 'bridges' && (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-zinc-300 text-xs font-mono uppercase tracking-wider">Find bridges between:</span>
                  {projects.length > 0 && (
                    <select
                      value={projectFilterId == null ? '' : String(projectFilterId)}
                      onChange={e => setProjectFilterId(e.target.value === '' ? null : Number(e.target.value))}
                      className={selectCls}
                      title="Filter both dropdowns to one project"
                    >
                      <option value="">All projects</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                  <select value={bridgeGroupA}
                    onChange={e => { setBridgeGroupA(e.target.value === '' ? '' : parseInt(e.target.value)); setBridgeSpeakers([]); }}
                    className={selectCls}>
                    <option value="">Group A</option>
                    {filteredGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <span className="text-zinc-300 font-mono">↔</span>
                  <select value={bridgeGroupB}
                    onChange={e => { setBridgeGroupB(e.target.value === '' ? '' : parseInt(e.target.value)); setBridgeSpeakers([]); }}
                    className={selectCls}>
                    <option value="">Group B</option>
                    {filteredGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <button onClick={handleFindBridges}
                    disabled={bridgeGroupA === '' || bridgeGroupB === '' || bridgeGroupA === bridgeGroupB || bridgeLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-800 disabled:text-zinc-200 text-white text-xs rounded transition-colors">
                    {bridgeLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
                    Find
                  </button>
                  {bridgeSpeakers.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-amber-400 text-xs font-mono">{bridgeSpeakers.length} bridge{bridgeSpeakers.length !== 1 ? 's' : ''}:</span>
                      {bridgeSpeakers.map(s => (
                        <Link key={s.id} to={`/speaker/${s.id}`}
                          className="flex items-center gap-1.5 px-2 py-1 bg-amber-500/10 border border-amber-500/25 rounded text-xs text-white hover:bg-amber-500/20 transition-colors font-mono">
                          <div className="w-2 h-2 rounded-full border border-amber-400" style={{ backgroundColor: s.color }} />
                          {s.name}
                        </Link>
                      ))}
                    </div>
                  )}
                  {!bridgeLoading && bridgeSpeakers.length === 0 && bridgeGroupA !== '' && bridgeGroupB !== '' && bridgeGroupA !== bridgeGroupB && (
                    <span className="text-zinc-200 text-xs font-mono">No bridges found.</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Graph canvas */}
          <div className="bg-black border border-zinc-800 rounded-md">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <span className="text-zinc-200 text-xs font-mono">
                {(() => {
                  const visibleNodeIds = new Set(nodes.map(n => n.id));
                  const visibleEdges = allRelations.filter(r => visibleNodeIds.has(r.speakerA.id) && visibleNodeIds.has(r.speakerB.id));
                  const filterActive = filteredSpeakerIds != null;
                  return <>
                    {filterActive && <span className="text-blue-300">filtered · </span>}
                    {nodes.length} speaker{nodes.length !== 1 ? 's' : ''} · {visibleEdges.length} connection{visibleEdges.length !== 1 ? 's' : ''}
                    {allGroups.length > 0 && ` · ${allGroups.length} group${allGroups.length !== 1 ? 's' : ''}`}
                  </>;
                })()}
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-300 text-[10px] font-mono mr-1">click node to inspect</span>
                <button onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
                  className="p-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 rounded transition-colors">
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setZoom(Math.min(2, zoom + 0.1))}
                  className="p-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 rounded transition-colors">
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setZoom(1)}
                  className="p-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 rounded transition-colors">
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              onClick={handleCanvasClick}
              className="w-full bg-black rounded-b-md cursor-pointer"
            />
          </div>

          {/* Selected node */}
          {selectedNode && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-md px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${selectedNode.color}18` }}>
                    <User className="w-4 h-4" style={{ color: selectedNode.color }} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-white text-sm font-medium">{selectedNode.label}</div>
                    <div className="text-zinc-300 text-xs font-mono capitalize">
                      {selectedNode.riskLevel} risk · {selectedNode.connections} interactions · {selectedNode.recordingCount} recordings
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                  {connectedNodes.length > 0 && (
                    <>
                      <span className="text-zinc-200 text-[10px] font-mono uppercase tracking-wider">Connected to:</span>
                      {connectedNodes.map(conn => (
                        <Link key={conn.id} to={`/speaker/${conn.id}`}
                          className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-xs transition-colors font-mono">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: conn.color }} />
                          <span className="text-zinc-300">{conn.label}</span>
                          <span className="text-zinc-200 flex items-center gap-0.5">
                            <Phone className="w-2.5 h-2.5" />{conn.weight}
                          </span>
                        </Link>
                      ))}
                    </>
                  )}
                  <Link to={`/speaker/${selectedNode.id}`}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors">
                    View Profile
                  </Link>
                  <button onClick={() => setSelectedNode(null)}
                    className="p-1.5 text-zinc-200 hover:text-white transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Speaker-node click popup */}
      {nodeAction && (() => {
        const POPUP_W = 220;
        const POPUP_H = nodeActionGroupPicker ? 260 : 100;
        // Clamp inside viewport so the popup doesn't get clipped.
        const left = Math.max(8, Math.min(window.innerWidth - POPUP_W - 8, nodeAction.x + 12));
        const top = Math.max(8, Math.min(window.innerHeight - POPUP_H - 8, nodeAction.y + 12));
        const speaker = allSpeakers.find(s => s.id === nodeAction.node.id);
        const memberOfIds = new Set(allGroups.filter(g => g.members.some(m => m.id === nodeAction.node.id)).map(g => g.id));
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => { setNodeAction(null); setNodeActionGroupPicker(false); }} />
            <div
              className="fixed z-50 bg-zinc-950 border border-zinc-700 rounded-md shadow-2xl overflow-hidden"
              style={{ left, top, width: POPUP_W }}
            >
              <div className="px-3 py-2 border-b border-zinc-800 flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: nodeAction.node.color }} />
                <span className="text-white text-sm font-medium truncate">{nodeAction.node.label}</span>
              </div>
              {!nodeActionGroupPicker ? (
                <div className="p-2 space-y-1">
                  <button
                    onClick={() => setNodeActionGroupPicker(true)}
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-zinc-200 hover:bg-zinc-800 rounded text-sm text-left transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add to group
                  </button>
                  <Link
                    to={`/speaker/${nodeAction.node.id}`}
                    onClick={() => { setNodeAction(null); setNodeActionGroupPicker(false); }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-zinc-200 hover:bg-zinc-800 rounded text-sm transition-colors"
                  >
                    <User className="w-3.5 h-3.5" /> View profile
                  </Link>
                </div>
              ) : (
                <div className="flex flex-col max-h-60">
                  <button
                    onClick={() => setNodeActionGroupPicker(false)}
                    className="px-3 py-1.5 text-zinc-200 text-[10px] font-mono uppercase tracking-widest hover:bg-zinc-800 text-left transition-colors flex items-center gap-1.5"
                  >
                    ← Pick group
                  </button>
                  <div className="overflow-y-auto">
                    {allGroups.length === 0 ? (
                      <div className="px-3 py-2 text-zinc-300 text-xs">No groups exist.</div>
                    ) : (
                      allGroups.map(g => {
                        const already = memberOfIds.has(g.id);
                        return (
                          <button
                            key={g.id}
                            disabled={already}
                            onClick={() => handleNodePopupAddToGroup(g.id)}
                            className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-colors ${
                              already ? 'text-zinc-300 cursor-not-allowed' : 'text-zinc-200 hover:bg-zinc-800'
                            }`}
                            title={already ? 'Already a member' : ''}
                          >
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                            {g.parentGroupId != null && <span className="text-zinc-300 text-[10px] font-mono">↳</span>}
                            <span className="truncate flex-1">{g.name}</span>
                            {already && <span className="text-zinc-300 text-[10px] font-mono">in</span>}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
              {speaker?.isUntracked && (
                <div className="px-3 py-1.5 border-t border-zinc-800 text-zinc-300 text-[10px] font-mono">
                  Untracked
                </div>
              )}
            </div>
          </>
        );
      })()}

      {/* Add-to-group popup modal */}
      {addToGroupTarget && (() => {
        const memberIds = new Set(addToGroupTarget.members.map(m => m.id));
        const candidates = trackedSpeakers.filter(sp => {
          if (memberIds.has(sp.id)) return false;
          const q = addToGroupSearch.trim().toLowerCase();
          if (!q) return true;
          return sp.name.toLowerCase().includes(q);
        });
        return (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-zinc-950 border border-zinc-800 rounded-md w-full max-w-xl shadow-2xl max-h-[85vh] flex flex-col">
              <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
                <div>
                  <div className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest">Add members</div>
                  <h2 className="text-white font-semibold">Add to {addToGroupTarget.name}</h2>
                </div>
                <button onClick={() => setAddToGroupTarget(null)} className="text-zinc-200 hover:text-zinc-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 border-b border-zinc-800">
                <input
                  type="text" value={addToGroupSearch} onChange={e => setAddToGroupSearch(e.target.value)}
                  placeholder="Search speaker name…" autoFocus
                  className="w-full bg-black border border-zinc-800 rounded px-3 py-2 text-white text-sm placeholder-zinc-400 focus:outline-none focus:border-blue-500 transition-all font-mono"
                />
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {candidates.length === 0 ? (
                  <div className="text-zinc-300 text-sm text-center py-8">No matching speakers.</div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {candidates.map(sp => {
                      const checked = addToGroupSelectedIds.has(sp.id);
                      return (
                        <button
                          key={sp.id}
                          onClick={() => toggleAddSpeakerSelected(sp.id)}
                          className={`flex items-center gap-2.5 p-2 rounded border text-left transition-colors ${
                            checked ? 'border-blue-500/40 bg-blue-500/8' : 'border-zinc-800 bg-black hover:border-zinc-700'
                          }`}
                        >
                          <input
                            type="checkbox" checked={checked} onChange={() => {}}
                            className="w-4 h-4 accent-blue-500 shrink-0 pointer-events-none"
                          />
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: sp.color }} />
                          <span className="text-white text-sm truncate">{sp.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {addToGroupError && (
                <div className="px-4 py-2 border-t border-zinc-800 text-red-400 text-xs font-mono">{addToGroupError}</div>
              )}
              <div className="p-4 border-t border-zinc-800 flex items-center justify-between">
                <span className="text-zinc-300 text-xs font-mono">
                  {addToGroupSelectedIds.size} selected · {candidates.length} available
                </span>
                <div className="flex gap-2">
                  <button onClick={() => setAddToGroupTarget(null)} disabled={addToGroupBusy}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm rounded transition-colors">
                    Cancel
                  </button>
                  <button onClick={submitAddToGroup} disabled={addToGroupBusy || addToGroupSelectedIds.size === 0}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded transition-colors">
                    {addToGroupBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Add {addToGroupSelectedIds.size || ''}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
