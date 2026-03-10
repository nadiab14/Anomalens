/**
 * AdminDashboard Component
 * 
 * Composant React affichant un tableau de bord d'administration utilisateur.
 * 
 * Fonctionnalités principales :
 * - Affichage d'une liste d'utilisateurs récupérée via une API sécurisée avec token.
 * - Ajout d'un nouvel utilisateur via un formulaire modal avec validation simple.
 * - Suppression d'un utilisateur avec mise à jour instantanée de la liste.
 * - Effets visuels animés en arrière-plan, représentant un réseau neuronal futuriste.
 * - Protection d'accès via le HOC withAuth, réservé au rôle "admin".
 * 
 * Hooks utilisés :
 * - useState : gestion des états locaux (utilisateurs, formulaire, modales, données de formulaire).
 * - useEffect : récupération initiale des utilisateurs au montage du composant.
 * - useAuthAxios : instance axios avec gestion automatique du token d'authentification.
 * 
 * Architecture visuelle :
 * - Styled-components pour styles modulaires et animations CSS (keyframes).
 * - ModalOverlay & ModalContent pour gestion des popups formulaires.
 * - Tableau utilisateur avec style et hover.
 * - Boutons d'action avec animations au survol.
 * - Réseau neuronal animé en arrière-plan avec nodes et connexions dynamiques.
 * 
 * Points d’amélioration possibles :
 * - Ajout d’une confirmation avant suppression.
 * - Gestion d’erreurs et feedback utilisateur plus riches (notifications toast, spinner).
 * - Pagination / recherche dans la liste des utilisateurs.
 * - Activation et intégration complète du modal réinitialisation mot de passe.
 * 
 * Exemples d’API utilisées :
 * - GET /api/users : récupère la liste des utilisateurs.
 * - POST /api/users/addUser : création d’un utilisateur (envoie mail d’activation).
 * - DELETE /api/users/:id : suppression d’un utilisateur.
 * 
 * 
 */


import React, { useState, useEffect } from 'react'; 
import styled, { keyframes } from 'styled-components';
// import axios from 'axios';
import withAuth from '../utils/withauth';
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

// Main Container
const PageWrapper = styled.div`
  min-height: 100vh;
  background: #0a0812;
  font-family: 'Inter', sans-serif;
  position: relative;
  overflow: hidden;
  padding: 2rem;
`;

// Auth Container
const AuthContainer = styled.div`
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
  background: rgba(20, 15, 35, 0.9);
  border-radius: 16px;
  box-shadow: 
    0 0 0 2px rgba(138, 43, 226, 0.5),
    0 10px 30px rgba(138, 43, 226, 0.3);
  z-index: 10;
  position: relative;
  overflow: hidden;
  border: 1px solid #8a2be2;
  
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

const UserTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  margin-top: 2rem;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 0 25px rgba(138, 43, 226, 0.15);
  background: rgba(30, 25, 45, 0.8);
`;

const TableHead = styled.thead`
  background: linear-gradient(90deg, rgba(74, 20, 140, 0.8), rgba(138, 43, 226, 0.8));
`;

const TableHeader = styled.th`
  color: #ffffff;
  padding: 1rem;
  text-align: left;
  font-weight: 600;
  letter-spacing: 0.5px;
  
  &:first-child {
    width: 1%;  // Force minimal width
    white-space: nowrap;
  }
`;

const TableRow = styled.tr`
  background: ${({ index }) => 
    index % 2 === 0 ? 'rgba(138, 43, 226, 0.1)' : 'rgba(30, 25, 45, 0.8)'};
  transition: all 0.3s ease;
  
  &:hover {
    background: rgba(138, 43, 226, 0.2);
  }
`;

const TableCell = styled.td`
  padding: 1rem;
  border-bottom: 1px solid rgba(138, 43, 226, 0.2);
  color: #e0d6ff;
  font-weight: 500;
  
  &:first-child {
    width: 1%;  // Force minimal width
    white-space: nowrap;
  }
`;

const ActionButton = styled.button`
  margin-right: 0.5rem;
  padding: 8px 12px;
  background: transparent;
  border: none;
  font-size: 1.3rem;
  cursor: pointer;
  transition: transform 0.2s ease-in-out;
  color: #e0d6ff;

  &:hover {
    transform: scale(1.2) rotate(5deg);
    color: #ffffff;
  }
`;

