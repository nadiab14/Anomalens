/**
 * ChangePassword Component
 * 
 * Composant React permettant à un utilisateur connecté de changer son mot de passe.
 * 
 * Fonctionnalités principales :
 * - Formulaire sécurisé avec trois champs : mot de passe actuel, nouveau mot de passe, confirmation du nouveau mot de passe.
 * - Validation frontend des champs obligatoires, correspondance des mots de passe, et différence entre ancien et nouveau mot de passe.
 * - Affichage dynamique des messages d’erreur ou de succès selon le résultat de la requête.
 * - Appel API POST sécurisé vers `/api/users/change-password` pour effectuer le changement côté serveur.
 * - Redirection vers la page "/chatpage" après succès.
 * 
 * Hooks utilisés :
 * - useState : gestion des valeurs des champs de formulaire et du message d’état.
 * - useNavigate : navigation programmatique vers une autre route après succès.
 * - useAuthAxios : instance axios configurée avec token d’authentification.
 * 
 * Styles et animations :
 * - Styled-components avec animations CSS pour un rendu moderne et immersif.
 * - Arrière-plan animé représentant un réseau neuronal futuriste avec des noeuds et connexions animés.
 * - Bouton d’envoi avec effets visuels au survol et au clic.
 * - Messages stylisés en vert pour succès et rouge pour erreur.
 * 
 * Points d’amélioration possibles :
 * - Ajouter un indicateur de chargement pendant l’appel API.
 * - Limiter la longueur et la complexité du nouveau mot de passe côté frontend.
 * - Proposer un système de visibilité / masquage des mots de passe.
 * - Gérer plus finement les erreurs réseau et serveur.
 * 
 * Exemple d’API utilisée :
 * - POST /api/users/change-password
 *   Payload : { currentPassword, newPassword }
 *   Réponse : succès ou erreur
 * 
 */

import React, { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { useNavigate } from 'react-router-dom';
import useAuthAxios from '../utils/axiostoken';


// Animations
const neuralPulse = keyframes`
  0% { opacity: 0.3; transform: scale(0.95); }
  50% { opacity: 0.8; transform: scale(1.05); }
  100% { opacity: 0.3; transform: scale(0.95); }
`;

const nodeFloat = keyframes`
  0% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-15px) rotate(2deg); }
  100% { transform: translateY(0) rotate(0deg); }
`;

const scanBeam = keyframes`
  0% { transform: translateX(-100%) rotate(45deg); }
  100% { transform: translateX(100%) rotate(45deg); }
`;

const signInGlow = keyframes`
  0% { text-shadow: 0 0 5px rgba(138, 43, 226, 0.5); }
  50% { text-shadow: 0 0 15px rgba(138, 43, 226, 0.8); }
  100% { text-shadow: 0 0 5px rgba(138, 43, 226, 0.5); }
`;

// Main Container
const AISurveillanceAuth = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: #0a0812;
  font-family: 'Inter', sans-serif;
  position: relative;
  overflow: hidden;
`;

// Neural Network Background
const NeuralNetwork = styled.div`
  position: absolute;
  width: 100%;
  height: 100%;
  background: 
    radial-gradient(circle at 20% 30%, rgba(138, 43, 226, 0.05) 0%, transparent 30%),
    radial-gradient(circle at 80% 70%, rgba(138, 43, 226, 0.05) 0%, transparent 30%);
`;

// Neural Node
const NeuralNode = styled.div`
  position: absolute;
  width: ${props => props.size}px;
  height: ${props => props.size}px;
  background: radial-gradient(circle, rgba(138,43,226,0.3) 0%, rgba(138,43,226,0) 70%);
  border-radius: 50%;
  animation: ${nodeFloat} ${props => props.duration || '8s'} infinite ease-in-out;
  animation-delay: ${props => props.delay || '0s'};
`;

// Neural Connection
const NeuralConnection = styled.div`
  position: absolute;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(138,43,226,0.3), transparent);
  transform-origin: left center;
  z-index: 1;
