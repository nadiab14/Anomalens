/**
 * Historique.js – Modèle Mongoose pour l'historique des événements détectés
 *
 * Ce modèle représente un événement détecté dans une vidéo de surveillance.
 * Chaque document stocke :
 * - Le nom de la vidéo
 * - Le type d’événement détecté
 * - Une description textuelle générée
 * - Le score d’anomalie associé
 * - Un horodatage (timestamp)
 */
const mongoose = require('mongoose');

const HistoriqueSchema = new mongoose.Schema({
  videoName: {
    type: String,
    required: true

  },
  eventName: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  score: {
    type: Number,
    required: true
  },
  scoreSource: {
    type: String
  },
  scoreMeta: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  processedAt: {
    type: Date
  },
  clipId: {
    type: String
  },
  classification: {
    type: String
  },
  caption: {
    type: String
  },
  clipTimestampSec: {
    type: Number
  },
  segmentStartFrame: {
    type: Number
  },
  segmentEndFrame: {
    type: Number
  },
  segmentStartSec: {
    type: Number
  },
  segmentEndSec: {
    type: Number
  },
  startFrame: {
    type: Number
  },
  endFrame: {
    type: Number
  },
  centerFrame: {
    type: Number
  },
  fps: {
    type: Number
  },
  clipLength: {
    type: Number
  },
  stride: {
    type: Number
  },
  topK: {
    type: Number
  },
  videoDurationSec: {
    type: Number
  },
  videoTotalFrames: {
    type: Number
  },
  frameCountSaved: {
    type: Number
  },
  framePaths: {
    type: [String],
    default: []
  },
  frameUrls: {
    type: [String],
    default: []
  },
  frameBase64Samples: {
    type: [String],
    default: []
  },
  frameCaptions: {
    type: [
      new mongoose.Schema(
        {
          frameIndex: Number,
          globalFrameIndex: Number,
          timestampSec: Number,
          caption: String
        },
        { _id: false }
      )
    ],
    default: []
  },
  objectDetections: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  boundingBoxes: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  objectDetectionSummary: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  objectDetectorModel: {
    type: String
  },
  isAnomalousClip: {
    type: Boolean
  },
  previewBase64: {
    type: String
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Historique', HistoriqueSchema);
