const BASE = "http://localhost:8001";
const ML_BASE = "http://localhost:8000";
export const API_BASE = BASE;

// Identity threading: filtered endpoints take ?user_id=. App.tsx calls
// setApiUser(user) on login / null on logout so every list-style call
// auto-appends it. Backend treats missing user_id as admin (back-compat).
let _currentUser: { id: number; role: string } | null = null;

export const setApiUser = (u: { id: number; role: string } | null) => {
  _currentUser = u ? { id: u.id, role: u.role } : null;
};

export const getApiUser = () => _currentUser;

/** Append user_id=<id> to a path; preserves existing query string. */
export function withUser(path: string): string {
  if (!_currentUser) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}user_id=${_currentUser.id}`;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  base = BASE
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(err.detail ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: number;
  username: string;
  role: string;
  firstName: string;
  lastName: string;
  idNumber: string;
  createdAt: string;
  mustChangePassword: boolean;
}

export interface UserRecord {
  id: number;
  username: string;
  role: string;
  firstName: string;
  lastName: string;
  idNumber: string;
  createdAt: string;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const auth = {
  login: (username: string, password: string) =>
    request<AuthUser>("POST", "/auth/login", { username, password }),

  verifyAdmin: (username: string, password: string) =>
    request<{ valid: boolean }>("POST", "/auth/verify-admin", { username, password }),

  changePassword: (username: string, newPassword: string) =>
    request<{ success: boolean }>("PUT", "/auth/password", {
      username,
      new_password: newPassword,
    }),
};

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = {
  list: () => request<UserRecord[]>("GET", "/users"),

  listByRole: (role?: 'Admin' | 'Analyst') => {
    const qs = role ? `?role=${encodeURIComponent(role)}` : '';
    return request<UserRecord[]>("GET", `/users${qs}`);
  },

  listAnalysts: () => request<UserRecord[]>("GET", "/users?role=Analyst"),

  create: (data: {
    username: string;
    password: string;
    role: string;
    firstName: string;
    lastName: string;
    idNumber: string;
  }) => request<{ success: boolean }>("POST", "/users", data),

  update: (
    id: number,
    data: { firstName: string; lastName: string; idNumber: string; role: string; password?: string }
  ) => request<{ success: boolean }>("PUT", `/users/${id}`, data),

  remove: (id: number, adminUsername: string, adminPassword: string) =>
    request<{ success: boolean }>("DELETE", `/users/${id}`, {
      admin_username: adminUsername,
      admin_password: adminPassword,
    }),
};

// ─── Profile ──────────────────────────────────────────────────────────────────

export const profile = {
  updateMe: (userId: number, firstName: string, lastName: string, password?: string) =>
    request<{ success: boolean; firstName: string; lastName: string }>("PUT", "/profile/me", {
      user_id: userId,
      firstName,
      lastName,
      password: password ?? "",
    }),
};

// ─── Audio types ──────────────────────────────────────────────────────────────

export interface AudioRecord {
  id: number;
  name: string;
  description: string;
  duration: number;
  fileSize: number;
  status: 'processing' | 'processed' | 'failed';
  uploadedAt: string;
  recordedAt: string | null;
  uploadedBy: string;
  speakerCount: number;
}

export interface UploadResult {
  id: number;
  name: string;
  status: string;
}

export interface SubScores {
  a: number | null;
  b: number | null;
  c: number | null;
  d: number | null;
}

export interface SegmentRecord {
  id: number;
  speakerId: number;
  speakerName: string;
  speakerColor: string;
  speakerImagePath?: string | null;
  text: string;
  startTime: number;
  endTime: number;
  suspicionScore?: number | null;
  subScores?: SubScores | null;
}

export interface SpeakerRecord {
  id: number;
  voiceIdentifier: string;
  name: string;
  color: string;
  riskLevel: 'low' | 'medium' | 'high';
  firstDetected: string;
  wikidataId: string | null;
  imagePath: string | null;
  isUntracked: boolean;
  recordingCount: number;
  sampleCount: number;
}

export interface EntityCandidate {
  entityId: string;       // e.g. "Q9682"
  label: string;          // display name
  description: string;    // short tagline
  imageUrl: string;       // may be empty
}

export interface RelatedEntity {
  entityId: string;
  label: string;
  description: string;
  imageUrl: string;
  reason: string;         // human-readable connection reason
}

export interface EnrichmentLinkResult {
  newSpeakerId: number;
  reused: boolean;
}

export interface EnrollSpeakerResult {
  status: string;
  message: string;
  speakerId: number;
  sampleCount: number;
  addedThisCall: number;
}

export interface SpeakerSuggestion {
  id: number;
  confidence: number;
  createdAt: string;
  unknownSpeaker: { id: number; name: string; color: string };
  suggestedSpeaker: { id: number; name: string; color: string };
}

// ─── Audios ───────────────────────────────────────────────────────────────────

export const audios = {
  upload: (
    file: File,
    name: string,
    description: string,
    uploadedBy: number,
    recordedAt: string,
  ): Promise<UploadResult> => {
    const form = new FormData();
    form.append("file", file);
    form.append("name", name);
    form.append("description", description);
    form.append("uploaded_by", String(uploadedBy));
    form.append("recorded_at", recordedAt);
    return fetch(`${BASE}/audios/upload`, { method: "POST", body: form }).then(async (r) => {
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: "Upload failed" }));
        throw new Error(err.detail ?? "Upload failed");
      }
      return r.json() as Promise<UploadResult>;
    });
  },

  list: () => request<AudioRecord[]>("GET", withUser("/audios")),
  get: (id: number) => request<AudioRecord>("GET", withUser(`/audios/${id}`)),
  remove: (id: number) => request<{ success: boolean }>("DELETE", `/audios/${id}`),
  batchDelete: (ids: number[]) =>
    request<{ deleted: number[]; failed: { id: number; reason: string }[] }>(
      "POST", "/audios/batch-delete", { ids },
    ),
  getSegments: (id: number) => request<SegmentRecord[]>("GET", withUser(`/audios/${id}/segments`)),
  getProgress: (id: number) => request<{ pct: number; label: string }>("GET", `/audios/${id}/progress`),
  fileUrl: (id: number) => `${BASE}/audios/${id}/file`,
  retry: (id: number) => request<{ success: boolean }>("POST", `/audios/${id}/retry`),
};

// ─── Speakers ─────────────────────────────────────────────────────────────────

export interface UpdateSpeakerResult {
  success: boolean;
  merged: boolean;
  mergedIntoId?: number;
  mergedIntoName?: string;
}

export interface SpeakerAudioRecord {
  id: number;
  name: string;
  description: string;
  duration: number;
  fileSize: number;
  status: 'processing' | 'processed' | 'failed';
  uploadedAt: string;
  uploadedBy: string;
  segmentCount: number;
  speakingTime: number;
}

export const speakers = {
  list: () => request<SpeakerRecord[]>("GET", withUser("/speakers")),
  get: (id: number) => request<SpeakerRecord>("GET", `/speakers/${id}`),
  audios: (id: number) => request<SpeakerAudioRecord[]>("GET", `/speakers/${id}/audios`),
  update: (id: number, name: string, riskLevel: string, forceSeparate = false) =>
    request<UpdateSpeakerResult>("PUT", `/speakers/${id}`, { name, riskLevel, forceSeparate }),
  remove: (id: number) => request<{ success: boolean }>("DELETE", `/speakers/${id}`),
  reassign: (audioId: number, speakerId: number, newName: string, forceSeparate = false) =>
    request<SpeakerRecord>("POST", `/audios/${audioId}/speakers/${speakerId}/reassign`, {
      new_name: newName,
      force_separate: forceSeparate,
    }),
  split: (audioId: number, speakerId: number, segmentIds: number[], newName = "") =>
    request<SpeakerRecord>("POST", `/audios/${audioId}/speakers/${speakerId}/split`, {
      segment_ids: segmentIds,
      new_name: newName,
    }),
  enroll: (name: string, file: File): Promise<EnrollSpeakerResult> => {
    const form = new FormData();
    form.append("name", name);
    form.append("file", file);
    return fetch(`${BASE}/speakers/enroll`, { method: "POST", body: form }).then(async (r) => {
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: "Enroll failed" }));
        throw new Error(err.detail ?? "Enroll failed");
      }
      return r.json() as Promise<EnrollSpeakerResult>;
    });
  },

  enrichmentSearch: (speakerId: number, query: string, limit = 5) =>
    request<EntityCandidate[]>(
      "GET",
      `/speakers/${speakerId}/enrichment/search?query=${encodeURIComponent(query)}&limit=${limit}`
    ),

  enrichmentConfirm: (speakerId: number, entityId: string) =>
    request<{ success: boolean; speakerId: number; wikidataId: string }>(
      "POST", `/speakers/${speakerId}/enrichment/confirm`, { entityId }
    ),

  enrichmentRelated: (speakerId: number, limit = 25) =>
    request<RelatedEntity[]>(
      "GET", `/speakers/${speakerId}/enrichment/related?limit=${limit}`
    ),

  enrichmentLink: (speakerId: number, entityId: string, name: string, file: File | null): Promise<EnrichmentLinkResult> => {
    const form = new FormData();
    form.append("entityId", entityId);
    form.append("name", name);
    if (file) form.append("file", file);
    return fetch(`${BASE}/speakers/${speakerId}/enrichment/link`, { method: "POST", body: form }).then(async (r) => {
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: "Link failed" }));
        throw new Error(err.detail ?? "Link failed");
      }
      return r.json() as Promise<EnrichmentLinkResult>;
    });
  },

  uploadImage: (speakerId: number, file: File): Promise<{ success: boolean; imagePath: string }> => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${BASE}/speakers/${speakerId}/image`, { method: "POST", body: form }).then(async (r) => {
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: "Upload failed" }));
        throw new Error(err.detail ?? "Upload failed");
      }
      return r.json() as Promise<{ success: boolean; imagePath: string }>;
    });
  },

  deleteImage: (speakerId: number) =>
    request<{ success: boolean }>("DELETE", `/speakers/${speakerId}/image`),

  setUntracked: (speakerId: number, untracked: boolean) =>
    request<SpeakerRecord>("PUT", `/speakers/${speakerId}/tracked`, { untracked }),

  batchDelete: (ids: number[]) =>
    request<{ deleted: number[]; failed: { id: number; reason: string }[] }>(
      "POST", "/speakers/batch-delete", { ids },
    ),

  matchSuggestions: (id: number, limit = 5) =>
    request<MatchSuggestion[]>("GET", `/speakers/${id}/match-suggestions?limit=${limit}`),
};

