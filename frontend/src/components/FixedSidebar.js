import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiBell, FiUser, FiSettings } from 'react-icons/fi';
/**
 * FixedSidebar - Composant React affichant une barre latérale fixe sur la droite de l'écran
 * 
 * Ce composant affiche :
 * - Une zone de navigation avec trois icônes (notifications, utilisateur, paramètres) animées.
 * - Un indicateur de nombre de notifications.
 * - Un point rouge indiquant la présence d'anomalies dans les notifications.
 * - Une liste scrollable des notifications récentes, avec mise en forme conditionnelle selon le score d'anomalie.
 * 
 * Props :
 * - notifications : tableau d'objets notification, chaque notification doit contenir au moins :
 *   - id : identifiant unique
 *   - score : score d'anomalie (nombre entre 0 et 1)
 *   - preview (optionnel) : image base64 en aperçu du clip associé
 */
const FixedSidebar = ({ notifications = [] }) => {
  const hasAnomaly = notifications.some(n => n.score >= 0.5);
  const notificationCount = notifications.length;

  return (
    <motion.div
      initial={{ x: 300 }}
      animate={{ x: 0 }}
      exit={{ x: 300 }}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        height: '100vh',
        width: '250px',
        backgroundColor: '#f8f9fa',
        padding: '20px',
        boxShadow: '-2px 0 15px rgba(0, 0, 0, 0.1)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid #e0e0e0'
      }}
    >
      {/* Top Navigation Icons */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-around',
        padding: '10px 0',
        marginBottom: '20px',
        backgroundColor: '#f8f9fa'
      }}>
        {/* Notification Bell with Badges */}
        <motion.div style={{ position: 'relative' }}>
          <motion.button
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
              borderRadius: '8px',
              position: 'relative'
            }}
          >
            <FiBell />
            {/* Notification Count Badge */}
            {notificationCount > 0 && (
              <span style={{
                position: 'absolute',
                top: '-6px',
                right: '-6px',
                backgroundColor: 'red',
                color: 'white',
                borderRadius: '50%',
                padding: '2px 6px',
                fontSize: '10px',
                fontWeight: 'bold',
                lineHeight: 1,
                minWidth: '18px',
                textAlign: 'center'
              }}>
                {notificationCount}
              </span>
            )}
          </motion.button>
          
          {/* Anomaly Indicator Dot */}
          {hasAnomaly && (
            <span style={{
              position: 'absolute',
              top: '2px',
              right: '2px',
              width: '10px',
              height: '10px',
              backgroundColor: 'red',
              borderRadius: '50%',
              boxShadow: '0 0 3px rgba(0,0,0,0.5)',
              pointerEvents: 'none'
            }} />
          )}
        </motion.div>

        {/* User Profile Button */}
        <motion.button
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

        {/* Settings Button */}
        <motion.button
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
          <FiSettings />
        </motion.button>
      </div>

      {/* Notifications List */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '10px',
        backgroundColor: '#fff',
        borderRadius: '8px',
        position: 'relative'
      }}>
        <h4 style={{ margin: '0 0 15px 0', color: '#4b0082' }}>Recent Alerts</h4>
        
        <AnimatePresence>
          {notifications.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ color: '#666', fontStyle: 'italic', textAlign: 'center' }}
            >
              No anomalies detected
            </motion.div>
          ) : (
            notifications.map((notif) => (
              <motion.div
                key={notif.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                style={{
                  backgroundColor: notif.score >= 0.5 ? '#ffe6e6' : '#e6f9e6',
                  padding: '12px',
                  borderRadius: '8px',
                  marginBottom: '10px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  borderLeft: `4px solid ${notif.score >= 0.5 ? '#ff4444' : '#4CAF50'}`
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <strong style={{ color: '#4b0082' }}>Clip {notif.id}</strong>
                  <span style={{ 
                    color: notif.score >= 0.5 ? '#ff4444' : '#4CAF50',
                    fontWeight: 'bold'
                  }}>
                    {notif.score.toFixed(2)}
                  </span>
                </div>
                {notif.score >= 0.5 && (
                  <div style={{ 
                    color: '#ff4444',
                    fontSize: '0.85em',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    <span>⚠️</span>
                    <span>Potential anomaly detected</span>
                  </div>
                )}
                {notif.preview && (
                  <img 
                    src={`data:image/jpeg;base64,${notif.preview}`} 
                    alt={`Clip ${notif.id} preview`} 
                    style={{ 
                      width: '100%',
                      borderRadius: '6px',
                      marginTop: '8px',
                      border: `2px solid ${notif.score >= 0.5 ? '#ff4444' : '#4CAF50'}`
                    }}
                  />
                )}
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

export default FixedSidebar;