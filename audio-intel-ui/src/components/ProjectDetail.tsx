import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Briefcase, Plus, Loader2, AlertCircle, ArrowLeft, Trash2, UserCheck, X, Layers, UserPlus, Search,
} from 'lucide-react';
import Loader from './Loader';
import {
  projects, groups, assignments, users as usersApi, speakers as speakersApi,
  type ProjectDetail as ProjectDetailType,
  type AssignmentRecord, type UserDirectoryRecord, type SpeakerRecord,
} from '../lib/api';
import SpeakerAvatar from './SpeakerAvatar';

interface Props {
  isAdmin: boolean;
}

export default function ProjectDetail({ isAdmin }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const projectId = Number(id);

  const [detail, setDetail] = useState<ProjectDetailType | null>(null);
  const [allAssignments, setAllAssignments] = useState<AssignmentRecord[]>([]);
  const [analysts, setAnalysts] = useState<UserDirectoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showAddSubgroup, setShowAddSubgroup] = useState(false);
  const [subName, setSubName] = useState('');
  const [subColor, setSubColor] = useState('#22d3ee');
  const [subBusy, setSubBusy] = useState(false);
  const [subError, setSubError] = useState('');

  const [assignmentBusy, setAssignmentBusy] = useState<string | null>(null); // key: `${groupId}:${analystId}`

  // "+ Add members" modal state
  const [allSpeakers, setAllSpeakers] = useState<SpeakerRecord[]>([]);
  const [addMembersFor, setAddMembersFor] = useState<{ id: number; name: string } | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberFilterFrom, setMemberFilterFrom] = useState<string>('all'); // 'all' | 'unassigned' | '<otherSubgroupId>'
  const [memberSelectedIds, setMemberSelectedIds] = useState<Set<number>>(new Set());
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberError, setMemberError] = useState('');

  const openAddMembers = (subgroup: { id: number; name: string }) => {
    setAddMembersFor(subgroup);
    setMemberSearch(''); setMemberFilterFrom('all'); setMemberSelectedIds(new Set()); setMemberError('');
  };
  const closeAddMembers = () => { setAddMembersFor(null); };

  const toggleMemberSelected = (id: number) => {
    setMemberSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submitAddMembers = async () => {
    if (!addMembersFor || memberSelectedIds.size === 0) return;
    setMemberBusy(true); setMemberError('');
    try {
      await groups.addMembersBatch(addMembersFor.id, Array.from(memberSelectedIds));
      await load();
      closeAddMembers();
    } catch (e: any) {
      setMemberError(e?.message ?? 'Failed to add members.');
    } finally {
      setMemberBusy(false);
    }
  };

  const handleRemoveMember = async (subgroupId: number, speakerId: number, name: string) => {
    if (!confirm(`Remove "${name}" from this subgroup?`)) return;
    try {
      await groups.removeMember(subgroupId, speakerId);
      await load();
    } catch (e: any) {
      alert(e.message ?? 'Failed to remove speaker from subgroup.');
    }
  };

  const load = async () => {
    if (!projectId) return;
    setLoading(true); setError('');
    try {
      const [proj, asn] = await Promise.all([
        projects.get(projectId),
        assignments.forProject(projectId).catch(() => [] as AssignmentRecord[]),
      ]);
      setDetail(proj);
      setAllAssignments(asn);
      if (isAdmin) {
        const [list, sp] = await Promise.all([
          usersApi.listAnalysts().catch(() => [] as UserDirectoryRecord[]),
          speakersApi.list().catch(() => [] as SpeakerRecord[]),
        ]);
        setAnalysts(list);
        setAllSpeakers(sp);
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to load project.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId, isAdmin]);

  const handleAddSubgroup = async () => {
    if (!subName.trim()) return;
    setSubBusy(true); setSubError('');
    try {
      await groups.create({
        name: subName.trim(),
        color: subColor,
        parentGroupId: projectId,
        description: null,
      });
      setSubName(''); setSubColor('#22d3ee');
      setShowAddSubgroup(false);
      await load();
    } catch (e: any) {
      setSubError(e.message ?? 'Failed to add subgroup.');
    } finally {
      setSubBusy(false);
    }
  };

  const handleDeleteSubgroup = async (subgroupId: number, name: string) => {
    if (!confirm(`Delete subgroup "${name}"? Its assignments will also be removed.`)) return;
    try {
      await groups.remove(subgroupId);
      await load();
    } catch (e: any) {
      alert(e.message ?? 'Failed to delete subgroup.');
    }
  };

  const handleAssign = async (groupId: number, analystUserId: number) => {
    const key = `${groupId}:${analystUserId}`;
    setAssignmentBusy(key);
    try {
      await assignments.add(analystUserId, groupId);
      await load();
    } catch (e: any) {
      alert(e.message ?? 'Failed to assign analyst.');
    } finally {
      setAssignmentBusy(null);
    }
  };

  const handleUnassign = async (assignmentId: number) => {
    setAssignmentBusy(`del:${assignmentId}`);
    try {
      await assignments.remove(assignmentId);
      await load();
    } catch (e: any) {
      alert(e.message ?? 'Failed to remove assignment.');
    } finally {
      setAssignmentBusy(null);
    }
  };

  const handleDeleteProject = async () => {
    if (!detail) return;
    if (!confirm(`Delete project "${detail.name}"?\nThis removes all its subgroups, member links, and assignments.`)) return;
    try {
      await groups.remove(detail.id);
      navigate('/projects', { replace: true });
    } catch (e: any) {
      alert(e.message ?? 'Failed to delete project.');
    }
  };

  const assignmentsByGroup = useMemo(() => {
    const map = new Map<number, AssignmentRecord[]>();
    for (const a of allAssignments) {
      const arr = map.get(a.groupId) ?? [];
      arr.push(a);
      map.set(a.groupId, arr);
    }
    return map;
  }, [allAssignments]);

  if (loading) return <Loader />;

  if (error || !detail) return (
    <div className="p-6">
      <div className="bg-red-500/5 border border-red-500/20 rounded-md p-6 text-center">
        <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-2" />
        <p className="text-red-400 text-sm">{error || 'Project not found.'}</p>
      </div>
    </div>
  );

  const totalMembers = detail.subgroups.reduce((acc, s) => acc + s.members.length, 0) + detail.members.length;

  return (
    <div className="p-6 space-y-5">
      <button onClick={() => navigate('/projects')}
        className="inline-flex items-center gap-1.5 text-zinc-200 hover:text-zinc-200 text-sm transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> All projects
      </button>

      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-md overflow-hidden">
        <div className="h-1.5" style={{ backgroundColor: detail.color }} />
        <div className="p-5 flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-4 min-w-0">
            <Briefcase className="w-8 h-8 shrink-0" style={{ color: detail.color }} />
            <div className="min-w-0">
              <div className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest mb-1">Project</div>
              <h1 className="text-white text-2xl font-bold tracking-tight">{detail.name}</h1>
              {detail.description && (
                <p className="text-zinc-300 text-sm mt-1 max-w-prose">{detail.description}</p>
              )}
              <div className="flex flex-wrap gap-3 mt-3 text-xs font-mono text-zinc-300">
                <span>{detail.subgroups.length} subgroup{detail.subgroups.length !== 1 ? 's' : ''}</span>
                <span>·</span>
                <span>{totalMembers} speaker{totalMembers !== 1 ? 's' : ''}</span>
                <span>·</span>
                <span>{allAssignments.length} assignment{allAssignments.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>
          {isAdmin && (
            <button onClick={handleDeleteProject}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-red-500/20 hover:text-red-300 border border-zinc-700 hover:border-red-500/40 text-zinc-300 text-xs rounded-md transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> Delete project
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Subgroups */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
              <span className="text-zinc-300 text-xs font-mono uppercase tracking-widest">Subgroups</span>
              {isAdmin && (
                <button onClick={() => setShowAddSubgroup(v => !v)}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-md transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Add subgroup
                </button>
              )}
            </div>

            {isAdmin && showAddSubgroup && (
              <div className="p-4 border-b border-zinc-800 bg-blue-500/4">
                <div className="flex gap-2 items-end flex-wrap">
                  <div className="flex-1 min-w-50">
                    <label className="block text-zinc-300 text-[10px] font-mono uppercase tracking-widest mb-1">Name</label>
                    <input value={subName} onChange={e => setSubName(e.target.value)}
                      placeholder="e.g. Ferrari" autoFocus
                      onKeyDown={e => e.key === 'Enter' && handleAddSubgroup()}
                      className="w-full bg-black border border-zinc-800 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition-all" />
                  </div>
                  <div>
                    <label className="block text-zinc-300 text-[10px] font-mono uppercase tracking-widest mb-1">Color</label>
                    <input type="color" value={subColor} onChange={e => setSubColor(e.target.value)}
                      className="w-12 h-9 bg-black border border-zinc-800 rounded cursor-pointer" />
                  </div>
                  <button onClick={handleAddSubgroup} disabled={subBusy || !subName.trim()}
                    className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-md transition-colors">
                    {subBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Create
                  </button>
                  <button onClick={() => setShowAddSubgroup(false)}
                    className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded-md transition-colors">
                    Cancel
                  </button>
                </div>
                {subError && (
                  <div className="mt-2 px-3 py-2 bg-red-500/8 border border-red-500/25 rounded text-red-400 text-xs">{subError}</div>
                )}
              </div>
            )}

            {detail.subgroups.length === 0 ? (
              <div className="text-center py-10">
                <Layers className="w-6 h-6 text-zinc-700 mx-auto mb-2" />
                <p className="text-zinc-200 text-sm">No subgroups yet.</p>
                {isAdmin && <p className="text-zinc-300 text-xs mt-1">Add one above to start breaking the project down.</p>}
              </div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {detail.subgroups.map(sg => (
                  <div key={sg.id} className="p-5">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: sg.color }} />
                        <div className="min-w-0">
                          <Link to={`/network`} className="text-white text-sm font-semibold hover:text-blue-400 transition-colors">
                            {sg.name}
                          </Link>
                          <div className="text-zinc-200 text-[11px] font-mono">
                            {sg.members.length} speaker{sg.members.length !== 1 ? 's' : ''}
                            {sg.assignedAnalysts.length > 0 && ` · ${sg.assignedAnalysts.length} analyst${sg.assignedAnalysts.length !== 1 ? 's' : ''}`}
                          </div>
                        </div>
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-1">
                          <button onClick={() => openAddMembers({ id: sg.id, name: sg.name })}
                            className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-md transition-colors"
                            title="Add speakers to this subgroup">
                            <UserPlus className="w-3.5 h-3.5" /> Add
                          </button>
                          <button onClick={() => handleDeleteSubgroup(sg.id, sg.name)}
                            className="text-zinc-300 hover:text-red-400 transition-colors p-1">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Members */}
                    {sg.members.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {sg.members.slice(0, 10).map(m => (
                          <span key={m.id} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-zinc-800 bg-black">
                            <Link to={`/speaker/${m.id}`}
                              className="inline-flex items-center gap-1.5 hover:text-blue-300 transition-colors">
                              <SpeakerAvatar speakerId={m.id} name={m.name} color={m.color}
                                imagePath={m.imagePath} size={16} />
                              <span className="text-zinc-200 text-xs">{m.name}</span>
                            </Link>
                            <button
                              onClick={() => handleRemoveMember(sg.id, m.id, m.name)}
                              title={`Remove ${m.name} from ${sg.name}`}
                              className="text-zinc-500 hover:text-red-400 transition-colors ml-0.5">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                        {sg.members.length > 10 && (
                          <span className="text-zinc-200 text-[11px] font-mono px-2 py-0.5">+{sg.members.length - 10} more</span>
                        )}
                      </div>
                    )}

                    {/* Assignment row (admin) */}
                    {isAdmin && (
                      <div className="border-t border-zinc-800 pt-3">
                        <div className="text-zinc-300 text-[10px] font-mono uppercase tracking-widest mb-2">Assigned analysts</div>
                        <div className="flex flex-wrap gap-2">
                          {(assignmentsByGroup.get(sg.id) ?? []).map(a => (
                            <span key={a.id} className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-200 text-xs font-mono">
                              <UserCheck className="w-3 h-3" />
                              {a.analystUsername}
                              <button onClick={() => handleUnassign(a.id)}
                                disabled={assignmentBusy === `del:${a.id}`}
                                className="ml-1 p-0.5 rounded-md hover:bg-red-500/20 hover:text-red-300 transition-colors">
                                {assignmentBusy === `del:${a.id}`
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : <X className="w-3 h-3" />}
                              </button>
                            </span>
                          ))}
                          <AnalystPicker
                            analysts={analysts}
                            alreadyAssigned={(assignmentsByGroup.get(sg.id) ?? []).map(a => a.analystUserId)}
                            busyKey={assignmentBusy}
                            groupId={sg.id}
                            onPick={(userId) => handleAssign(sg.id, userId)}
                          />
                        </div>
                      </div>
                    )}

                    {/* Assignment row (analyst view) */}
                    {!isAdmin && sg.assignedAnalysts.length > 0 && (
                      <div className="border-t border-zinc-800 pt-3">
                        <div className="text-zinc-300 text-[10px] font-mono uppercase tracking-widest mb-2">Assigned analysts</div>
                        <div className="flex flex-wrap gap-2">
                          {sg.assignedAnalysts.map(a => (
                            <span key={a.id} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-200 text-xs font-mono">
                              <UserCheck className="w-3 h-3" /> {a.username}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="px-5 py-3.5 border-b border-zinc-800">
              <span className="text-zinc-300 text-xs font-mono uppercase tracking-widest">Summary</span>
            </div>
            <div className="px-5 py-4 space-y-3 text-xs font-mono">
              {[
                { label: 'Subgroups',   value: detail.subgroups.length },
                { label: 'Speakers',    value: totalMembers },
                { label: 'Analysts',    value: new Set(allAssignments.map(a => a.analystUserId)).size },
                { label: 'Assignments', value: allAssignments.length },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-zinc-300 uppercase tracking-wider">{label}</span>
                  <span className="text-white">{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-md">
            <div className="px-5 py-3.5 border-b border-zinc-800">
              <span className="text-zinc-300 text-xs font-mono uppercase tracking-widest">Audios</span>
            </div>
            <div className="px-5 py-4 text-xs space-y-2">
              <p className="text-zinc-300">
                Audio access is filtered by your assignments — see what's visible to you on the Uploads page.
              </p>
              <Link to="/all-uploads"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 rounded-md transition-colors">
                Go to uploads →
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* "+ Add members" modal */}
      {addMembersFor && detail && (() => {
        const targetMemberIds = new Set(
          (detail.subgroups.find(sg => sg.id === addMembersFor.id)?.members ?? []).map(m => m.id)
        );
        const speakerToSubgroup = new Map<number, { id: number; name: string }>();
        for (const sg of detail.subgroups) {
          for (const m of sg.members) speakerToSubgroup.set(m.id, { id: sg.id, name: sg.name });
        }
        const candidates = allSpeakers.filter(sp => {
          if (targetMemberIds.has(sp.id)) return false; // already in
          if (memberFilterFrom === 'all') return true;
          const inSub = speakerToSubgroup.get(sp.id);
          if (memberFilterFrom === 'unassigned') return inSub == null;
          return inSub?.id === Number(memberFilterFrom);
        }).filter(sp => {
          const q = memberSearch.trim().toLowerCase();
          if (!q) return true;
          return sp.name.toLowerCase().includes(q);
        });
        const otherSubgroups = detail.subgroups.filter(sg => sg.id !== addMembersFor.id);
        return (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-zinc-950 border border-zinc-800 rounded-md w-full max-w-2xl shadow-2xl max-h-[85vh] flex flex-col">
              <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
                <div>
                  <div className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest">Add members</div>
                  <h2 className="text-white font-semibold">Add to {addMembersFor.name}</h2>
                </div>
                <button onClick={closeAddMembers} className="text-zinc-300 hover:text-zinc-100">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 border-b border-zinc-800 flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-50">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-300" />
                  <input
                    type="text" value={memberSearch} onChange={e => setMemberSearch(e.target.value)}
                    placeholder="Search speaker name…"
                    className="w-full bg-black border border-zinc-800 rounded pl-9 pr-3 py-2 text-white text-sm placeholder-zinc-400 focus:outline-none focus:border-blue-500 transition-all font-mono"
                    autoFocus
                  />
                </div>
                <select
                  value={memberFilterFrom}
                  onChange={e => setMemberFilterFrom(e.target.value)}
                  className="bg-black border border-zinc-800 rounded px-3 py-2 text-zinc-200 text-xs font-mono focus:outline-none focus:border-blue-500"
                >
                  <option value="all">All speakers</option>
                  <option value="unassigned">Unassigned (no subgroup)</option>
                  {otherSubgroups.map(sg => (
                    <option key={sg.id} value={String(sg.id)}>Currently in: {sg.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {candidates.length === 0 ? (
                  <div className="text-zinc-300 text-sm text-center py-8">
                    No speakers match this filter.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {candidates.map(sp => {
                      const inSub = speakerToSubgroup.get(sp.id);
                      const checked = memberSelectedIds.has(sp.id);
                      return (
                        <button
                          key={sp.id}
                          onClick={() => toggleMemberSelected(sp.id)}
                          className={`flex items-center gap-3 p-2.5 rounded-md border transition-colors text-left ${
                            checked
                              ? 'border-blue-500/40 bg-blue-500/8'
                              : 'border-zinc-800 bg-black hover:border-zinc-700'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {}}
                            className="w-4 h-4 accent-blue-500 shrink-0 pointer-events-none"
                          />
                          <SpeakerAvatar speakerId={sp.id} name={sp.name} color={sp.color}
                            imagePath={sp.imagePath} size={28} />
                          <div className="min-w-0 flex-1">
                            <div className="text-white text-sm truncate">{sp.name}</div>
                            {inSub && (
                              <div className="text-zinc-300 text-[11px] font-mono truncate">
                                in: {inSub.name}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {memberError && (
                <div className="px-4 py-2 border-t border-zinc-800 text-red-400 text-xs font-mono">{memberError}</div>
              )}

              <div className="p-4 border-t border-zinc-800 flex items-center justify-between">
                <span className="text-zinc-300 text-xs font-mono">
                  {memberSelectedIds.size} selected · {candidates.length} shown
                </span>
                <div className="flex gap-2">
                  <button onClick={closeAddMembers} disabled={memberBusy}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm rounded-md transition-colors">
                    Cancel
                  </button>
                  <button onClick={submitAddMembers} disabled={memberBusy || memberSelectedIds.size === 0}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-md transition-colors">
                    {memberBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                    Add {memberSelectedIds.size > 0 ? memberSelectedIds.size : ''}
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

/* — Inline analyst picker — */

function AnalystPicker({
  analysts, alreadyAssigned, onPick, busyKey, groupId,
}: {
  analysts: UserDirectoryRecord[];
  alreadyAssigned: number[];
  onPick: (userId: number) => void;
  busyKey: string | null;
  groupId: number;
}) {
  const [open, setOpen] = useState(false);
  const available = analysts.filter(a => !alreadyAssigned.includes(a.id));
  if (available.length === 0) return null;
  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-dashed border-zinc-700 text-zinc-200 hover:text-zinc-200 hover:border-zinc-500 text-xs font-mono transition-colors">
        <Plus className="w-3 h-3" /> assign
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-7 z-20 w-56 bg-zinc-950 border border-zinc-800 rounded shadow-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-zinc-800 text-zinc-300 text-[10px] font-mono uppercase tracking-widest">
              Pick analyst
            </div>
            <div className="max-h-60 overflow-y-auto">
              {available.map(a => {
                const busy = busyKey === `${groupId}:${a.id}`;
                return (
                  <button key={a.id}
                    onClick={() => { onPick(a.id); setOpen(false); }}
                    disabled={busy}
                    className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-900 transition-colors text-zinc-200 text-xs">
                    <span className="truncate">
                      {a.firstName || a.lastName ? `${a.firstName} ${a.lastName}`.trim() : a.username}
                      <span className="text-zinc-200 font-mono ml-1">@{a.username}</span>
                    </span>
                    {busy && <Loader2 className="w-3 h-3 animate-spin shrink-0 ml-1" />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