export interface MatchSuggestion {
  id: number;
  name: string;
  color: string;
  imagePath: string | null;
  riskLevel: 'low' | 'medium' | 'high';
  confidence: number;
}

export const suggestions = {
  listForAudio: (audioId: number) =>
    request<SpeakerSuggestion[]>("GET", `/audios/${audioId}/suggestions`),
  accept: (audioId: number, suggestionId: number) =>
    request<{ success: boolean; mergedIntoId: number }>(
      "POST", `/audios/${audioId}/suggestions/${suggestionId}/accept`
    ),
  reject: (audioId: number, suggestionId: number) =>
    request<{ success: boolean }>("DELETE", `/audios/${audioId}/suggestions/${suggestionId}`),
};

// ─── Alerts ───────────────────────────────────────────────────────────────────

export type AlertCategory = 'coded_language' | 'dangerous_word';

export interface AlertRecord {
  id: number;
  type: 'low' | 'medium' | 'high';
  category: AlertCategory | null;
  message: string;
  createdAt: string;
  speakerName: string | null;
  audioName: string | null;
  audioId: number | null;
  segmentId: number | null;
  subScores: SubScores | null;
  llmExplanation: string | null;
}

export const alerts = {
  list: (params?: { category?: AlertCategory }) => {
    const qs = params?.category ? `?category=${encodeURIComponent(params.category)}` : '';
    return request<AlertRecord[]>("GET", withUser(`/alerts${qs}`));
  },
  listForAudio: (audioId: number) => request<AlertRecord[]>("GET", `/audios/${audioId}/alerts`),
};

