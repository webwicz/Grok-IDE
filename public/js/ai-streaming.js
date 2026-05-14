/**
 * AI Streaming Module
 * Phase 3 - Streaming AI responses with real-time output
 */

(function() {
    'use strict';

    class AIStreaming {
        constructor() {
            this.currentMode = 'code';
            this.isStreaming = false;
            this.abortController = null;
            this.conversationHistory = [];
            this.sessionId = this._generateSessionId();
            this.setupModeButtons();
            this.setupSendButton();
            this.setupInputHandlers();
        }

        /**
         * Setup mode buttons
         */
        setupModeButtons() {
            const modeButtons = document.querySelectorAll('.ai-action-btn[data-mode]');
            modeButtons.forEach(button => {
                button.addEventListener('click', () => {
                    const mode = button.dataset.mode;
                    this.setMode(mode);

                    // Update active state
                    modeButtons.forEach(b => b.classList.remove('active'));
                    button.classList.add('active');
                });
            });
        }

        /**
         * Setup send button
         */
        setupSendButton() {
            const sendBtn = document.getElementById('ai-send-btn');
            sendBtn?.addEventListener('click', () => this.sendMessage());
        }
        /**
         * Send prompt (global function for HTML onclick)
         */
        sendPrompt() {
            this.sendMessage();
        }
        /**
         * Show thinking indicator
         */
        showThinking() {
            const aiContent = document.getElementById('ai-content');
            if (!aiContent) return;

            // Remove any existing thinking indicator
            this.hideThinking();

            const thinkingDiv = document.createElement('div');
            thinkingDiv.className = 'ai-thinking';
            thinkingDiv.id = 'thinking-indicator';
            thinkingDiv.innerHTML = `
                <div class="thinking-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            `;

            aiContent.appendChild(thinkingDiv);
            aiContent.scrollTop = aiContent.scrollHeight;
        }

        /**
         * Hide thinking indicator
         */
        hideThinking() {
            const thinkingDiv = document.getElementById('thinking-indicator');
            if (thinkingDiv) {
                thinkingDiv.remove();
            }
        }

        /**
         * Set AI mode
         */
        setMode(mode) {
            this.currentMode = mode;
            const input = document.getElementById('aiPrompt');
            if (input) {
                const placeholders = {
                    'code': 'Ask me to write, review, or explain code...',
                    'image': 'Describe an image to generate...',
                    'chat': 'Ask me anything...',
                    'review': 'I\'ll review your code for issues and improvements...'
                };
                input.placeholder = placeholders[mode] || 'Ask me anything...';
            }
        }

        /**
         * Send message to AI
         */
        async sendMessage() {
            const input = document.getElementById('ai-input') || document.getElementById('aiPrompt');
            if (!input) return;
            const message = input.value.trim();

            if (!message || this.isStreaming) return;

            // Get context from attachments
            let context = '';
            if (window.contextAttachments) {
                const attachments = window.contextAttachments.getContext();
                if (attachments.length > 0) {
                    context = attachments.map(att => 
                        `--- ${att.type.toUpperCase()}: ${att.name} ---\n${att.content}`
                    ).join('\n\n');
                }
            }

            // Clear input and attachments
            input.value = '';
            if (window.contextAttachments) {
                window.contextAttachments.clear();
            }

            // Add user message to chat
            this.addMessage('user', message);

            // Show AI status
            this.updateAIStatus('Thinking...');

            // Show thinking indicator
            this.showThinking();

            // Start streaming
            try {
                await this.streamResponse(message, context);
            } catch (error) {
                console.error('AI streaming error:', error);
                this.addMessage('assistant', `Error: ${error.message}`);
                this.updateAIStatus('Error');
            }
        }

        /**
         * Stream AI response
         */
        async streamResponse(message, context = '') {
            this.isStreaming = true;
            this.abortController = new AbortController();

            const model = document.getElementById('ai-model-select')?.value || 'grok-4.3';
            const reasoningEffort = document.getElementById('reasoningEffort')?.value || 'low';

            // Create message container for streaming
            const messageDiv = this.createStreamingMessage();

            try {
                const response = await fetch('/api/completion-stream', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        message,
                        context,
                        mode: this.currentMode,
                        model,
                        reasoningEffort,
                        sessionId: this.sessionId,
                        conversationHistory: this.conversationHistory.slice(-10) // Last 10 messages
                    }),
                    signal: this.abortController.signal
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let fullResponse = '';
                let reasoningContent = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') continue;

                            try {
                                const parsed = JSON.parse(data);
                                if (parsed.content) {
                                    fullResponse += parsed.content;
                                    this.hideThinking(); // Hide thinking indicator on first content
                                    this.updateStreamingMessage(messageDiv, fullResponse, reasoningContent);
                                } else if (parsed.type === 'reasoning') {
                                    reasoningContent += parsed.content;
                                    this.updateStreamingMessage(messageDiv, fullResponse, reasoningContent);
                                } else if (parsed.type === 'tool_call') {
                                    this.showToolCard(parsed.tool, 'running');
                                } else if (parsed.type === 'tool_result') {
                                    this.updateToolCard(parsed.name, parsed.result || parsed.error, 'completed');
                                } else if (parsed.type === 'tool_confirm') {
                                    this.showToolConfirmation(parsed.name, parsed.args, parsed.callId);
                                }
                            } catch (e) {
                                // Ignore parse errors
                            }
                        }
                    }
                }

                // Finalize message
                this.finalizeStreamingMessage(messageDiv, fullResponse);

                // Save to conversation history
                this.conversationHistory.push(
                    { role: 'user', content: message },
                    { role: 'assistant', content: fullResponse }
                );

                // Save to conversation manager
                if (window.conversationManager) {
                    window.conversationManager.saveConversation(message, fullResponse);
                }

                this.updateAIStatus('Ready');

            } catch (error) {
                if (error.name === 'AbortError') {
                    this.updateStreamingMessage(messageDiv, 'Response cancelled by user.');
                } else {
                    throw error;
                }
            } finally {
                this.isStreaming = false;
                this.abortController = null;
            }
        }

        /**
         * Add message to chat
         */
        addMessage(role, content) {
            const aiContent = document.getElementById('ai-content');
            if (!aiContent) return;

            const messageDiv = document.createElement('div');
            messageDiv.className = `ai-message ${role}`;

            const headerDiv = document.createElement('div');
            headerDiv.className = 'message-header';

            const roleText = role === 'user' ? '👤 You' : '🤖 Grok AI';
            const timestamp = new Date().toLocaleTimeString();

            headerDiv.innerHTML = `
                <strong>${roleText}</strong>
                <span class="text-xs text-tertiary">${timestamp}</span>
            `;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.innerHTML = this.formatMessage(content);

            messageDiv.appendChild(headerDiv);
            messageDiv.appendChild(contentDiv);

            if (role === 'assistant') {
                this.addMessageActions(messageDiv, content);
            }

            aiContent.appendChild(messageDiv);
            aiContent.scrollTop = aiContent.scrollHeight;
        }

        /**
         * Create streaming message placeholder
         */
        createStreamingMessage() {
            const aiContent = document.getElementById('ai-content');
            const messageDiv = document.createElement('div');
            messageDiv.className = 'ai-message assistant streaming';

            const headerDiv = document.createElement('div');
            headerDiv.className = 'message-header';
            headerDiv.innerHTML = `
                <strong>🤖 Grok AI</strong>
                <span class="text-xs text-tertiary">
                    <span class="ai-loading"></span> Streaming...
                </span>
            `;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.textContent = '';

            messageDiv.appendChild(headerDiv);
            messageDiv.appendChild(contentDiv);
            aiContent.appendChild(messageDiv);
            aiContent.scrollTop = aiContent.scrollHeight;

            return messageDiv;
        }

        /**
         * Update streaming message
         */
        updateStreamingMessage(messageDiv, content, reasoning = '') {
            const contentDiv = messageDiv.querySelector('.message-content');
            if (contentDiv) {
                let html = '';

                // Add reasoning block if present
                if (reasoning) {
                    html += `
                        <div class="ai-reasoning-block">
                            <div class="reasoning-header" onclick="this.parentElement.classList.toggle('collapsed')">
                                <span>Reasoning</span>
                                <span class="toggle-icon">▼</span>
                            </div>
                            <div class="reasoning-content">${this.escapeHtml(reasoning)}</div>
                        </div>
                    `;
                }

                html += this.formatMessage(content);
                contentDiv.innerHTML = html;
            }

            const aiContent = document.getElementById('ai-content');
            if (aiContent) {
                aiContent.scrollTop = aiContent.scrollHeight;
            }
        }

        /**
         * Finalize streaming message
         */
        finalizeStreamingMessage(messageDiv, content) {
            messageDiv.classList.remove('streaming');

            const header = messageDiv.querySelector('.message-header');
            const timestamp = header.querySelector('.text-tertiary');
            if (timestamp) {
                timestamp.innerHTML = new Date().toLocaleTimeString();
            }

            this.addMessageActions(messageDiv, content);
        }

        /**
         * Add message actions
         */
        addMessageActions(messageDiv, content) {
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'message-actions';
            actionsDiv.dataset.content = content;

            const copyBtn = document.createElement('button');
            copyBtn.className = 'btn btn-xs';
            copyBtn.dataset.action = 'copy-message';
            copyBtn.textContent = '📋 Copy';

            const insertBtn = document.createElement('button');
            insertBtn.className = 'btn btn-xs';
            insertBtn.dataset.action = 'insert-to-editor';
            insertBtn.textContent = '↓ Insert to Editor';

            actionsDiv.appendChild(copyBtn);
            actionsDiv.appendChild(insertBtn);
            messageDiv.appendChild(actionsDiv);
        }

        /**
         * Format message with markdown-like syntax
         */
        formatMessage(content) {
            // Simple markdown-like formatting
            let formatted = content;

            // Enhanced code blocks with action buttons
            formatted = formatted.replace(/```(\w+)?(?:\s+([^\n]+))?\n([\s\S]*?)```/g, (match, lang, filepath, code) => {
                const language = lang || 'plaintext';
                const filename = filepath || '';
                const escapedCode = this.escapeHtml(code);

                return `
                    <div class="code-block-wrapper">
                        <div class="code-block-header">
                            <span class="code-language">${language}</span>
                            ${filename ? `<span class="code-filename">${filename}</span>` : ''}
                            <div class="code-block-actions">
                                <button class="code-block-btn" data-action="copy-code" title="Copy code">
                                    📋
                                </button>
                                <button class="code-block-btn" data-action="apply-to-editor" title="Apply to editor">
                                    ↓
                                </button>
                                ${filename ? `<button class="code-block-btn" data-action="view-diff" title="View diff">
                                    🔍
                                </button>` : ''}
                                <button class="code-block-btn" data-action="create-file" title="Create file">
                                    📄
                                </button>
                            </div>
                        </div>
                        <pre><code class="language-${language}" data-filename="${filename}">${escapedCode}</code></pre>
                    </div>
                `;
            });

            // Inline code
            formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

            // Bold
            formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

            // Line breaks
            formatted = formatted.replace(/\n/g, '<br>');

            return formatted;
        }

        /**
         * Copy code from code block
         */
        copyCode(button) {
            const codeBlock = button.closest('.code-block-wrapper').querySelector('code');
            const code = codeBlock.textContent;
            navigator.clipboard.writeText(code).then(() => {
                this.showNotification('Code copied to clipboard', 'success');
            });
        }

        /**
         * Apply code to editor
         */
        applyToEditor(button) {
            const codeBlock = button.closest('.code-block-wrapper').querySelector('code');
            const code = codeBlock.textContent;
            if (window.monacoEditor) {
                window.monacoEditor.setValue(code);
                this.showNotification('Code applied to editor', 'success');
            }
        }

        /**
         * View diff of code block
         */
        viewDiff(button) {
            const codeBlock = button.closest('.code-block-wrapper').querySelector('code');
            const filename = codeBlock.dataset.filename;
            const newCode = codeBlock.textContent;

            if (window.monacoEditor && filename && window.monacoEditor.showDiff) {
                const originalContent = window.monacoEditor.getValue();
                window.monacoEditor.showDiff(originalContent, newCode, filename);
            } else {
                this.showNotification('Diff view requires Monaco editor and filename', 'info');
            }
        }

        /**
         * Create file from code block
         */
        createFile(button) {
            const codeBlock = button.closest('.code-block-wrapper').querySelector('code');
            const filename = codeBlock.dataset.filename;
            const code = codeBlock.textContent;

            if (filename) {
                // This would require backend implementation
                this.showNotification('File creation requires backend implementation', 'info');
            }
        }

        /**
         * Show notification
         */
        showNotification(message, type = 'info') {
            // Use existing notification system if available
            if (window.showNotification) {
                window.showNotification(message, type);
            } else {
                console.log(`${type}: ${message}`);
            }
        }

        /**
         * Add confirmation message
         */
        addConfirmationMessage(question, onAccept, onReject) {
            const aiContent = document.getElementById('ai-content');
            if (!aiContent) return;

            const messageDiv = document.createElement('div');
            messageDiv.className = 'ai-message assistant confirmation';

            const headerDiv = document.createElement('div');
            headerDiv.className = 'message-header';
            headerDiv.innerHTML = `
                <strong>🤖 Grok AI</strong>
                <span class="text-xs text-tertiary">Confirmation Required</span>
            `;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.innerHTML = `
                <div class="ai-confirmation">
                    <p>${question}</p>
                    <div class="confirmation-buttons">
                        <button class="confirm-btn" onclick="this.closest('.ai-confirmation').dataset.accepted='true'">Accept</button>
                        <button class="reject-btn" onclick="this.closest('.ai-confirmation').dataset.accepted='false'">Reject</button>
                    </div>
                </div>
            `;

            messageDiv.appendChild(headerDiv);
            messageDiv.appendChild(contentDiv);
            aiContent.appendChild(messageDiv);
            aiContent.scrollTop = aiContent.scrollHeight;

            // Wait for user response
            const confirmationDiv = contentDiv.querySelector('.ai-confirmation');
            const checkResponse = () => {
                const accepted = confirmationDiv.dataset.accepted;
                if (accepted === 'true') {
                    onAccept();
                } else if (accepted === 'false') {
                    onReject();
                } else {
                    setTimeout(checkResponse, 100);
                }
            };
            checkResponse();
        }

        /**
         * Show tool card
         */
        showToolCard(toolName, status) {
            const aiContent = document.getElementById('ai-content');
            if (!aiContent) return;

            const toolCard = document.createElement('div');
            toolCard.className = 'tool-card';
            toolCard.id = `tool-${Date.now()}`;
            toolCard.innerHTML = `
                <div class="tool-card-header">
                    <span class="tool-icon">🔧</span>
                    <span class="tool-name">${toolName}</span>
                    <span class="tool-status">${status}</span>
                </div>
                <div class="tool-card-body">
                    <div class="tool-spinner"></div>
                    <span>Executing...</span>
                </div>
            `;

            aiContent.appendChild(toolCard);
            aiContent.scrollTop = aiContent.scrollHeight;
        }

        /**
         * Update tool card
         */
        updateToolCard(toolName, result, status) {
            const cards = document.querySelectorAll('.tool-card');
            const card = Array.from(cards).find(c => c.querySelector('.tool-name').textContent === toolName);
            if (card) {
                card.querySelector('.tool-status').textContent = status;
                card.querySelector('.tool-card-body').innerHTML = `<pre>${result}</pre>`;
            }
        }

        /**
         * Show tool confirmation
         */
        showToolConfirmation(toolName, args, callId) {
            const question = `Allow AI to execute: ${toolName} with args: ${JSON.stringify(args)}?`;
            this.addConfirmationMessage(question, () => {
                // Accept
                fetch('/api/tool-confirm', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: this.sessionId, toolCallId: callId, approved: true })
                });
            }, () => {
                // Reject
                fetch('/api/tool-confirm', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: this.sessionId, toolCallId: callId, approved: false })
                });
            });
        }

        /**
         * Copy message content
         */
        copyMessage(button) {
            const actionsDiv = button.closest('.message-actions');
            const content = actionsDiv.dataset.content;

            navigator.clipboard.writeText(content).then(() => {
                if (window.notify) {
                    window.notify.success('Copied', 'Message copied to clipboard');
                }
            });
        }

        /**
         * Insert to editor
         */
        insertToEditor(button) {
            const actionsDiv = button.closest('.message-actions');
            const content = actionsDiv.dataset.content;

            if (window.monacoEditor) {
                // Extract code from code blocks if present
                const codeMatch = content.match(/```(?:\w+)?\n([\s\S]*?)```/);
                const textToInsert = codeMatch ? codeMatch[1] : content;

                window.monacoEditor.insertText(textToInsert);

                if (window.notify) {
                    window.notify.success('Inserted', 'Content inserted to editor');
                }
            }
        }

        /**
         * Update AI status
         */
        updateAIStatus(status) {
            const aiStatus = document.getElementById('ai-status');
            if (aiStatus) {
                const icons = {
                    'Ready': '💭',
                    'Thinking...': '🤔',
                    'Error': '❌',
                    'Streaming...': '✨'
                };
                aiStatus.innerHTML = `${icons[status] || '💭'} ${status}`;
            }
        }

        /**
         * Clear conversation
         */
        clearConversation() {
            const aiContent = document.getElementById('ai-content');
            if (aiContent) {
                aiContent.innerHTML = '<div class="ai-message assistant">Conversation cleared.</div>';
            }
            this.conversationHistory = [];
        }

        /**
         * Stop streaming
         */
        stopStreaming() {
            if (this.abortController) {
                this.abortController.abort();
            }
        }

        /**
         * No-op initialize method for compatibility with app-v3 init flow.
         * All setup is handled in the constructor.
         */
        initialize() {}

        /**
         * Setup keyboard/input handlers for the AI input textarea
         */
        setupInputHandlers() {
            const input = document.getElementById('ai-input');
            if (!input) return;

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });

            // Auto-resize textarea as content grows
            input.addEventListener('input', () => {
                input.style.height = 'auto';
                input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
            });

            // Delegated handler for all data-action buttons (avoids inline onclick CSP issues)
            const aiContent = document.getElementById('ai-content');
            if (aiContent) {
                aiContent.addEventListener('click', (e) => {
                    const btn = e.target.closest('[data-action]');
                    if (!btn) return;
                    const action = btn.dataset.action;
                    if (action === 'copy-message') this.copyMessage(btn);
                    else if (action === 'insert-to-editor') this.insertToEditor(btn);
                    else if (action === 'copy-code') this.copyCode(btn);
                    else if (action === 'apply-to-editor') this.applyToEditor(btn);
                    else if (action === 'view-diff') this.viewDiff(btn);
                    else if (action === 'create-file') this.createFile(btn);
                });
            }
        }

        /**
         * Generate a unique session ID
         */
        _generateSessionId() {
            return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        }

        /**
         * Escape HTML
         */
        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    }

    // Export globally
    window.AIStreaming = AIStreaming;
})();
