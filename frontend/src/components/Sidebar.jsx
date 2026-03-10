import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FiSearch,
  FiX,
  FiChevronLeft,
  FiChevronRight,
  FiAlertTriangle,
  FiClock,
  FiVideo,
  FiChevronDown,
  FiChevronUp,
  FiInfo,
  FiSettings,
  FiCopy,
  FiTrash2
} from 'react-icons/fi';

import { useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import useAuthAxios from '../utils/axiostoken';

const CLIP_REVIEW_STORAGE_KEY = 'anomalens_clip_review_v1';

const readReviewMap = () => {
  try {
    const raw = window.localStorage.getItem(CLIP_REVIEW_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeReviewMap = (value) => {
  try {
    window.localStorage.setItem(CLIP_REVIEW_STORAGE_KEY, JSON.stringify(value || {}));
  } catch {
    // ignore
  }
};

const reviewKeyForEvent = (event) =>
  String(event?.videoClipId || event?.clipId || event?._id || 'event');

const Sidebar = ({ onSelectEvent }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedEventId, setExpandedEventId] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [copiedEventId, setCopiedEventId] = useState(null);
  const [isClearing, setIsClearing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [objectFilter, setObjectFilter] = useState('all');
  const [scoreThreshold, setScoreThreshold] = useState(0);
  const [reviewStatusMap, setReviewStatusMap] = useState(() => readReviewMap());
  const navigate = useNavigate();
  const axiosInstance = useAuthAxios();

  const fetchData = async () => {
    try {
      const eventsRes = await axiosInstance.get('/api/historique');
      const sortedEvents = eventsRes.data.sort((a, b) =>
        new Date(b.timestamp) - new Date(a.timestamp)
      );
      setEvents(sortedEvents);

      try {
        const token = localStorage.getItem("authToken");
        const decoded = jwtDecode(token);
        setUserRole(decoded.role);
      } catch (roleErr) {
        console.error('Error fetching role:', roleErr);
        setUserRole(null);
      }

      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch data:', err);
      setError('Failed to load data. Please try again later.');
      setLoading(false);
    }
  };
	
  // Fetch events from API and user role
  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const onFocus = () => setReviewStatusMap(readReviewMap());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Highlight matching text in all event content
  const highlightMatches = (text) => {
    if (!searchTerm) return text;
    
    const regex = new RegExp(`(${searchTerm})`, 'gi');
    return text.split(regex).map((part, i) => 
      regex.test(part) ? <strong key={i} style={{ color: '#4b0082' }}>{part}</strong> : part
    );
  };

  // Filter events based on search term across all fields
  const filteredEvents = events.filter(event => {
    if (!searchTerm) return true;
    
    const searchLower = searchTerm.toLowerCase();
    return (
      event.eventName.toLowerCase().includes(searchLower) ||
      event.videoName.toLowerCase().includes(searchLower) ||
      (event.description && event.description.toLowerCase().includes(searchLower)) ||
      (event.caption && event.caption.toLowerCase().includes(searchLower)) ||
      (event.clipId && event.clipId.toLowerCase().includes(searchLower)) ||
      (event.videoClipId && event.videoClipId.toLowerCase().includes(searchLower))
    );
  }).filter((event) => {
    const score = Number(event?.score || 0);
    if (Number.isFinite(score) && score < scoreThreshold) return false;

    const currentStatus = reviewStatusMap[reviewKeyForEvent(event)] || 'en_revue';
    if (statusFilter !== 'all' && currentStatus !== statusFilter) return false;

    if (objectFilter !== 'all') {
      const classes = event?.objectDetectionSummary?.classes || event?.object_detection_summary?.classes || {};
      if (!Object.prototype.hasOwnProperty.call(classes, objectFilter)) return false;
    }
    return true;
  });

  const objectFilterOptions = Array.from(new Set(
    events.flatMap((event) => Object.keys(event?.objectDetectionSummary?.classes || event?.object_detection_summary?.classes || {}))
  )).sort((a, b) => a.localeCompare(b));

  const groupedEvents = filteredEvents.reduce((acc, event) => {
    const key = event.videoName || 'Unknown video';
    if (!acc[key]) acc[key] = [];
    acc[key].push(event);
    return acc;
  }, {});

  const handleEventClick = (eventId) => {
    setExpandedEventId(expandedEventId === eventId ? null : eventId);
    const selectedEvent = events.find(e => e._id === eventId);
    if (onSelectEvent) onSelectEvent(selectedEvent);
  };

  const handleSearchChange = (e) => setSearchTerm(e.target.value);
  
  const toggleSearch = () => {
    if (isCollapsed) {
      setIsCollapsed(false);
      setTimeout(() => setIsSearchActive(true), 300);
    } else {
      setIsSearchActive(!isSearchActive);
      if (isSearchActive) setSearchTerm('');
    }
  };

  const toggleSidebar = () => setIsCollapsed(!isCollapsed);
  const handleAdminSettings = () => {
    navigate('/admin');
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const formatClipTime = (sec) => {
    if (typeof sec !== 'number' || Number.isNaN(sec)) return 'n/a';
    const mins = Math.floor(sec / 60);
    const secs = sec - mins * 60;
    return `${String(mins).padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`;
  };

  const buildPromptForEvent = (event) => {
    const frameCaptions = Array.isArray(event.frameCaptions) ? event.frameCaptions.slice(0, 4) : [];
    const frameUrls = Array.isArray(event.frameUrls) ? event.frameUrls.slice(0, 3) : [];
    const captionLines = frameCaptions.map(
      (fc) => `- t=${Number(fc?.timestampSec || 0).toFixed(2)}s | caption=${fc?.caption || 'n/a'}`
    );
    const frameUrlLines = frameUrls.map((u) => `- ${u}`);

    return [
      `videoName: ${event.videoName || 'n/a'}`,
      `eventName: ${event.eventName || 'n/a'}`,
      `classification: ${event.classification || 'n/a'}`,
      `videoClipId: ${event.videoClipId || 'n/a'}`,
      `clipId: ${event.clipId || 'n/a'}`,
      `clipTimestampSec: ${Number(event.clipTimestampSec || 0).toFixed(2)}`,
      `score: ${Number(event.score || 0).toFixed(4)}`,
      `caption: ${event.caption || 'n/a'}`,
      `description: ${event.description || 'n/a'}`,
      `startFrame: ${event.startFrame ?? 'n/a'}, endFrame: ${event.endFrame ?? 'n/a'}, centerFrame: ${event.centerFrame ?? 'n/a'}`,
      'frameCaptions:',
      ...(captionLines.length ? captionLines : ['- n/a']),
      'frameUrls:',
      ...(frameUrlLines.length ? frameUrlLines : ['- n/a']),
      'Task: Analyse ce clip et dis si la scène est normale ou suspecte, avec justification courte.',
    ].join('\n');
  };

  const handleCopyPrompt = async (event, e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(buildPromptForEvent(event));
      setCopiedEventId(event._id);
      setTimeout(() => setCopiedEventId(null), 1500);
    } catch (err) {
      console.error('Clipboard copy failed', err);
    }
  };

  const handleClearHistory = async () => {
    const ok = window.confirm('Delete all history events? This action cannot be undone.');
    if (!ok) return;

    try {
      setIsClearing(true);
      await axiosInstance.delete('/api/historique');
      setExpandedEventId(null);
      setCopiedEventId(null);
      await fetchData();
    } catch (err) {
      console.error('Failed to clear history:', err);
      setError('Failed to clear history.');
    } finally {
      setIsClearing(false);
    }
  };

  const getReviewStatus = (event) => reviewStatusMap[reviewKeyForEvent(event)] || 'en_revue';

  const setEventReviewStatus = (event, status, e) => {
    if (e) e.stopPropagation();
    setReviewStatusMap((prev) => {
      const next = { ...(prev || {}), [reviewKeyForEvent(event)]: status };
      writeReviewMap(next);
      return next;
    });
  };

  const getSeverityColor = (score) => {
    if (score > 0.7) return '#ff4757';
    if (score > 0.6) return '#ffa502';
    return '#2ed573';
  };

  const renderEventCard = (event) => {
    const reviewStatus = getReviewStatus(event);
    const objectClasses =
      event?.objectDetectionSummary?.classes || event?.object_detection_summary?.classes || {};
    const objectSummary = Object.entries(objectClasses);

    return (
      <div key={event._id} style={{ borderRadius: '8px', overflow: 'hidden', marginBottom: '8px' }}>
        <motion.div
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          onClick={() => handleEventClick(event._id)}
          style={{
            backgroundColor: '#fff',
            padding: '12px',
            cursor: 'pointer',
            boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
            borderLeft: `4px solid ${getSeverityColor(event.score)}`,
            transition: 'all 0.2s ease',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '5px',
            }}
          >
            <FiAlertTriangle color={getSeverityColor(event.score)} size={18} />
            <div style={{ fontWeight: 'bold', flex: 1, color: '#333' }}>
              {highlightMatches(event.eventName)}
            </div>
            <div
              style={{
                fontSize: '0.7em',
                color: '#666',
                backgroundColor: '#f1f3f5',
                borderRadius: '10px',
                padding: '2px 8px',
                whiteSpace: 'nowrap',
              }}
            >
              clip t={formatClipTime(event.clipTimestampSec)}
            </div>
            <div style={{ fontSize: '0.75em', color: '#666', whiteSpace: 'nowrap' }}>
              {formatTimestamp(event.timestamp)}
            </div>
            <div
              style={{
                fontSize: '0.7em',
                borderRadius: '999px',
                padding: '2px 7px',
                backgroundColor:
                  reviewStatus === 'true_positive'
                    ? '#ecfdf5'
                    : reviewStatus === 'false_positive'
                    ? '#fef2f2'
                    : '#f3f4f6',
                color:
                  reviewStatus === 'true_positive'
                    ? '#166534'
                    : reviewStatus === 'false_positive'
                    ? '#991b1b'
                    : '#4b5563',
                whiteSpace: 'nowrap',
              }}
            >
              {reviewStatus}
            </div>
            {expandedEventId === event._id ? (
              <FiChevronUp size={16} color="#666" />
            ) : (
              <FiChevronDown size={16} color="#666" />
            )}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '5px',
            }}
          >
            <FiVideo size={14} color="#666" />
            <div
              style={{
                fontSize: '0.8em',
                color: '#555',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              clip: {highlightMatches(event.videoClipId || event.clipId || 'n/a')}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: getSeverityColor(event.score),
                }}
              />
              <div style={{ fontSize: '0.75em', color: '#666' }}>
                Score: {(event.score * 100).toFixed(0)}%
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <FiClock size={14} color="#666" />
              <div style={{ fontSize: '0.75em', color: '#666' }}>
                {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>

          {objectSummary.length > 0 && (
            <div
              style={{
                marginTop: '6px',
                fontSize: '0.72em',
                color: '#4b5563',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              objets: {objectSummary.map(([k, v]) => `${k}:${v}`).join(', ')}
            </div>
          )}
        </motion.div>

        <AnimatePresence>
          {expandedEventId === event._id && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{
                overflow: 'hidden',
                backgroundColor: '#f0f2f5',
                borderLeft: `4px solid ${getSeverityColor(event.score)}`,
                padding: '0 12px',
              }}
            >
              <div
                style={{
                  padding: '12px',
                  fontSize: '0.85em',
                  color: '#555',
                  lineHeight: '1.5',
                  borderTop: '1px solid #e0e0e0',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '8px',
                  }}
                >
                  <FiInfo size={16} color={getSeverityColor(event.score)} />
                  <strong>Detailed Description:</strong>
                </div>
                {highlightMatches(event.description || 'No description available')}

                <div style={{ marginTop: '10px' }}>
                  <strong>Caption:</strong> {highlightMatches(event.caption || 'n/a')}
                </div>

                <div style={{ marginTop: '8px' }}>
                  <strong>Frames:</strong> {event.startFrame ?? 'n/a'} → {event.endFrame ?? 'n/a'} (center: {event.centerFrame ?? 'n/a'})
                </div>

                <div style={{ marginTop: '8px' }}>
                  <strong>Frame Captions:</strong>
                  <div style={{ marginTop: '4px', fontFamily: 'monospace', fontSize: '0.9em' }}>
                    {(event.frameCaptions || []).slice(0, 3).map((fc, idx) => (
                      <div key={idx}>
                        - t={Number(fc?.timestampSec || 0).toFixed(2)}s: {fc?.caption || 'n/a'}
                      </div>
                    ))}
                    {(!event.frameCaptions || event.frameCaptions.length === 0) && <div>- n/a</div>}
                  </div>
                </div>

                <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
                  <select
                    value={reviewStatus}
                    onChange={(e) => setEventReviewStatus(event, e.target.value, e)}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      border: '1px solid #d0d7e2',
                      backgroundColor: '#fff',
                      borderRadius: '8px',
                      padding: '6px 10px',
                      cursor: 'pointer',
                      fontSize: '0.85em',
                    }}
                  >
                    <option value="en_revue">En revue</option>
                    <option value="true_positive">Vrai positif</option>
                    <option value="false_positive">Faux positif</option>
                  </select>
                  <button
                    onClick={(e) => handleCopyPrompt(event, e)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      border: '1px solid #d0d7e2',
                      backgroundColor: '#fff',
                      borderRadius: '8px',
                      padding: '6px 10px',
                      cursor: 'pointer',
                      fontSize: '0.85em',
                    }}
                  >
                    <FiCopy size={14} />
                    {copiedEventId === event._id ? 'Copied' : 'Copy LLM Prompt'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <motion.div
      className="sidebar"
      initial={{ width: 300 }}
      animate={{ width: isCollapsed ? 80 : 300 }}
      transition={{ duration: 0.3 }}
      style={{
        height: '100vh',
        backgroundColor: '#f8f9fa',
        borderRight: '1px solid #e0e0e0',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 12px',
        overflow: 'hidden',
        boxSizing: 'border-box',
        position: 'relative',
      }}
    >
      {/* Top Controls */}
      <div
        style={{
          display: 'flex',
          flexDirection: isCollapsed ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'space-between',
          marginBottom: '20px',
          gap: '12px',
        }}
      >
        {/* Collapse Button */}
        <motion.button
          onClick={toggleSidebar}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="icon"
          style={{
            cursor: 'pointer',
            fontSize: '20px',
            transition: 'transform 0.2s ease',
            width: '36px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            backgroundColor: '#f0f0f0',
            color: '#4b0082',
          }}
        >
          {isCollapsed ? <FiChevronRight /> : <FiChevronLeft />}
        </motion.button>

        {/* Search Component */}
        {!isCollapsed && (
          <div>
            <AnimatePresence mode="wait" initial={false}>
              {isSearchActive ? (
                <motion.div
                  key="searchInput"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 160, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  layout
                  style={{ overflow: 'hidden', position: 'relative' }}
                >
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={handleSearchChange}
                    placeholder="abnormal events..."
                    autoFocus
                    style={{
                      padding: '8px 30px 8px 15px',
                      borderRadius: '20px',
                      border: '1px solid #ddd',
                      width: '100%',
                      outline: 'none',
                      fontSize: '14px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    }}
                  />
                  <button
                    onClick={toggleSearch}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '4px',
                    }}
                  >
                    <FiX size={16} />
                  </button>
                </motion.div>
              ) : (
                <motion.button
                  key="searchIcon"
                  onClick={toggleSearch}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="icon"
                  style={{
                    cursor: 'pointer',
                    fontSize: '20px',
                    transition: 'transform 0.2s ease',
                    width: '36px',
                    height: '36px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    backgroundColor: '#f0f0f0',
                    color: '#4b0082',
                  }}
                >
                  <FiSearch />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Admin Dashboard Settings Button */}
        {!isCollapsed && userRole === 'admin' && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <motion.button
              onClick={handleClearHistory}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="icon"
              title="Clear history"
              disabled={isClearing}
              style={{
                cursor: isClearing ? 'not-allowed' : 'pointer',
                fontSize: '20px',
                transition: 'transform 0.2s ease',
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                backgroundColor: '#f0f0f0',
                color: '#c62828',
                opacity: isClearing ? 0.6 : 1,
              }}
            >
              <FiTrash2 />
            </motion.button>
            <motion.button
              onClick={handleAdminSettings}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="icon"
              style={{
                cursor: 'pointer',
                fontSize: '20px',
                transition: 'transform 0.2s ease',
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                backgroundColor: '#f0f0f0',
                color: '#4b0082',
              }}
            >
              <FiSettings />
            </motion.button>
          </div>
        )}
      </div>

      {!isCollapsed && (
        <div
          style={{
            marginBottom: '12px',
            backgroundColor: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '10px',
            padding: '10px',
            display: 'grid',
            gap: '8px'
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#374151' }}>
            Filtres incidents
          </div>
          <label style={{ fontSize: '11px', color: '#4b5563', display: 'grid', gap: '4px' }}>
            Statut
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ border: '1px solid #d1d5db', borderRadius: '6px', padding: '6px 8px', background: '#fff' }}
            >
              <option value="all">Tous</option>
              <option value="en_revue">En revue</option>
              <option value="true_positive">Vrai positif</option>
              <option value="false_positive">Faux positif</option>
            </select>
          </label>
          <label style={{ fontSize: '11px', color: '#4b5563', display: 'grid', gap: '4px' }}>
            Objet détecté
            <select
              value={objectFilter}
              onChange={(e) => setObjectFilter(e.target.value)}
              style={{ border: '1px solid #d1d5db', borderRadius: '6px', padding: '6px 8px', background: '#fff' }}
            >
              <option value="all">Tous</option>
              {objectFilterOptions.map((label) => (
                <option key={label} value={label}>{label}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: '11px', color: '#4b5563', display: 'grid', gap: '4px' }}>
            Score min: {(scoreThreshold * 100).toFixed(0)}%
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={scoreThreshold}
              onChange={(e) => setScoreThreshold(Number(e.target.value))}
            />
          </label>
        </div>
      )}

      {/* Events List */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            key="eventsList"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ 
              flex: 1, 
              overflowY: 'auto', 
              padding: '0 8px',
              scrollbarWidth: 'thin',
            }}
          >
            {loading ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '20px',
                color: '#666'
              }}>
                <div className="spinner" style={{ marginBottom: '10px' }}>🌀</div>
                Loading events...
              </div>
            ) : error ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '20px', 
                color: '#ff4757',
                backgroundColor: '#ffecec',
                borderRadius: '8px',
                margin: '10px'
              }}>
                {error}
                <button 
                  onClick={() => window.location.reload()}
                  style={{
                    marginTop: '10px',
                    padding: '5px 10px',
                    backgroundColor: '#ff4757',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Retry
                </button>
              </div>
            ) : filteredEvents.length === 0 ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '20px', 
                color: '#666',
                fontStyle: 'italic'
              }}>
                {searchTerm ? 'No matching events found' : 'No abnormal events detected yet'}
              </div>
            ) : (
              <div style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                gap: '10px',
                paddingBottom: '10px'
              }}>
                {Object.entries(groupedEvents).map(([videoName, videoEvents]) => (
                  <div key={videoName} style={{ borderRadius: '8px', overflow: 'hidden' }}>
                    <div style={{
                      fontSize: '0.8em',
                      fontWeight: 700,
                      color: '#263238',
                      backgroundColor: '#e9eef8',
                      border: '1px solid #d6deef',
                      borderRadius: '8px',
                      padding: '8px 10px',
                      marginBottom: '8px'
                    }}>
                      {highlightMatches(videoName)} ({videoEvents.length})
                    </div>
                    {videoEvents.map(renderEventCard)}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Logo Section */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            key="logo"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              textAlign: 'center',
              marginTop: 'auto',
              marginBottom: '20px',
              padding: '0 12px',
            }}
          >
            <div style={{ 
              marginTop: '10px',
              fontSize: '0.8em',
              color: '#666'
            }}>
              {events.length} {events.length === 1 ? 'event' : 'events'} detected
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default Sidebar;