// ─── Dangerous Words ──────────────────────────────────────────────────────────

export interface DangerousWordRecord {
  id: number;
  word: string;
  severity: 'low' | 'medium' | 'high';
  createdAt: string;
}

export const dangerousWords = {
  list: () => request<DangerousWordRecord[]>("GET", "/dangerous-words"),
  add: (word: string, severity: string) =>
    request<DangerousWordRecord>("POST", "/dangerous-words", { word, severity }),
  remove: (id: number) => request<{ success: boolean }>("DELETE", `/dangerous-words/${id}`),
};

// ─── Euphemisms (coded-language dictionary) ───────────────────────────────────

export interface EuphemismRecord {
  id: number;
  phrase: string;
  severity: 'low' | 'medium' | 'high';
  isEuphemism: boolean;
  autoLearned: boolean;
  confidence: number | null;
  createdAt: string;
}

export interface EuphemismExpandSummary {
  added: number;
  candidates_considered: number;
  samples: EuphemismRecord[];
  note?: string;
}

export const euphemisms = {
  list: () => request<EuphemismRecord[]>("GET", "/euphemisms"),
  add: (phrase: string, severity: 'low' | 'medium' | 'high' = 'high') =>
    request<EuphemismRecord>("POST", "/euphemisms", { phrase, severity }),
  remove: (id: number) => request<{ success: boolean }>("DELETE", `/euphemisms/${id}`),
  expand: () => request<EuphemismExpandSummary>("POST", "/euphemisms/expand"),
};

