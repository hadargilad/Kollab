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
  recordingCount: number;
}

// ─── Audios ───────────────────────────────────────────────────────────────────

export const audios = {
  upload: (file: File, name: string, description: string, uploadedBy: number): Promise<UploadResult> => {
    const form = new FormData();
    form.append("file", file);
    form.append("name", name);
    form.append("description", description);
    form.append("uploaded_by", String(uploadedBy));
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

export const speakers = {
  list: () => request<SpeakerRecord[]>("GET", "/speakers"),
  get: (id: number) => request<SpeakerRecord>("GET", `/speakers/${id}`),
  update: (id: number, name: string, riskLevel: string) =>
    request<{ success: boolean }>("PUT", `/speakers/${id}`, { name, riskLevel }),
  reassign: (audioId: number, speakerId: number, newName: string) =>
    request<SpeakerRecord>("POST", `/audios/${audioId}/speakers/${speakerId}/reassign`, { new_name: newName }),
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

// ─── ML Service ───────────────────────────────────────────────────────────────

export const ml = {
  analyze: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${ML_BASE}/analyze`, { method: "POST", body: form }).then(
      (r) => r.json()
    );
  },

  listSpeakers: () => request<{ count: number; speakers: { name: string; sample_count: number }[] }>(
    "GET", "/speakers", undefined, ML_BASE
  ),

  addSpeaker: (name: string, file: File) => {
    const form = new FormData();
    form.append("name", name);
    form.append("file", file);
    return fetch(`${ML_BASE}/speakers/add`, { method: "POST", body: form }).then(
      (r) => r.json()
    );
  },

  renameSpeaker: (oldName: string, newName: string) =>
    request("PATCH", "/speakers/rename", { old_name: oldName, new_name: newName }, ML_BASE),

  deleteSpeaker: (name: string) =>
    request("DELETE", `/speakers/${encodeURIComponent(name)}`, undefined, ML_BASE),
};
