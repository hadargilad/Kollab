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

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  return (
    <Router>
      <Routes>
        <Route 
          path="/login" 
          element={
            isAuthenticated ? 
              <Navigate to="/dashboard" replace /> : 
              <Login onLogin={() => setIsAuthenticated(true)} />
          } 
        />
        <Route
          path="/"
          element={
            isAuthenticated ? 
              <Navigate to="/dashboard" replace /> : 
              <Navigate to="/login" replace />
          }
        />
        <Route
          path="/*"
          element={
            isAuthenticated ? 
              <Layout onLogout={() => setIsAuthenticated(false)} /> : 
              <Navigate to="/login" replace />
          }
        >
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="upload" element={<AudioUpload />} />
          <Route path="all-uploads" element={<AllUploads />} />
          <Route path="analysis/:id" element={<AudioAnalysis />} />
          <Route path="waveform/:id" element={<WaveformAnalysis />} />
          <Route path="transcript/:id" element={<TranscriptView />} />
          <Route path="speaker/:id" element={<SpeakerProfile />} />
          <Route path="network" element={<NetworkGraph />} />
          <Route path="identity" element={<IdentityMatching />} />
          <Route path="settings" element={<Settings />} />
          <Route path="profile-search" element={<ProfileSearch />} />
        </Route>
      </Routes>
    </Router>
  );
}