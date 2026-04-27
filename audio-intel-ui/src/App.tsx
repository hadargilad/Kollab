import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
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


// Define the User structure
interface User {
  id: number; 
  username: string;
  role: string;
  firstName: string;   
  lastName: string;    
  idNumber: string;    
  createdAt: string;  
  mustChangePassword: boolean;
}

export default function App() {
  // Store the authenticated user's data
  const [user, setUser] = useState<User | null>(null);

  const handleUpdate = (updatedData: any) => {
    if (user) {
      setUser({
        ...user,
        ...updatedData
      });
    }
  };

  useEffect(() => {
    // Communication bridge with C# Backend
    (window as any).dispatchWebMessage = (message: any) => {
      console.log('Received from Backend:', message);

      if (message.type === 'LOGIN_SUCCESS') {
        setUser({
            ...message.payload, 
            username: message.username,
            role: message.role,
            mustChangePassword: message.forceChangePassword
        });
      }

      if (message.type === 'SELF_UPDATE_SUCCESS') {
        handleUpdate(message.payload);
        window.dispatchEvent(new CustomEvent('profileUpdated'));
      }

      if (message.type === 'ADMIN_STATS_DATA') {
        window.dispatchEvent(new CustomEvent('adminStatsReceived', { detail: message }));
      }
    };
  }, [user]); 

  const isAuthenticated = !!user;

  return (
    <Router>
      <Routes>
        {/* Login Route: If auth, go to dashboard */}
        <Route 
          path="/login" 
          element={
            isAuthenticated ? 
              <Navigate to="/dashboard" replace /> : 
              <Login onLogin={() => {}} /> 
          } 
        />
        
        {/* Root Redirect */}
        <Route
          path="/"
          element={
            isAuthenticated ? 
              <Navigate to="/dashboard" replace /> : 
              <Navigate to="/login" replace />
          }
        />

        {/* Protected Routes inside Layout */}
        <Route
          path="/*"
          element={
            isAuthenticated ? (
              user.mustChangePassword ? (
                <ForcePasswordChange user={user} onSuccess={() => setUser({...user, mustChangePassword: false})} />
              ) : (
                <Layout user={user} onLogout={() => setUser(null)} />
              )
            ) : (
              <Navigate to="/login" replace />
            )
          }
        >
          <Route path="dashboard" element={<Dashboard />} />
          {user?.role === 'Admin' && <Route path="user-management" element={<UserManagement currentUser={user} />} />}
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
          <Route path="profile" element={<Profile currentUser={user} onUpdateSuccess={handleUpdate} />} />
        </Route>
      </Routes>
    </Router>
  );
}