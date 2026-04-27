import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import AudioUpload from './components/AudioUpload';
import AudioAnalysis from './components/AudioAnalysis';
import TranscriptView from './components/TranscriptView';
import SpeakerProfile from './components/SpeakerProfile';
import NetworkGraph from './components/NetworkGraph';
import IdentityMatching from './components/IdentityMatching';
import Settings from './components/Settings';
import Layout from './components/Layout';
import WaveformAnalysis from './components/WaveformAnalysis';
import ProfileSearch from './components/ProfileSearch';
import AllUploads from './components/AllUploads';
import UserManagement from './components/UserManagement';
import ForcePasswordChange from './components/ForcePasswordChange';
import Profile from './components/Profile';
import StartupScreen from './components/StartupScreen';
import type { AuthUser } from './lib/api';

export default function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  if (!ready) return <StartupScreen onReady={() => setReady(true)} />;

  const handleUpdate = (updatedData: Partial<AuthUser>) => {
    if (user) setUser({ ...user, ...updatedData });
  };

  const isAuthenticated = !!user;

  return (
    <Router>
      <Routes>
        <Route
          path="/login"
          element={
            isAuthenticated
              ? <Navigate to="/dashboard" replace />
              : <Login onLogin={setUser} />
          }
        />

        <Route
          path="/"
          element={
            isAuthenticated
              ? <Navigate to="/dashboard" replace />
              : <Navigate to="/login" replace />
          }
        />

        <Route
          path="/*"
          element={
            isAuthenticated ? (
              user.mustChangePassword ? (
                <ForcePasswordChange
                  user={user}
                  onSuccess={() => setUser({ ...user, mustChangePassword: false })}
                />
              ) : (
                <Layout user={user} onLogout={() => setUser(null)} />
              )
            ) : (
              <Navigate to="/login" replace />
            )
          }
        >
          <Route path="dashboard" element={<Dashboard />} />
          {user?.role === 'Admin' && (
            <Route path="user-management" element={<UserManagement currentUser={user} />} />
          )}
          <Route path="upload" element={<AudioUpload userId={user?.id ?? 0} />} />
          <Route path="all-uploads" element={<AllUploads />} />
          <Route path="analysis/:id" element={<AudioAnalysis />} />
          <Route path="waveform/:id" element={<WaveformAnalysis />} />
          <Route path="transcript/:id" element={<TranscriptView />} />
          <Route path="speaker/:id" element={<SpeakerProfile />} />
          <Route path="network" element={<NetworkGraph />} />
          <Route path="identity" element={<IdentityMatching />} />
          <Route path="settings" element={<Settings />} />
          <Route path="profile-search" element={<ProfileSearch />} />
          <Route path="profile" element={<Profile currentUser={user} onUpdateSuccess={handleUpdate} />} />
        </Route>
      </Routes>
    </Router>
  );
}
