

/**
 * app.js – Serveur Express principal avec connexion MongoDB
 * 
 * Ce fichier initialise le serveur Express, configure les middlewares,
 * connecte à MongoDB avec Mongoose, et lie les routes pour utilisateurs et historique.
 */


const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const userRoutes = require('./routes/userRoutes');
const historiqueRoutes = require('./routes/historiqueRoutes'); // Fixed case sensitivity

const app = express();
app.use(cors());
app.use(express.json());

// Enhanced MongoDB connection
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .then(() => {
    console.log('MongoDB connected successfully');
    
    // Verify Historique collection exists or create it
    const db = mongoose.connection.db;
    db.listCollections({name: 'historiques'}).next((err, collinfo) => {
      if (!collinfo) {
        console.log('Historique collection does not exist - it will be created on first insert');
      } else {
        console.log('Historique collection exists');
      }
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Connection events
mongoose.connection.on('connected', () => {
  console.log('Mongoose connected to DB');
});

mongoose.connection.on('error', (err) => {
  console.error('Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('Mongoose disconnected');
});

app.use('/api/users', userRoutes);
app.use('/api/historique', historiqueRoutes);
// app.use('/api/user/role', userRoutes)

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));