const CreativeCreateButton = styled.button`
  display: block;
  margin: 0 auto 2rem;
  padding: 0.7rem 2rem;
  background: linear-gradient(135deg, #8a2be2, #4a148c);
  color: white;
  font-size: 1.5rem;
  font-weight: 600;
  border: none;
  border-radius: 40px;
  cursor: pointer;
  box-shadow: 0 8px 20px rgba(138, 43, 226, 0.4);
  transition: all 0.3s ease-in-out;
  position: relative;
  overflow: hidden;

  &:hover {
    background: linear-gradient(135deg, #4a148c, #8a2be2);
    transform: scale(1.1) rotate(-1deg);
    box-shadow: 0 10px 25px rgba(138, 43, 226, 0.6);
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

const Title = styled.h1`
  text-align: center;
  color: #ffffff;
  font-size: 3rem;
  margin-bottom: 1rem;
  text-shadow: 0 0 10px rgba(138, 43, 226, 0.5);
`;

const Section = styled.section`
  margin-top: 3rem;
`;

const SectionTitle = styled.h2`
  margin-bottom: 1rem;
  color: #8a2be2;
  font-size: 2rem;
  text-shadow: 0 0 5px rgba(138, 43, 226, 0.3);
`;

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
`;

const ModalContent = styled.div`
  background: rgba(30, 25, 45, 0.95);
  padding: 2rem;
  border-radius: 12px;
  max-width: 400px;
  width: 100%;
  box-shadow: 0 0 30px rgba(138, 43, 226, 0.5);
  border: 1px solid #8a2be2;
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

const WhiteModalContent = styled(ModalContent)`
  background: white;
  color: #4a148c;
`;

const FormGroup = styled.div`
  margin-bottom: 16px;
`;

const Label = styled.label`
  display: block;
  margin-bottom: 0.5rem;
  color: #e0d6ff;
  font-weight: 600;
  font-size: 0.95rem;
`;

const WhiteLabel = styled(Label)`
  color: #4a148c;
`;

const Input = styled.input`
  width: 100%;
  padding: 0.8rem 1rem;
  background: rgba(138, 43, 226, 0.1);
  border: 1px solid rgba(138, 43, 226, 0.5);
  border-radius: 8px;
  font-size: 1rem;
  color: #ffffff;
  transition: all 0.3s;

  &:focus {
    outline: none;
    border-color: #8a2be2;
    box-shadow: 0 0 0 3px rgba(138, 43, 226, 0.3);
    background: rgba(138, 43, 226, 0.2);
  }
  
  &::placeholder {
    color: rgba(224, 214, 255, 0.5);
  }
`;

const WhiteInput = styled(Input)`
  background: white;
  color: #4a148c;
  border: 1.5px solid #8a2be2;
  
  &:focus {
    background: white;
    box-shadow: 0 0 0 3px rgba(138, 43, 226, 0.2);
  }
  
  &::placeholder {
    color: rgba(74, 20, 140, 0.5);
  }