// ─── System Stats ─────────────────────────────────────────────────────────────

export interface SystemStats {
  totalUsers: number;
  totalFiles: number;
  storageUsedBytes: number;
  dbStatus: boolean;
  uptime: string;
}

export const stats = {
  get: () => request<SystemStats>("GET", "/stats"),
};

// ─── Relations ────────────────────────────────────────────────────────────────

export interface RelationRecord {
  id: number;
  speakerA: { id: number; name: string; color: string };
  speakerB: { id: number; name: string; color: string };
  interactionCount: number;
  topic: string;
  lastContact: string;
}

export const relations = {
  list: () => request<RelationRecord[]>("GET", "/relations"),
};

// ─── Groups ───────────────────────────────────────────────────────────────────

export interface GroupMember {
  id: number;
  name: string;
  color: string;
  imagePath?: string | null;
}

export interface GroupRecord {
  id: number;
  name: string;
  color: string;
  createdAt: string;
  parentGroupId: number | null;
  parentGroupName: string | null;
  description: string | null;
  members: GroupMember[];
}

export interface BridgesResult {
  groupA: GroupRecord;
  groupB: GroupRecord;
  bridges: SpeakerRecord[];
}

interface GroupBody {
  name: string;
  color: string;
  parentGroupId?: number | null;
  description?: string | null;
}

