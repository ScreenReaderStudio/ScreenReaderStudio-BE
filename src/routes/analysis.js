import express from 'express';

import {
  performAnalysis,
  saveAnalysisResult,
  getAnalysisResult,
} from '../controllers/analysisController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import {
  cancelAnalysisJob,
  createAnalysisJob,
  getAnalysisJob,
  getAnalysisJobResult,
} from '../controllers/analysisJobController.js';

const router = express.Router();

router.post('/perform', performAnalysis);
router.post('/jobs', createAnalysisJob);
router.get('/jobs/:jobId', getAnalysisJob);
router.get('/jobs/:jobId/result', getAnalysisJobResult);
router.delete('/jobs/:jobId', cancelAnalysisJob);
router.post('/', authenticateToken, saveAnalysisResult);
router.get('/:id', getAnalysisResult);

export default router;
