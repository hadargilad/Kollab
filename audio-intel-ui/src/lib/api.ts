const BASE = "http://127.0.0.1:8001";
const ML_BASE = "http://127.0.0.1:8000";

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

export interface SegmentRecord {
  id: number;
  speakerId: number;
  speakerName: string;
  speakerColor: string;
  text: string;
  startTime: number;
  endTime: number;
}

export interface SpeakerRecord {
  id: number;
  voiceIdentifier: string;
  name: string;
  color: string;
  riskLevel: 'low' | 'medium' | 'high';
  firstDetected: string;
  wikidataId: string | null;
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

  list: () => request<AudioRecord[]>("GET", "/audios"),
  get: (id: number) => request<AudioRecord>("GET", `/audios/${id}`),
  remove: (id: number) => request<{ success: boolean }>("DELETE", `/audios/${id}`),
  getSegments: (id: number) => request<SegmentRecord[]>("GET", `/audios/${id}/segments`),
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
  list: () => request<SpeakerRecord[]>("GET", "/speakers"),
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
};

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

export interface AlertRecord {
  id: number;
  type: 'low' | 'medium' | 'high';
  message: string;
  createdAt: string;
  speakerName: string | null;
  audioName: string | null;
}

export const alerts = {
  list: () => request<AlertRecord[]>("GET", "/alerts"),
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
