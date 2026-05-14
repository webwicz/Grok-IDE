const express = require('express');
const aiController = require('../controllers/aiController');
const chatController = require('../controllers/chatController');
const streamingController = require('../controllers/streamingController');
const gitController = require('../controllers/gitController');
const searchController = require('../controllers/searchController');
const memoryService = require('../services/memoryService');
const { validateRequest, validateApiKey, aiRateLimiter } = require('../middleware/security');
const {
    completionSchema,
    imageGenerationSchema,
    codeAnalysisSchema,
    projectAnalysisSchema,
    imageAnalysisSchema,
    smartInsertSchema,
    chatMessageSchema
} = require('../utils/validation');

const router = express.Router();

// Health check endpoint
router.get('/health', (req, res) => {
    const config = require('../config/config');
    res.json({
        status: 'SYSTEM ONLINE',
        timestamp: new Date().toISOString(),
        version: '3.0.0',
        features: {
            aiCompletion: !!config.xai.apiKey,
            imageGeneration: !!config.xai.apiKey,
            imageAnalysis: !!config.xai.apiKey,
            codeAnalysis: !!config.xai.apiKey,
            projectAnalysis: !!config.xai.apiKey
        }
    });
});

// AI Endpoints - with rate limiting and API key validation
router.post('/completion',
    aiRateLimiter,
    validateApiKey,
    validateRequest(completionSchema),
    aiController.createCompletion
);

router.post('/generate-image',
    aiRateLimiter,
    validateApiKey,
    validateRequest(imageGenerationSchema),
    aiController.generateImage
);

router.post('/analyze-code',
    aiRateLimiter,
    validateApiKey,
    validateRequest(codeAnalysisSchema),
    aiController.analyzeCode
);

router.post('/analyze-project',
    aiRateLimiter,
    validateApiKey,
    validateRequest(projectAnalysisSchema),
    aiController.analyzeProject
);

router.post('/analyze-image',
    aiRateLimiter,
    validateApiKey,
    validateRequest(imageAnalysisSchema),
    aiController.analyzeImage
);

router.post('/smart-insert',
    aiRateLimiter,
    validateApiKey,
    validateRequest(smartInsertSchema),
    aiController.smartInsert
);

// Chat History Endpoints
router.get('/chat-history', chatController.getChatSessions);
router.get('/chat-history/:sessionId', chatController.getChatSession);
router.post('/chat-history', validateRequest(chatMessageSchema), chatController.saveChatMessage);
router.delete('/chat-history/:sessionId', chatController.deleteChatSession);

// Phase 3: Streaming Endpoint
router.post('/completion-stream',
    aiRateLimiter,
    validateApiKey,
    streamingController.streamCompletion
);

// Phase 3: Tool Confirmation Endpoint
router.post('/tool-confirm', (req, res) => {
    const { sessionId, toolCallId, approved } = req.body;
    // This would resolve the pending tool call
    // For now, just acknowledge
    res.json({ status: 'acknowledged', approved });
});

// Phase 4: Memory Endpoints
router.get('/memory', async (req, res) => {
    try {
        const content = await memoryService.getMemoryFile('MEMORY.md');
        res.json({ content });
    } catch (error) {
        res.json({ content: '' });
    }
});

router.put('/memory', async (req, res) => {
    const { content } = req.body;
    await memoryService.saveMemoryFile('MEMORY.md', content);
    res.json({ status: 'saved' });
});

router.get('/memory/dreams', async (req, res) => {
    try {
        const content = await memoryService.getMemoryFile('DREAMS.md');
        res.json({ diary: content, status: 'idle' });
    } catch (error) {
        res.json({ diary: '', status: 'idle' });
    }
});

router.post('/dreaming/trigger', async (req, res) => {
    const dreamingService = require('../services/dreamingService');
    dreamingService.triggerManualDream();
    res.json({ status: 'triggered' });
});

// Phase 3: Git Endpoints
router.get('/git/status', gitController.getStatus);
router.get('/git/branches', gitController.getBranches);
router.get('/git/history', gitController.getHistory);
router.post('/git/stage', gitController.stageFile);
router.post('/git/commit', gitController.commit);
router.post('/git/checkout', gitController.checkout);
router.post('/git/branch', gitController.createBranch);
router.post('/git/push', gitController.push);
router.post('/git/pull', gitController.pull);

// Phase 3: Search Endpoint
router.post('/search', searchController.searchFiles);

// Debug endpoint for development
if (process.env.NODE_ENV !== 'production') {
    router.get('/debug', (req, res) => {
        const config = require('../config/config');
        res.json({
            hasApiKey: !!config.xai.apiKey,
            apiKeyPrefix: config.xai.apiKey ? config.xai.apiKey.substring(0, 10) + '...' : 'Not set',
            timestamp: new Date().toISOString(),
            environment: config.server.env
        });
    });
}

module.exports = router;
