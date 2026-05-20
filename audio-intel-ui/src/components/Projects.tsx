import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Briefcase, Plus, Loader2, AlertCircle, Users, Layers, UserCheck, ArrowRight, X,
} from 'lucide-react';
import {
  projects, groups, assignments,
  type ProjectSummary, type AssignmentRecord,
} from '../lib/api';

interface Props {
  isAdmin: boolean;
  currentUserId: number;
}

export default function Projects({ isAdmin, currentUserId }: Props) {
  const [items, setItems] = useState<ProjectSummary[]>([]);
  const [myAssignments, setMyAssignments] = useState<AssignmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#6366f1');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [list, mine] = await Promise.all([
        projects.list(),
        isAdmin || !currentUserId
          ? Promise.resolve<AssignmentRecord[]>([])
          : assignments.forUser(currentUserId),
      ]);
      setItems(list);
      setMyAssignments(mine);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load projects.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isAdmin, currentUserId]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true); setCreateError('');
    try {
      await groups.create({
        name: newName.trim(),
        color: newColor,
        parentGroupId: null,
        description: newDescription.trim() || null,
      });
      setNewName(''); setNewColor('#6366f1'); setNewDescription('');
      setCreateOpen(false);
      await load();
    } catch (e: any) {
      setCreateError(e.message ?? 'Failed to create project.');
    } finally {
      setCreating(false);
    }
  };

  const myAssignmentsByProject = useMemo(() => {
    const map = new Map<number, AssignmentRecord[]>();
    for (const a of myAssignments) {
      const pid = a.parentGroupId ?? a.groupId;
      const arr = map.get(pid) ?? [];
      arr.push(a);
      map.set(pid, arr);
    }
    return map;
  }, [myAssignments]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest mb-1">Investigations</div>
          <h1 className="text-white text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-zinc-200 text-xs font-mono mt-0.5">
            {isAdmin
              ? `${items.length} project${items.length !== 1 ? 's' : ''} · manage assignments and subgroups`
              : `${items.length} project${items.length !== 1 ? 's' : ''} assigned to you`}
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors">
            <Plus className="w-4 h-4" /> New project
          </button>
        )}
      </div>

      {createOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-md w-full max-w-md shadow-2xl">
            <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
              <span className="text-zinc-300 text-xs font-mono uppercase tracking-widest">New Project</span>
              <button onClick={() => setCreateOpen(false)} className="text-zinc-200 hover:text-zinc-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-zinc-300 text-xs font-mono uppercase tracking-widest mb-1.5">Name</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} autoFocus
                  placeholder="e.g. Formula1"
                  className="w-full bg-black border border-zinc-800 rounded px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 transition-all" />
              </div>
              <div>
                <label className="block text-zinc-300 text-xs font-mono uppercase tracking-widest mb-1.5">Color</label>
                <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)}
                  className="w-12 h-9 bg-black border border-zinc-800 rounded cursor-pointer" />
              </div>
              <div>
                <label className="block text-zinc-300 text-xs font-mono uppercase tracking-widest mb-1.5">Description (optional)</label>
                <textarea value={newDescription} onChange={e => setNewDescription(e.target.value)}
                  rows={3} placeholder="What is this investigation about?"
                  className="w-full bg-black border border-zinc-800 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition-all" />
              </div>
              {createError && (
                <div className="px-3 py-2 bg-red-500/8 border border-red-500/25 rounded text-red-400 text-xs">{createError}</div>
              )}
            </div>
            <div className="p-4 flex gap-2 justify-end border-t border-zinc-800">
              <button onClick={() => setCreateOpen(false)} disabled={creating}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded transition-colors">
                Cancel
              </button>
              <button onClick={handleCreate} disabled={creating || !newName.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded transition-colors">
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-500/5 border border-red-500/20 rounded-md p-6 text-center">
          <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-2" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="border border-dashed border-zinc-800 rounded-md p-10 text-center">
          <Briefcase className="w-6 h-6 text-zinc-700 mx-auto mb-2" />
          <p className="text-zinc-200 text-sm">
            {isAdmin ? 'No projects yet. Use "New project" to create one.' : 'You have not been assigned to any project yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map(p => {
            const mine = !isAdmin ? myAssignmentsByProject.get(p.id) ?? [] : [];
            return (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className="block bg-zinc-900 border border-zinc-800 rounded-md hover:border-zinc-600 transition-colors group"
              >
                <div className="h-1.5 rounded-t" style={{ backgroundColor: p.color }} />
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Briefcase className="w-4 h-4 shrink-0" style={{ color: p.color }} />
                      <span className="text-white text-base font-semibold truncate">{p.name}</span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-zinc-300 group-hover:text-zinc-100 transition-colors shrink-0" />
                  </div>
                  {p.description && (
                    <p className="text-zinc-300 text-xs leading-relaxed line-clamp-2">{p.description}</p>
                  )}
                  <div className="flex flex-wrap gap-3 text-[11px] font-mono">
                    <span className="inline-flex items-center gap-1 text-zinc-300">
                      <Layers className="w-3 h-3" /> {p.subgroupCount} subgroups
                    </span>
                    <span className="inline-flex items-center gap-1 text-zinc-300">
                      <Users className="w-3 h-3" /> {p.memberCount} speakers
                    </span>
                    <span className="inline-flex items-center gap-1 text-zinc-300">
                      <UserCheck className="w-3 h-3" /> {p.assignedAnalystCount} analyst{p.assignedAnalystCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {!isAdmin && mine.length > 0 && (
                    <div className="pt-2 border-t border-zinc-800">
                      <div className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest mb-1">You handle</div>
                      <div className="flex flex-wrap gap-1.5">
                        {mine.map(a => (
                          <span key={a.id} className="px-2 py-0.5 rounded border border-blue-500/30 bg-blue-500/8 text-blue-300 text-[11px] font-mono">
                            {a.groupName}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
