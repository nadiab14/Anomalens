/**
 * routes/historique.js – Routes CRUD pour la gestion de l'historique des événements
 *
 * Fournit :
 * - POST /api/historique   : Ajouter un nouvel événement détecté
 * - GET /api/historique    : Récupérer tous les événements, triés par date décroissante
 * - GET /api/historique/:id : Récupérer un événement unique par son ID MongoDB
 */

const express = require('express');
const router = express.Router();
const Historique = require('../models/Historique');



router.post('/', async (req, res) => {
  try {
    const { videoName, eventName, description, score, ...extra } = req.body || {};

    if (!videoName || !eventName || !description || typeof score !== 'number') {
      return res.status(400).json({
        status: 'error',
        message: 'Missing or invalid required fields: videoName, eventName, description, score'
      });
    }

    const newEvent = new Historique({
      videoName,
      eventName,
      description,
      score,
      ...extra
    });

    const savedEvent = await newEvent.save();
    
    // Return consistent response format
    res.status(201).json({
      status: 'success',
      data: savedEvent
    });
  } catch (err) {
    console.error('Error saving to historique:', err.message);
    res.status(500).json({
      status: 'error',
      message: 'Server Error'
    });
  }
});

// Get all events
router.get('/', async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 0;
    const videoName = typeof req.query.videoName === 'string' ? req.query.videoName.trim() : '';

    const filter = {};
    if (videoName) {
        filter.videoName = videoName;
    }

    let query = Historique.find(filter).sort({ timestamp: -1 });
    if (limit > 0) {
        query = query.limit(limit);
    }

    const events = await query;
    res.json(events);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Delete events (all or by videoName)
router.delete('/', async (req, res) => {
  try {
    const videoName = typeof req.query.videoName === 'string' ? req.query.videoName.trim() : '';
    const filter = videoName ? { videoName } : {};
    const result = await Historique.deleteMany(filter);

    return res.json({
      status: 'success',
      deletedCount: result.deletedCount || 0,
      scope: videoName ? `video:${videoName}` : 'all'
    });
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({
      status: 'error',
      message: 'Server Error'
    });
  }
});

// Get single event
router.get('/:id', async (req, res) => {
  try {
    const event = await Historique.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ msg: 'Event not found' });
    }

    res.json(event);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
