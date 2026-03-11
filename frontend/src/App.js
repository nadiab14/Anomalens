import './App.css';
import ChatPage from './ChatPage';
import VideoProcessingPage from './VideoProcessingPage';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import SignIn from './components/SignIn';
import AdminDashboard from './components/AdminDashboard';
import ResetPassword from './components/ResetPassword';
import ChangePassword from './components/ChangePassword';
import withAuth from './utils/withauth';

const AdminDashboardProtected = withAuth(AdminDashboard, ['admin']);

function UnauthorizedPage() {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      Accès non autorisé
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<SignIn />} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />
        <Route path="/admin" element={<AdminDashboardProtected />} />
        <Route path="/reset-password/:token" element={<ResetPassword />} />
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/dashboard" element={<VideoProcessingPage />} />
        <Route path="/analysis" element={<VideoProcessingPage />} />
        <Route path="/processing" element={<Navigate to="/analysis" replace />} />
        <Route path="/video-processing" element={<Navigate to="/processing" replace />} />
        <Route path="/chatpage" element={<ChatPage />} />
      </Routes>
    </Router>
  );
}

export default App;
