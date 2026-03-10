import { useState } from 'react';
import { Search, User, Phone, Mail, MapPin, Calendar, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Profile {
  id: string;
  name: string;
  phone: string;
  email: string;
  location: string;
  lastActive: string;
  conversationCount: number;
  riskLevel: 'high' | 'medium' | 'low';
}

const mockProfiles: Profile[] = [
  {
    id: 'spk-001',
    name: 'David Cohen',
    phone: '+972-54-123-4567',
    email: 'david.c@email.com',
    location: 'Tel Aviv, Israel',
    lastActive: '2026-01-18 14:30',
    conversationCount: 47,
    riskLevel: 'high'
  },
  {
    id: 'spk-002',
    name: 'Sarah Miller',
    phone: '+1-555-234-5678',
    email: 'sarah.m@email.com',
    location: 'New York, USA',
    lastActive: '2026-01-17 09:15',
    conversationCount: 23,
    riskLevel: 'medium'
  },
  {
    id: 'spk-003',
    name: 'Michael Brown',
    phone: '+44-20-7123-4567',
    email: 'michael.b@email.com',
    location: 'London, UK',
    lastActive: '2026-01-16 18:45',
    conversationCount: 35,
    riskLevel: 'low'
  },
  {
    id: 'spk-004',
    name: 'Rachel Levy',
    phone: '+972-52-987-6543',
    email: 'rachel.l@email.com',
    location: 'Jerusalem, Israel',
    lastActive: '2026-01-18 11:20',
    conversationCount: 62,
    riskLevel: 'high'
  },
  {
    id: 'spk-005',
    name: 'Daniel Smith',
    phone: '+1-555-876-5432',
    email: 'daniel.s@email.com',
    location: 'Washington DC, USA',
    lastActive: '2026-01-15 16:00',
    conversationCount: 18,
    riskLevel: 'medium'
  },
  {
    id: 'spk-006',
    name: 'Maya Anderson',
    phone: '+46-70-123-4567',
    email: 'maya.a@email.com',
    location: 'Stockholm, Sweden',
    lastActive: '2026-01-14 13:30',
    conversationCount: 41,
    riskLevel: 'low'
  },
  {
    id: 'spk-007',
    name: 'Alex Martinez',
    phone: '+34-91-234-5678',
    email: 'alex.m@email.com',
    location: 'Madrid, Spain',
    lastActive: '2026-01-18 10:00',
    conversationCount: 29,
    riskLevel: 'medium'
  },
  {
    id: 'spk-008',
    name: 'Yael Cohen',
    phone: '+972-50-555-1234',
    email: 'yael.c@email.com',
    location: 'Haifa, Israel',
    lastActive: '2026-01-17 15:45',
    conversationCount: 55,
    riskLevel: 'high'
  }
];

export default function ProfileSearch() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredProfiles, setFilteredProfiles] = useState<Profile[]>(mockProfiles);
  const navigate = useNavigate();

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    
    if (query.trim() === '') {
      setFilteredProfiles(mockProfiles);
    } else {
      const filtered = mockProfiles.filter(profile =>
        profile.name.toLowerCase().includes(query.toLowerCase()) ||
        profile.phone.includes(query) ||
        profile.email.toLowerCase().includes(query.toLowerCase()) ||
        profile.location.toLowerCase().includes(query.toLowerCase())
      );
      setFilteredProfiles(filtered);
    }
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'high':
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'medium':
        return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      case 'low':
        return 'bg-green-500/10 text-green-400 border-green-500/20';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-white text-3xl mb-2">Profile Search</h1>
          <p className="text-slate-400">Search and find speaker profiles by name, phone, email, or location</p>
        </div>

        {/* Search Bar */}
        <div className="mb-8">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, phone, email, or location..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-12 pr-4 py-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Results Count */}
        <div className="mb-4 text-slate-400">
          Found {filteredProfiles.length} profile{filteredProfiles.length !== 1 ? 's' : ''}
        </div>

        {/* Results Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredProfiles.map((profile) => (
            <div
              key={profile.id}
              className="bg-slate-900 border border-slate-800 rounded-lg p-6 hover:border-blue-500/50 transition-all cursor-pointer group"
              onClick={() => navigate(`/speaker/${profile.id}`)}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className="bg-blue-600/20 p-3 rounded-full">
                    <User className="w-6 h-6 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-white text-lg">{profile.name}</h3>
                    <div className={`inline-flex items-center px-2 py-1 rounded border text-xs mt-1 ${getRiskColor(profile.riskLevel)}`}>
                      {profile.riskLevel.toUpperCase()} RISK
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-slate-600 group-hover:text-blue-400 transition-colors" />
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="w-4 h-4 text-slate-500" />
                  <span className="text-slate-300">{profile.phone}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="w-4 h-4 text-slate-500" />
                  <span className="text-slate-300">{profile.email}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="w-4 h-4 text-slate-500" />
                  <span className="text-slate-300">{profile.location}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-4 h-4 text-slate-500" />
                  <span className="text-slate-300">{profile.lastActive}</span>
                </div>
              </div>

              {/* Stats */}
              <div className="mt-4 pt-4 border-t border-slate-800">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Conversations</span>
                  <span className="text-white">{profile.conversationCount}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* No Results */}
        {filteredProfiles.length === 0 && (
          <div className="text-center py-16">
            <div className="bg-slate-900 border border-slate-800 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
              <Search className="w-10 h-10 text-slate-600" />
            </div>
            <h3 className="text-white text-xl mb-2">No profiles found</h3>
            <p className="text-slate-400">Try adjusting your search query</p>
          </div>
        )}
      </div>
    </div>
  );
}
