import React, { useState, useEffect } from 'react';
import styled, { keyframes } from 'styled-components';
import { useNavigate, useSearchParams } from 'react-router-dom';

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

// AI Header
const AIHeader = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 0rem;
  position: relative;
  justify-content: center;
`;

// Creative Sign In Title
const CreativeSignIn = styled.div`
  position: relative;
  margin-bottom: 2.5rem;
  text-align: center;

  h2 {
    font-size: 2.5rem;
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
      width: 50px;
      height: 3px;
      background: linear-gradient(90deg, #8a2be2, transparent);
    }
    
    &::before {
      left: -60px;
    }
    
    &::after {
      right: -60px;
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
  margin-bottom: 2rem;
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

// Forgot Password Link
const ForgotPasswordLink = styled.a`
  display: block;
  text-align: center;  // Changé de 'right' à 'center'
  margin-top: 0.5rem;  // Réduit la marge négative
  margin-bottom: 1rem; // Ajusté pour un meilleur espacement
  color: #8a2be2;
  font-size: 0.9rem;
  text-decoration: none;
  cursor: pointer;
  transition: color 0.3s;

  &:hover {
    color: #4a148c;
    text-decoration: underline;
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

// Modal Styles (copied from AdminDashboard)
const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
`;

const ModalContent = styled.div`
  background: #fff;
  padding: 2rem;
  border-radius: 12px;
  max-width: 400px;
  width: 100%;
  box-shadow: 0 0 20px rgba(138, 43, 226, 0.3);
`;

const FormGroup = styled.div`
  margin-bottom: 16px;
`;

const Label = styled.label`
  display: block;
  margin-bottom: 0.3rem;
  color: #4a148c;
  font-weight: 600;
  font-size: 0.95rem;
`;

const Input = styled.input`
  width: 100%;
  padding: 0.8rem 1rem;
  border: 1.5px solid #8a2be2;
  border-radius: 6px;
  font-size: 1rem;
  color: #4a148c;
  transition: border-color 0.3s;
  margin-bottom: 0.5rem;

  &:focus {
    outline: none;
    border-color: #4a148c;
  }
`;

const SubmitButton = styled.button`
  margin-top: 0.8rem;
  width: 100%;
  padding: 0.8rem 0;
  background: linear-gradient(135deg, #8a2be2, #4a148c);
  color: white;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 40px;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(138, 43, 226, 0.25);
  transition: all 0.3s ease-in-out;

  &:hover {
    background: linear-gradient(135deg, #4a148c, #8a2be2);
    transform: scale(1.02);
  }
`;

const SignIn = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [searchParams] = useSearchParams();
  const [activationMessage, setActivationMessage] = useState(null);
  const [activationStatus, setActivationStatus] = useState(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetMessage, setResetMessage] = useState(null);
  const navigate = useNavigate();


  // Gestion des messages d'activation
  useEffect(() => {
    const status = searchParams.get('activation');
    if (status) {
      setActivationStatus(status);
      window.history.replaceState({}, '', window.location.pathname);
      console.log('Statut d\'activation:', status);
    }
  }, [searchParams]);
    
  if (activationStatus === 'success') {
    setActivationMessage({
      text: 'Votre compte a été activé avec succès! Vous pouvez maintenant vous connecter.',
      type: 'success'
    });
  } else if (activationStatus === 'invalid') {
    setActivationMessage({
      text: 'Lien d\'activation invalide ou expiré.',
      type: 'error'
    });
  } else if (activationStatus === 'error') {
    setActivationMessage({
      text: 'Erreur lors de l\'activation du compte. Veuillez réessayer.',
      type: 'error'
    });
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      const response = await fetch('http://localhost:5001/api/users/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      }); 

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Authentication failed');
      }

      localStorage.setItem('authToken', data.token);
      navigate('/processing'); // Redirect to video processing page
    } catch (error) {
      setActivationMessage({
        text: error.message || 'Échec de la connexion',
        type: 'error'
      });
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('http://localhost:5001/api/users/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: resetEmail }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to send reset email');
      }

      setResetMessage({
        text: data.message || 'Un email de réinitialisation a été envoyé',
        type: 'success'
      });
      setTimeout(() => {
        setShowResetModal(false);
        setResetMessage(null);
      }, 3000);
    } catch (error) {
      setResetMessage({
        text: error.message || 'Erreur lors de la demande de réinitialisation',
        type: 'error'
      });
    }
  };

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
        
        <CreativeSignIn>
          <h2>SIGN IN</h2>
          <span>READY TO DIVE INTO THE WORLD OF VIDEO SURVEILLANCE AND ANOMALY DETECTION ?</span>
        </CreativeSignIn>
        
        {activationMessage && (
          <div style={{
            padding: '15px',
            marginBottom: '20px',
            borderRadius: '8px',
            background: activationMessage.type === 'success' 
              ? 'rgba(40, 167, 69, 0.2)' 
              : 'rgba(220, 53, 69, 0.2)',
            border: `1px solid ${activationMessage.type === 'success' ? '#28a745' : '#dc3545'}`,
            color: activationMessage.type === 'success' ? '#28a745' : '#dc3545',
            textAlign: 'center',
            fontSize: '14px'
          }}>
            {activationMessage.text}
          </div>
        )}

        <AIHeader>
          {/* <AITitle>
            AnomaLens
            <span>Intelligent Anomalies Detector</span>
          </AITitle> */}
        </AIHeader>
        
        <form onSubmit={handleSubmit}>
          <AIInput>
            <label>Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your-email@gmail.com"
              required
            />
          </AIInput>
          
          <AIInput>
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
            <ForgotPasswordLink onClick={() => setShowResetModal(true)}>
              Mot de passe oublié ?
            </ForgotPasswordLink>
          </AIInput>
          
          <AuthButton type="submit">
            Authenticate
          </AuthButton>
        </form>
      </AuthContainer>

      {/* Reset Password Modal */}
      {showResetModal && (
        <ModalOverlay>
          <ModalContent>
            <h2 style={{ color: '#4a148c', textAlign: 'center', marginBottom: '1.5rem' }}>Réinitialiser le mot de passe</h2>
            
            {resetMessage && (
              <div style={{
                padding: '10px',
                marginBottom: '15px',
                borderRadius: '8px',
                background: resetMessage.type === 'success' 
                  ? 'rgba(40, 167, 69, 0.2)' 
                  : 'rgba(220, 53, 69, 0.2)',
                border: `1px solid ${resetMessage.type === 'success' ? '#28a745' : '#dc3545'}`,
                color: resetMessage.type === 'success' ? '#28a745' : '#dc3545',
                textAlign: 'center',
                fontSize: '14px'
              }}>
                {resetMessage.text}
              </div>
            )}
            
            <form onSubmit={handleResetPassword}>
              <FormGroup>
                <Label>Email</Label>
                <Input 
                  type="email" 
                  value={resetEmail} 
                  onChange={(e) => setResetEmail(e.target.value)} 
                  placeholder="Entrez votre email"
                  required 
                />
              </FormGroup>
              
              <SubmitButton type="submit">Envoyer le lien de réinitialisation</SubmitButton>
              
              <SubmitButton 
                type="button" 
                onClick={() => {
                  setShowResetModal(false);
                  setResetMessage(null);
                }} 
                style={{ 
                  background: '#ccc', 
                  marginTop: '10px',
                  color: '#333'
                }}
              >
                Annuler
              </SubmitButton>
            </form>
          </ModalContent>
        </ModalOverlay>
      )}
    </AISurveillanceAuth>
  );
};

export default SignIn;
