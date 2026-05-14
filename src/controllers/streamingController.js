/**
 * Streaming Controller
 * Handles streaming AI responses
 */

const aiService = require('../services/aiService');
const databaseService = require('../services/databaseService');
const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * Stream AI completion
 */
exports.streamCompletion = async (req, res) => {
    const { message, context, mode, model, conversationHistory, reasoningEffort, sessionId } = req.body;

    try {
        // Set headers for SSE (Server-Sent Events)
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Get previous response ID for chaining
        let previousResponseId = null;
        if (sessionId) {
            previousResponseId = await databaseService.getLastResponseId(sessionId);
        }

        // Build prompt based on mode
        let prompt = message;
        if (context) {
            prompt = `Context:\n\`\`\`\n${context}\n\`\`\`\n\n${message}`;
        }

        // Add mode-specific instructions
        const modeInstructions = {
            'code': 'You are a code assistant. Provide code examples and explanations.',
            'review': 'You are a code reviewer. Analyze the code for issues, bugs, and improvements.',
            'chat': 'You are a helpful assistant.',
            'image': 'You are assisting with image generation descriptions.'
        };

        if (modeInstructions[mode]) {
            prompt = `${modeInstructions[mode]}\n\n${prompt}`;
        }

        // Build messages array
        const messages = [];

        // Add conversation history
        if (conversationHistory && conversationHistory.length > 0) {
            messages.push(...conversationHistory);
        }

        // Add current message
        messages.push({ role: 'user', content: prompt });

        // Stream response
        let lastResponseId = null;
        await aiService.streamCompletion(
            messages,
            model || config.xai.models.chat,
            (chunk) => {
                if (chunk.type === 'content') {
                    res.write(`data: ${JSON.stringify({ content: chunk.content })}\n\n`);
                } else if (chunk.type === 'reasoning') {
                    res.write(`data: ${JSON.stringify({ type: 'reasoning', content: chunk.content })}\n\n`);
                }
                // Store response ID if provided in chunk
                if (chunk.responseId) {
                    lastResponseId = chunk.responseId;
                }
            },
            reasoningEffort,
            previousResponseId
        );

        // Store the last response ID for future chaining
        if (sessionId && lastResponseId) {
            await databaseService.setLastResponseId(sessionId, lastResponseId);
        }

        // Send completion marker
        res.write('data: [DONE]\n\n');
        res.end();

    } catch (error) {
        logger.error('Streaming error:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
};