`;

// Auth Container
const AuthContainer = styled.div`
  width: 420px;
  padding: 3rem;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 16px;
  box-shadow: 
    0 0 0 2px rgba(138, 43, 226, 0.5),
    0 10px 30px rgba(138, 43, 226, 0.3);
  z-index: 10;
  position: relative;
  overflow: hidden;
  
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 5px;
    background: linear-gradient(90deg, #8a2be2, #4a148c, #8a2be2);
    background-size: 200% 200%;
    animation: ${neuralPulse} 3s infinite;
  }
`;

// Scanner Beam
const ScannerBeam = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    to bottom right,
    transparent,
    transparent,
    rgba(138, 43, 226, 0.1),
    transparent,
    transparent
  );
  animation: ${scanBeam} 4s linear infinite;
  pointer-events: none;
`;

// Creative Title
const CreativeTitle = styled.div`
  position: relative;
  margin-bottom: 2.5rem;
  text-align: center;

  h2 {
    font-size: 2rem;
    color: #4a148c;
    margin: 0;
    font-weight: 800;
    position: relative;
    display: inline-block;
    animation: ${signInGlow} 3s infinite;
    
    &::before, &::after {
      content: '';
      position: absolute;
      top: 50%;
      width: 40px;
      height: 3px;
      background: linear-gradient(90deg, #8a2be2, transparent);
    }
    
    &::before {
      left: -50px;
    }
    
    &::after {
      right: -50px;
      background: linear-gradient(90deg, transparent, #8a2be2);
    }
  }

  span {
    display: block;
    font-size: 0.9rem;
    color: #8a2be2;
    font-weight: 500;
    margin-top: 10px;
    letter-spacing: 2px;
  }
`;

// AI Input
const AIInput = styled.div`
  margin-bottom: 1.5rem;
  position: relative;
  
  label {
    display: block;
    margin-bottom: 0.8rem;
    color: #4a148c;
    font-weight: 600;
    font-size: 0.9rem;
  }
  
  input {
    width: 100%;
    padding: 16px 20px;
    background: rgba(138, 43, 226, 0.05);
    border: 1px solid rgba(138, 43, 226, 0.3);
    border-radius: 10px;
    font-size: 16px;
    transition: all 0.3s;
    
    &:focus {
      outline: none;
      border-color: #8a2be2;
      box-shadow: 0 0 0 3px rgba(138, 43, 226, 0.2);
      background: white;
    }
    
    &::placeholder {
      color: rgba(138, 43, 226, 0.4);
    }
  }
`;

// Auth Button
const AuthButton = styled.button`
  width: 100%;
  padding: 16px;
  background: linear-gradient(135deg, #8a2be2, #4a148c);
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
  margin-top: 1rem;
  position: relative;
  overflow: hidden;
  
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 20px rgba(138, 43, 226, 0.4);
  }
  
  &:active {
    transform: translateY(0);
  }
  
  &::after {
    content: '';
    position: absolute;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    background: linear-gradient(
      to bottom right,
      transparent 45%,
      rgba(255, 255, 255, 0.3) 50%,
      transparent 55%
    );
    transform: rotate(30deg);
    animation: shine 3s infinite;
  }
  
  @keyframes shine {
    0% { transform: translateX(-100%) rotate(30deg); }
    100% { transform: translateX(100%) rotate(30deg); }
  }
`;

// Message Styling
const Message = styled.div`
  padding: 15px;
  margin-bottom: 20px;
  border-radius: 8px;
  background: ${props => props.type === 'success' 
    ? 'rgba(40, 167, 69, 0.2)' 
    : 'rgba(220, 53, 69, 0.2)'};
  border: 1px solid ${props => props.type === 'success' ? '#28a745' : '#dc3545'};
  color: ${props => props.type === 'success' ? '#28a745' : '#dc3545'};
  text-align: center;
  font-size: 14px;
`;