`;

const SubmitButton = styled.button`
  margin-top: 1rem;
  width: 100%;
  padding: 0.8rem 0;
  background: linear-gradient(135deg, #8a2be2, #4a148c);
  color: white;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(138, 43, 226, 0.3);
  transition: all 0.3s ease-in-out;

  &:hover {
    background: linear-gradient(135deg, #4a148c, #8a2be2);
    transform: scale(1.02);
    box-shadow: 0 8px 25px rgba(138, 43, 226, 0.4);
  }
`;

const LightSubmitButton = styled(SubmitButton)`
  background: linear-gradient(135deg, #8a2be2, #4a148c);
  color: white;
  
  &:hover {
    background: linear-gradient(135deg, #4a148c, #8a2be2);
  }
`;

const CancelButton = styled.button`
  margin-top: 0.8rem;
  width: 100%;
  padding: 0.8rem 0;
  background: #f0e6ff;
  color: #4a148c;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s ease-in-out;

  &:hover {
    background: #e0d6ff;
    transform: scale(1.02);
  }
`;

const Avatar = styled.div`
  width: 35px;
  height: 35px;
  background-color: #8a2be2;
  color: white;
  font-weight: bold;
  font-size: 1rem;
  border-radius: 50%;
  display: inline-flex;
  justify-content: center;
  align-items: center;
  margin-right: 10px;
  vertical-align: middle;
`;

const UserNameWrapper = styled.div`
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
`;

const AdminDashboard = () => {
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetUserId] = useState(null);
  const [resetData, setResetData] = useState({ email: '', newPassword: '' });
  const axiosInstance = useAuthAxios();

  useEffect(() => {
    axiosInstance.get('http://localhost:5001/api/users')
      .then((res) => setUsers(res.data))
      .catch((err) => console.error(err));
  }, []);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleAddUserClick = () => {
    setShowForm(true);
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      const res = await axiosInstance.post('http://localhost:5001/api/users/addUser', formData);
      alert('User created successfully! Activation email sent.');
      setUsers([...users, res.data.user]);
      setFormData({ name: '', email: '', password: '' });
      setShowForm(false);
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || 'Error creating user');
    }
  };

  const handleDeleteUser = async (id) => {
    try {
      await axiosInstance.delete(`http://localhost:5001/api/users/${id}`);
      setUsers(users.filter((u) => u._id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await axiosInstance.post(`http://localhost:5001/api/users/${resetUserId}/reset-password`, resetData);
      alert(`🔒 ${res.data.message}`);
      setShowResetModal(false);
      setResetData({ email: '', newPassword: '' });
    } catch (err) {
      console.error(err);
      alert(`❌ Échec de la réinitialisation du mot de passe pour l'utilisateur ${resetUserId}`);
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
    <PageWrapper>
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
        
        <Title>🚀 Admin Dashboard</Title>

        <CreativeCreateButton onClick={handleAddUserClick}>➕ Add User</CreativeCreateButton>

        <Section>
          <SectionTitle>👤 Utilisateurs</SectionTitle>
          <UserTable>
            <TableHead>
              <tr>
                <TableHeader>ID</TableHeader>
                <TableHeader>Nom</TableHeader>
                <TableHeader>Email</TableHeader>
                <TableHeader>Statut</TableHeader>
                <TableHeader>Actions</TableHeader>
              </tr>
            </TableHead>
            <tbody>
              {users.map((user, index) => (
                <TableRow key={user._id} index={index}>
                  <TableCell>{user._id}</TableCell>
                  <TableCell>
                    <UserNameWrapper>
                      <Avatar>{user.name?.charAt(0).toUpperCase()}</Avatar>
                      {user.name}
                    </UserNameWrapper>
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    {user.isActive ? '🟢 Actif' : '🔴 Inactif'}
                  </TableCell>
                  <TableCell>
                    <ActionButton onClick={() => handleDeleteUser(user._id)}>🗑️</ActionButton>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </UserTable>
        </Section>
      </AuthContainer>

      {showForm && (
        <ModalOverlay>
          <WhiteModalContent>
            <form onSubmit={handleCreateUser}>
              <FormGroup>
                <WhiteLabel htmlFor="name">Nom</WhiteLabel>
                <WhiteInput
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="Enter the username"
                  required
                />
              </FormGroup>
              <FormGroup>
                <WhiteLabel htmlFor="email">Email</WhiteLabel>
                <WhiteInput
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="Enter the user email"
                  required
                />
              </FormGroup>
              <FormGroup>
                <WhiteLabel htmlFor="password">Mot de passe</WhiteLabel>
                <WhiteInput
                  type="password"
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder="Enter the password"
                  required
                />
              </FormGroup>
              <LightSubmitButton type="submit">Créer</LightSubmitButton>
              <CancelButton
                type="button"
                onClick={() => setShowForm(false)}
              >
                Annuler
              </CancelButton>
            </form>
          </WhiteModalContent>
        </ModalOverlay>
      )}

      {showResetModal && (
        <ModalOverlay>
          <ModalContent>
            <form onSubmit={handleResetSubmit}>
              <FormGroup>
                <Label>Email</Label>
                <Input 
                  type="email" 
                  value={resetData.email} 
                  onChange={(e) => setResetData({ ...resetData, email: e.target.value })} 
                  required 
                />
              </FormGroup>
              <FormGroup>
                <Label>New Password</Label>
                <Input 
                  type="password" 
                  value={resetData.newPassword} 
                  onChange={(e) => setResetData({ ...resetData, newPassword: e.target.value })} 
                  required 
                />
              </FormGroup>
              <SubmitButton type="submit">Réinitialiser</SubmitButton>
              <SubmitButton 
                type="button" 
                onClick={() => setShowResetModal(false)} 
                style={{ 
                  background: 'rgba(138, 43, 226, 0.2)', 
                  color: '#e0d6ff',
                  marginTop: '10px' 
                }}
              >
                Annuler
              </SubmitButton>
            </form>
          </ModalContent>
        </ModalOverlay>
      )}
    </PageWrapper>
  );
};

export default withAuth(AdminDashboard, ["admin"]);  
                    
