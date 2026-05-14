const AIService = require('../services/aiService');
const logger = require('../utils/logger');
const { asyncHandler } = require('../middleware/errorHandler');
const ToolService = require('../services/toolService');
const memoryService = require('../services/memoryService');

// Store last response IDs per session
const sessionResponseIds = new Map();
// Store pending tool confirmations
const pendingToolCalls = new Map();

/**
 * AI Completion endpoint
 */
const createCompletion = asyncHandler(async (req, res) => {
    const { messages, temperature, max_tokens, stream, sessionId, reasoningEffort } = req.body;

    logger.info('AI completion request received', {
        messageCount: messages.length,
        stream,
        sessionId
    });

    const previousResponseId = sessionId ? sessionResponseIds.get(sessionId) : null;

    // Get memory context
    const memoryContext = await memoryService.getSystemContext();
    const inputWithMemory = memoryContext ? [{
        role: 'system',
        content: memoryContext
    }, ...messages] : messages;

    const result = await AIService.createCompletion({
        messages: inputWithMemory,
        temperature,
        maxTokens: max_tokens,
        stream,
        reasoningEffort,
        previousResponseId
    });

    // Handle streaming response
    if (stream && result.data) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');

        let buffer = '';
        let streamEnded = false;

        const streamTimeout = setTimeout(() => {
            if (!streamEnded) {
                logger.warn('Stream timeout, ending connection');
                streamEnded = true;
                if (!res.headersSent) {
                    res.end();
                }
            }
        }, 30000);

        result.data.on('data', async (chunk) => {
            if (streamEnded) return;

            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim() === '') continue;
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data.trim() === '[DONE]') {
                        clearTimeout(streamTimeout);
                        streamEnded = true;
                        res.write('data: [DONE]\n\n');
                        res.end();
                        return;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        // Handle reasoning content
                        if (parsed.reasoning_content) {
                            res.write(`data: {"type":"reasoning","content":"${parsed.reasoning_content.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"}\n\n`);
                        }
                        // Handle regular content
                        if (parsed.content) {
                            res.write(`data: ${JSON.stringify({ content: parsed.content })}\n\n`);
                        }
                        // Handle tool calls
                        if (parsed.tool_calls) {
                            for (const toolCall of parsed.tool_calls) {
                                if (toolCall.type === 'function') {
                                    const { name, arguments: args } = toolCall.function;
                                    if (['run_command', 'write_file'].includes(name)) {
                                        // Requires confirmation
                                        const callId = `${sessionId}_${Date.now()}`;
                                        pendingToolCalls.set(callId, { name, args, toolCall });
                                        res.write(`data: ${JSON.stringify({ type: 'tool_confirm', name, args, callId })}\n\n`);
                                    } else {
                                        // Execute immediately
                                        try {
                                            const result = await ToolService.executeTool(name, JSON.parse(args));
                                            res.write(`data: ${JSON.stringify({ type: 'tool_result', name, result })}\n\n`);
                                        } catch (error) {
                                            res.write(`data: ${JSON.stringify({ type: 'tool_result', name, error: error.message })}\n\n`);
                                        }
                                    }
                                } else {
                                    // Built-in tool
                                    res.write(`data: ${JSON.stringify({ type: 'tool_call', tool: toolCall.type })}\n\n`);
                                }
                            }
                        }
                        // Store response ID if available
                        if (parsed.response && parsed.response.id && sessionId) {
                            sessionResponseIds.set(sessionId, parsed.response.id);
                        }
                    } catch (e) {
                        logger.error('Failed to parse streaming chunk', { error: e.message });
                    }
                }
            }
        });

        result.data.on('end', () => {
            clearTimeout(streamTimeout);
            if (!streamEnded) {
                streamEnded = true;
                res.write('data: [DONE]\n\n');
                res.end();
            }
        });

        result.data.on('error', (error) => {
            clearTimeout(streamTimeout);
            logger.error('Streaming error', { error: error.message });
            if (!streamEnded) {
                streamEnded = true;
                res.end();
            }
        });
    } else {
        // Non-streaming response
        if (result.response && result.response.id && sessionId) {
            sessionResponseIds.set(sessionId, result.response.id);
        }
        res.json(result);
    }
});

/**
 * Generate image endpoint
 */
const generateImage = asyncHandler(async (req, res) => {
    const { prompt, n, response_format } = req.body;

    logger.info('Image generation request received');

    const result = await AIService.generateImage({
        prompt,
        n,
        responseFormat: response_format
    });

    res.json(result);
});

/**
 * Code analysis endpoint
 */
const analyzeCode = asyncHandler(async (req, res) => {
    const { code, language, analysisType, context } = req.body;

    logger.info('Code analysis request received', { language, analysisType });

    const result = await AIService.analyzeCode({
        code,
        language,
        analysisType,
        context
    });

    res.json(result);
});

/**
 * Project analysis endpoint
 */
const analyzeProject = asyncHandler(async (req, res) => {
    const { fileStructure, projectType, fileContents } = req.body;

    logger.info('Project analysis request received', { projectType });

    const result = await AIService.analyzeProject({
        fileStructure,
        projectType,
        fileContents
    });

    res.json(result);
});

/**
 * Image analysis endpoint
 */
const analyzeImage = asyncHandler(async (req, res) => {
    const { imageData, prompt } = req.body;

    logger.info('Image analysis request received');

    const result = await AIService.analyzeImage({
        imageData,
        prompt
    });

    res.json(result);
});

/**
 * Smart code insertion endpoint
 */
const smartInsert = asyncHandler(async (req, res) => {
    const { currentContent, codeToInsert, fileName, language } = req.body;

    logger.info('Smart insert request received', { fileName });

    const result = await AIService.smartInsert({
        currentContent,
        codeToInsert,
        fileName,
        language
    });

    res.json(result);
});

module.exports = {
    createCompletion,
    generateImage,
    analyzeCode,
    analyzeProject,
    analyzeImage,
    smartInsert
};