// Generate neural network nodes and connections
const nodes = [
  { id: 1, size: 120, x: 10, y: 20, delay: '0s', duration: '10s' },
  { id: 2, size: 80, x: 80, y: 30, delay: '2s', duration: '12s' },
  { id: 3, size: 100, x: 30, y: 70, delay: '4s', duration: '14s' },
  { id: 4, size: 60, x: 70, y: 80, delay: '6s', duration: '16s' }
];

const connections = [
  { id: 1, x1: 10, y1: 20, x2: 30, y2: 70, width: 25 },
  { id: 2, x1: 30, y1: 70, x2: 70, y2: 80, width: 30 },
  { id: 3, x1: 70, y1: 80, x2: 80, y2: 30, width: 20 },
  { id: 4, x1: 80, y1: 30, x2: 10, y2: 20, width: 35 }
];

const ChangePassword = () => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState(null);
  const navigate =useNavigate();
  const axiosInstance = useAuthAxios();

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Clear previous messages
    setMessage(null);
    
    // Frontend validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      setMessage({ text: 'Tous les champs sont requis', type: 'error' });
      return;
    }
    
    if (newPassword !== confirmPassword) {
      setMessage({ text: 'Les mots de passe ne correspondent pas', type: 'error' });
      return;
    }
    
    if (currentPassword === newPassword) {
      setMessage({ text: 'Le nouveau mot de passe doit être différent', type: 'error' });
      return;
    }

    try {
      await axiosInstance.post('/api/users/change-password', {
        currentPassword,
        newPassword
      });
      
      setMessage({ text: 'Mot de passe changé avec succès!', type: 'success' });
      
      // Clear form
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      navigate("/processing");
      
    } catch (error) {
      console.error('Change password error:', error);
      
      if (error.response) {
        setMessage({ 
          text: error.response.data.error || 'Erreur lors du changement', 
          type: 'error' 
        });
      } else if (error.request) {
        setMessage({ 
          text: 'Erreur réseau. Veuillez réessayer.', 
          type: 'error' 
        });
      } else {
        setMessage({ 
          text: 'Une erreur inattendue est survenue', 
          type: 'error' 
        });
      }
    }
  };

  return (
    <AISurveillanceAuth>
      <NeuralNetwork />
      
      {/* Neural Network Elements */}
      {nodes.map(node => (
        <NeuralNode
          key={node.id}
          size={node.size}
          style={{
            top: `${node.y}%`,
            left: `${node.x}%`,
            animationDelay: node.delay,
            animationDuration: node.duration
          }}
        />
      ))}
      
      {connections.map(conn => {
        const length = Math.sqrt(Math.pow(conn.x2 - conn.x1, 2) + Math.pow(conn.y2 - conn.y1, 2));
        const angle = Math.atan2(conn.y2 - conn.y1, conn.x2 - conn.x1) * 180 / Math.PI;
        
        return (
          <NeuralConnection
            key={conn.id}
            style={{
              width: `${length}%`,
              top: `${conn.y1}%`,
              left: `${conn.x1}%`,
              transform: `rotate(${angle}deg)`
            }}
          />
        );
      })}
      
      <AuthContainer>
        <ScannerBeam />
        
        <CreativeTitle>
          <h2>CHANGER LE MOT DE PASSE</h2>
          <span>METTEZ À JOUR VOTRE MOT DE PASSE</span>
        </CreativeTitle>
        
        {message && (
          <Message type={message.type}>
            {message.text}
          </Message>
        )}

        <form onSubmit={handleSubmit}>
          <AIInput>
            <label>Mot de passe actuel</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Entrez votre mot de passe actuel"
              required
            />
          </AIInput>
          
          <AIInput>
            <label>Nouveau mot de passe</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Entrez votre nouveau mot de passe"
              required
            />
          </AIInput>
          
          <AIInput>
            <label>Confirmer le nouveau mot de passe</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirmez votre nouveau mot de passe"
              required
            />
          </AIInput>
          
          <AuthButton type="submit">
            Changer le mot de passe
          </AuthButton>
        </form>
      </AuthContainer>
    </AISurveillanceAuth>
  );
};

export default ChangePassword;
