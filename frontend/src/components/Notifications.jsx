
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiBell, FiUser, FiLogOut, FiSave, FiSliders, FiAlertCircle, FiChevronDown, FiChevronUp, FiX, FiCheck } from 'react-icons/fi';
import logo from './logo.png';
import { useNavigate } from 'react-router-dom';
import useAuthAxios from '../utils/axiostoken';

const PY_BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';

const Notifications = ({ notifications = [], onParamsChange }) => {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);
  const [expanded, setExpanded] = useState(true);
  const navigate = useNavigate();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const axiosInstance = useAuthAxios();

  const [params, setParams] = useState({
    clip_length: '16',
    top_k: '4',
    stride: '1'
  });

  const [errors, setErrors] = useState({
    clip_length: '',
    top_k: '',
    stride: ''
  });

  const [isEditing, setIsEditing] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [runtimeInfo, setRuntimeInfo] = useState(null);
  const [loadingRuntime, setLoadingRuntime] = useState(false);

  const validateParams = () => {
    const newErrors = {
      clip_length: '',
      top_k: '',
      stride: ''
    };

    let isValid = true;

    if (!['8', '16', '32', '64', '128'].includes(params.clip_length)) {
      newErrors.clip_length = 'Must be 8, 16, 32, 64, or 128';
      isValid = false;
    }

    if (isNaN(params.top_k) || parseInt(params.top_k, 10) > 5 || parseInt(params.top_k, 10) < 1) {
      newErrors.top_k = 'Must be a number between 1 and 5';
      isValid = false;
    }

    if (isNaN(params.stride) || parseInt(params.stride, 10) > 5 || parseInt(params.stride, 10) < 1) {
      newErrors.stride = 'Must be a number between 1 and 5';
      isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setParams((prev) => ({ ...prev, [name]: value }));
    
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const handleSave = async() => {
    console.log("🔄 Attempting to save:", params);
    setSaveError('');
    if (validateParams()) {
      try {
        console.log("Sending params:", {
          clip_length: params.clip_length,
          top_k: params.top_k,
          stride: params.stride
        }); 
        
        const response = await axiosInstance.post(`${PY_BACKEND_URL}/api/clip_params`, {
          clip_length: params.clip_length,
          top_k: params.top_k,
          stride: params.stride
        }, {
          headers: {
            'Content-Type': 'application/json'
          }
        });

        setIsEditing(false);
        setSaveSuccess(true);
        setTimeout(() => {
          setSaveSuccess(false);
        }, 2000);

        if (response?.data?.runtime) {
          setRuntimeInfo(response.data.runtime);
        }

        console.log("Parameters saved:", params);
        if (onParamsChange) {
          onParamsChange({
            clip_length: parseInt(params.clip_length, 10),
            top_k: parseInt(params.top_k, 10),
            stride: parseInt(params.stride, 10)
          });
        }
      } catch (err) {
        const msg =
          err?.response?.data?.message ||
          err?.message ||
          'Impossible de sauvegarder les paramètres.';
        setSaveError(msg);
      }
    }
  };

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = () => {
    console.log("User logged out");
    localStorage.removeItem('authToken');
    delete axiosInstance.defaults.headers.common['Authorization'];
    navigate('/login');
    setShowLogoutConfirm(false);
  };

  const cancelLogout = () => {
    setShowLogoutConfirm(false);
  };

  const handleUserClick = () => {
    navigate('/change-password');
  };

  const abnormalClips = notifications.filter(c => c.score >= 0.65);
  const hasAnomaly = abnormalClips.length > 0;
  const scores = abnormalClips.map(c => c.score.toFixed(2)).join(', ');

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (onParamsChange) {
      onParamsChange({
        clip_length: parseInt(params.clip_length, 10),
        top_k: parseInt(params.top_k, 10),
        stride: parseInt(params.stride, 10)
      });
    }
  }, [onParamsChange, params.clip_length, params.top_k, params.stride]);

  useEffect(() => {
    let isMounted = true;
    const loadRuntimeAndParams = async () => {
      setLoadingRuntime(true);
      try {
        const response = await axiosInstance.get(`${PY_BACKEND_URL}/api/clip_params`);
        const data = response?.data || {};
        const current = data.data || {};
        if (isMounted && current) {
          setParams((prev) => ({
            ...prev,
            clip_length: String(current.clip_length ?? prev.clip_length),
            top_k: String(current.top_k ?? prev.top_k),
            stride: String(current.stride ?? prev.stride),
          }));
          if (data.runtime) setRuntimeInfo(data.runtime);
        }
      } catch (err) {
        if (!isMounted) return;
        const fallbackMsg = err?.response?.data?.message || err?.message || 'Runtime backend indisponible';
        setSaveError((prev) => prev || fallbackMsg);
        try {
          const runtimeRes = await axiosInstance.get(`${PY_BACKEND_URL}/api/runtime_status`);
          if (isMounted && runtimeRes?.data) setRuntimeInfo(runtimeRes.data);
        } catch {
          // ignore secondary failure
        }
      } finally {
        if (isMounted) setLoadingRuntime(false);
      }
    };

    loadRuntimeAndParams();
    return () => {
      isMounted = false;
    };
  }, []);

  const getPlaceholder = (field) => {
    switch(field) {
      case 'clip_length':
        return isEditing ? 'Default: 16' : '';
      case 'top_k':
        return isEditing ? 'Default: 4' : '';
      case 'stride':
        return isEditing ? 'Default: 1' : '';
      default:
        return '';
    }
  };

  const parameterDescriptions = {
    clip_length: 'Number of frames in each video clip',
    top_k: 'Number of top representative clips',
    stride: 'Frame sampling rate for processing'
  };

  return (
    <motion.div
      style={{
        position: 'relative',
        top: 0,
        right: 0,
        height: '100vh',
        width: '250px',
        backgroundColor: '#f8f9fa',
        padding: '24px',
        boxShadow: '-2px 0 15px rgba(0, 0, 0, 0.1)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid #e0e0e0',
        overflow: 'visible'
      }}
    >
      {/* Logout Confirmation Modal */}
      <AnimatePresence>
        {showLogoutConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2000
            }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: -20 }}
              style={{
                backgroundColor: '#fff',
                borderRadius: '16px',
                padding: '24px',
                maxWidth: '400px',
                width: '90%',
                boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
                border: '1px solid #e9d8fd'
              }}
            >
              <h3 style={{ 
                marginTop: 0,
                color: '#4b0082',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <FiAlertCircle size={24} />
                Confirm Logout
              </h3>
              <p style={{ marginBottom: '24px', color: '#555' }}>
                Are you sure you want to logout from the application?
              </p>
              <div style={{ 
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '12px'
              }}>
                <motion.button
                  onClick={cancelLogout}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  style={{
                    padding: '10px 16px',
                    backgroundColor: '#f5f5f5',
                    color: '#333',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <FiX /> Cancel
                </motion.button>
                <motion.button
                  onClick={confirmLogout}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  style={{
                    padding: '10px 16px',
                    backgroundColor: '#4b0082',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <FiCheck /> Yes, Logout
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Buttons */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-around',
          padding: '10px 0',
          marginBottom: '20px',
          backgroundColor: '#f8f9fa'
        }}
      >
        {/* Bell */}
        <motion.div style={{ position: 'relative' }} ref={dropdownRef}>
          <motion.button
            onClick={() => setOpen(!open)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            style={{
              cursor: 'pointer',
              fontSize: '20px',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              backgroundColor: '#f0f0f0',
              color: '#4b0082',
              borderRadius: '8px'
            }}
          >
            <FiBell />
            {hasAnomaly && (
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  width: '10px',
                  height: '10px',
                  backgroundColor: 'red',
                  borderRadius: '50%',
                  boxShadow: '0 0 3px rgba(0,0,0,0.5)'
                }}
              />
            )}
          </motion.button>

          {/* Notification Message */}
          {open && hasAnomaly && (
             <motion.div
    initial={{ opacity: 0, y: -10 }}
    animate={{ opacity: 1, y: 0 }}
    style={{
      position: 'fixed', // Changé de 'absolute' à 'fixed'
      top: '60px', // Ajusté pour être en dessous de la barre d'en-tête
      right: '280px', // Positionné à gauche de la sidebar
      width: '280px',
      backgroundColor: '#f3e8ff',
      color: '#4b0082',
      padding: '16px',
      borderRadius: '12px',
      border: '1px solid #d6bbfb',
      fontSize: '14px',
      fontWeight: '500',
      lineHeight: '1.4',
      boxShadow: '0 4px 10px rgba(0,0,0,0.1)',
      zIndex: 2000, // Doit être plus élevé que le z-index de la fenêtre de chat
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }}
  >
              ⚠️ <strong>{abnormalClips.length} anomaly clips detected</strong><br />
              Scores: {scores}<br />
              <em>Be careful, something is happening.</em>
            </motion.div>
          )}
        </motion.div>

        {/* User Button */}
        <motion.button
          onClick={handleUserClick}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          style={{
            cursor: 'pointer',
            fontSize: '20px',
            width: '36px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            backgroundColor: '#f0f0f0',
            color: '#4b0082',
            borderRadius: '8px'
          }}
        >
          <FiUser />
        </motion.button>

        {/* Logout Button */}
        <motion.button
          onClick={handleLogout}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          style={{
            cursor: 'pointer',
            fontSize: '20px',
            width: '36px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            backgroundColor: '#f0f0f0',
            color: '#4b0082',
            borderRadius: '8px'
          }}
        >
          <FiLogOut />
        </motion.button>
      </div>

      {/* Enhanced Parameter Section */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        style={{
          backgroundColor: '#fff',
          borderRadius: '16px',
          padding: '16px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          marginBottom: '20px',
          border: '1px solid #e9d8fd'
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
          color: '#4b0082'
        }}>
          <motion.div 
            style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
            onClick={() => setExpanded(!expanded)}
            whileHover={{ scale: 1.02 }}
          >
            <FiSliders />
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>Parameters</h3>
            {expanded ? <FiChevronUp /> : <FiChevronDown />}
          </motion.div>
          
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
              >
                {isEditing ? (
                  <motion.button
                    onClick={handleSave}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    style={{
                      background: '#4b0082',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '6px 12px',
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    <FiSave size={12} /> Save
                  </motion.button>
                ) : (
                  <motion.button
                    onClick={() => setIsEditing(true)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    style={{
                      background: 'transparent',
                      color: '#4b0082',
                      border: '1px solid #4b0082',
                      borderRadius: '6px',
                      padding: '6px 12px',
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    Edit
                  </motion.button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              style={{ overflow: 'hidden' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {Object.entries(params).map(([field, value]) => (
                  <motion.div 
                    key={field}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 * Object.keys(params).indexOf(field) }}
                    style={{ position: 'relative' }}
                  >
                    <label style={{
                      display: 'block',
                      marginBottom: '6px',
                      fontSize: '12px',
                      color: '#4b0082',
                      fontWeight: '500',
                      textTransform: 'capitalize'
                    }}>
                      {field.replace(/_/g, ' ')}
                      <span style={{
                        display: 'block',
                        fontSize: '10px',
                        color: '#888',
                        fontWeight: 'normal',
                        marginTop: '2px'
                      }}>
                        {parameterDescriptions[field]}
                      </span>
                    </label>
                    
                    <div style={{ position: 'relative' }}>
                      <input
                        name={field}
                        value={value}
                        onChange={handleInputChange}
                        disabled={!isEditing}
                        placeholder={getPlaceholder(field)}
                        style={{
                          width: '100%',
                          padding: '12px',
                          fontSize: '14px',
                          borderRadius: '8px',
                          border: `${errors[field] ? '#ff4d4f' : (isEditing ? '#b794f4' : '#ddd')} 1px solid`,
                          backgroundColor: isEditing ? '#f9f5ff' : '#f5f5f5',
                          color: '#333',
                          outline: 'none',
                          transition: 'all 0.3s',
                          boxShadow: isEditing ? '0 2px 8px rgba(75, 0, 130, 0.1)' : 'none'
                        }}
                      />
                      
                      {errors[field] && (
                        <motion.div 
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: '#ff4d4f',
                            fontSize: '11px',
                            marginTop: '4px'
                          }}
                        >
                          <FiAlertCircle size={12} />
                          <span>{errors[field]}</span>
                        </motion.div>
                      )}
                    </div>
                    
                    {field === 'clip_length' && isEditing && !errors.clip_length && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '6px',
                          marginTop: '8px'
                        }}
                      >
                        {[8, 16, 32, 64, 128].map(option => (
                          <motion.button
                            key={option}
                            type="button"
                            onClick={() => setParams(prev => ({ ...prev, clip_length: option.toString() }))}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            style={{
                              padding: '6px 10px',
                              fontSize: '12px',
                              borderRadius: '6px',
                              border: '1px solid #d9d9d9',
                              background: params.clip_length === option.toString() ? '#4b0082' : '#f0f0f0',
                              color: params.clip_length === option.toString() ? 'white' : '#333',
                              cursor: 'pointer',
                              transition: 'all 0.2s'
                            }}
                          >
                            {option}
                          </motion.button>
                        ))}
                      </motion.div>
                    )}
                  </motion.div>
                ))}
              </div>
              
              <AnimatePresence>
                {saveSuccess && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3 }}
                    style={{
                      marginTop: '16px',
                      padding: '10px',
                      backgroundColor: '#e6ffed',
                      color: '#237804',
                      borderRadius: '8px',
                      fontSize: '12px',
                      textAlign: 'center',
                      border: '1px solid #b7eb8f'
                    }}
                  >
                    Parameters saved successfully!
                  </motion.div>
                )}
              </AnimatePresence>
              <AnimatePresence>
                {!!saveError && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.25 }}
                    style={{
                      marginTop: '10px',
                      padding: '10px',
                      backgroundColor: '#fff1f2',
                      color: '#9f1239',
                      borderRadius: '8px',
                      fontSize: '12px',
                      textAlign: 'center',
                      border: '1px solid #fecdd3'
                    }}
                  >
                    {saveError}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        style={{
          backgroundColor: '#fff',
          borderRadius: '12px',
          padding: '12px',
          marginBottom: '14px',
          border: '1px solid #e5e7eb'
        }}
      >
        <div style={{ fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '6px' }}>
          Runtime backend
        </div>
        <div style={{ fontSize: '11px', color: '#6b7280', lineHeight: 1.45 }}>
          {loadingRuntime ? 'Chargement...' : (
            <>
              API key OpenRouter: {runtimeInfo?.openrouterApiKeyConfigured ? 'configurée' : 'absente'}<br />
              Caption provider: {runtimeInfo?.captionProvider || 'n/a'}<br />
              Caption model: {runtimeInfo?.captionModel || 'n/a'}
            </>
          )}
        </div>
        {runtimeInfo?.routes && (
          <div style={{ marginTop: '8px', fontSize: '10px', color: '#6b7280', lineHeight: 1.35 }}>
            Routes: {runtimeInfo.routes.upload}, {runtimeInfo.routes.streamResults}, {runtimeInfo.routes.chatLlm}
          </div>
        )}
      </motion.div>

      {/* Logo Section */}
      <motion.div
        style={{
          marginTop: 'auto',
          textAlign: 'center',
          padding: '0 12px',
          marginBottom: '20px'
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <img
          src={logo}
          alt="Anomalens Logo"
          style={{
            width: '100%',
            maxWidth: '300px',
            borderRadius: '50%',
            boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
          }}
        />
      </motion.div>
    </motion.div>
  );
};

export default Notifications;