export const groups = {
  list: () => request<GroupRecord[]>("GET", "/groups"),
  create: (body: GroupBody) =>
    request<GroupRecord>("POST", "/groups", body),
  update: (id: number, body: GroupBody) =>
    request<GroupRecord>("PUT", `/groups/${id}`, body),
  remove: (id: number) => request<{ success: boolean }>("DELETE", `/groups/${id}`),
  addMember: (groupId: number, speakerId: number) =>
    request<GroupRecord>("POST", `/groups/${groupId}/members`, { speaker_id: speakerId }),
  addMembersBatch: (groupId: number, speakerIds: number[]) =>
    request<{ group: GroupRecord; added: number[]; skipped: number[] }>(
      "POST", `/groups/${groupId}/members/batch`, { speaker_ids: speakerIds },
    ),
  removeMember: (groupId: number, speakerId: number) =>
    request<GroupRecord>("DELETE", `/groups/${groupId}/members/${speakerId}`),
  bridges: (groupAId: number, groupBId: number) =>
    request<BridgesResult>("GET", `/groups/bridges?groupA=${groupAId}&groupB=${groupBId}`),
};

// ─── Projects ─────────────────────────────────────────────────────────────────

export interface ProjectSummary {
  id: number;
  name: string;
  color: string;
  description: string | null;
  createdAt: string;
  subgroupCount: number;
  memberCount: number;
  assignedAnalystCount: number;
}

export interface AnalystSummary {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
}

export interface SubgroupDetail extends GroupRecord {
  assignedAnalysts: AnalystSummary[];
}

export interface ProjectDetail extends GroupRecord {
  assignedAnalysts: AnalystSummary[];
  subgroups: SubgroupDetail[];
}

export const projects = {
  list: () => request<ProjectSummary[]>("GET", withUser("/projects")),
  get: (id: number) => request<ProjectDetail>("GET", withUser(`/projects/${id}`)),
};

// ─── Assignments ──────────────────────────────────────────────────────────────

export interface AssignmentRecord {
  id: number;
  analystUserId: number;
  analystUsername: string;
  analystFirstName: string;
  analystLastName: string;
  groupId: number;
  groupName: string;
  parentGroupId: number | null;
  parentGroupName: string | null;
  createdAt: string;
}

export const assignments = {
  forProject: (projectId: number) =>
    request<AssignmentRecord[]>("GET", `/assignments?project_id=${projectId}`),
  forUser: (userId: number) =>
    request<AssignmentRecord[]>("GET", `/assignments?user_id=${userId}`),
  add: (analystUserId: number, groupId: number) =>
    request<AssignmentRecord>("POST", "/assignments", { analystUserId, groupId }),
  remove: (id: number) =>
    request<{ success: boolean }>("DELETE", `/assignments/${id}`),
};

// ─── Users (analyst directory alias) ──────────────────────────────────────────
// UserDirectoryRecord is an alias kept for new callers; the existing `users`
// object further up handles listByRole / listAnalysts.
export type UserDirectoryRecord = UserRecord;

// ─── Semantic Search (Hadar) ──────────────────────────────────────────────────

export interface SearchResultItem {
  segmentId: number;
  audioId: number;
  audioName: string;
  recordedAt: string | null;
  speakerId: number | null;
  speakerName: string;
  speakerColor: string;
  text: string;
  startTime: number;
  endTime: number;
  score: number;
  exactMatch: boolean;
  relatedTerm: string | null;
}

export const search = {
  semantic: (
    q: string,
    params?: {
      audioId?: number;
      speakerId?: number;
      fromDate?: string;
      toDate?: string;
      top?: number;
    }
  ) => {
    const qs = new URLSearchParams({ q });
    if (params?.audioId != null) qs.set('audio_id', String(params.audioId));
    if (params?.speakerId != null) qs.set('speaker_id', String(params.speakerId));
    if (params?.fromDate) qs.set('from_date', params.fromDate);
    if (params?.toDate) qs.set('to_date', params.toDate);
    if (params?.top) qs.set('top', String(params.top));
    return request<{ results: SearchResultItem[] }>('GET', `/search/semantic?${qs.toString()}`);
  },

  reindex: () => request<{ indexed: number }>('POST', '/search/reindex'),
};

// ─── ML Service (stateless analysis) ──────────────────────────────────────────

export const ml = {
  analyze: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${ML_BASE}/analyze`, { method: "POST", body: form }).then(
      (r) => r.json()
    );
  },
};
