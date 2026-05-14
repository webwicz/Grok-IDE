/**
 * Context Attachments Module
 * Phase 1.3 - File context attachment pills
 */

(function() {
    'use strict';

    class ContextAttachments {
        constructor() {
            this.attachments = [];
            this.container = null;
        }

        /**
         * Initialize context attachments
         */
        initialize() {
            this.container = document.createElement('div');
            this.container.className = 'attachment-pills';
            this.container.id = 'attachment-pills';

            // Insert before the input controls
            const inputArea = document.querySelector('.ai-input-area');
            if (inputArea) {
                inputArea.insertBefore(this.container, inputArea.firstChild);
            }

            this.setupAttachmentButtons();
        }

        /**
         * Setup attachment buttons
         */
        setupAttachmentButtons() {
            // Create attach file button
            const attachBtn = document.createElement('button');
            attachBtn.className = 'attach-btn';
            attachBtn.innerHTML = '📎';
            attachBtn.title = 'Attach file or selection';
            attachBtn.onclick = () => this.showAttachmentMenu();

            // Insert next to send button
            const sendBtn = document.getElementById('sendBtn');
            if (sendBtn) {
                sendBtn.parentNode.insertBefore(attachBtn, sendBtn);
            }
        }

        /**
         * Show attachment menu
         */
        showAttachmentMenu() {
            // Create menu overlay
            const menu = document.createElement('div');
            menu.className = 'attachment-menu';
            menu.innerHTML = `
                <div class="attachment-menu-header">Attach Context</div>
                <div class="attachment-menu-options">
                    <button onclick="window.contextAttachments.attachCurrentFile()">
                        📄 Current File
                    </button>
                    <button onclick="window.contextAttachments.attachSelection()">
                        ✂️ Selection
                    </button>
                    <button onclick="window.contextAttachments.attachCustomFile()">
                        📂 Custom File
                    </button>
                </div>
                <button class="attachment-menu-close" onclick="this.parentElement.remove()">✕</button>
            `;

            document.body.appendChild(menu);
        }

        /**
         * Attach current file
         */
        attachCurrentFile() {
            if (window.monacoEditor) {
                const filename = window.currentFile || 'current-file';
                const content = window.monacoEditor.getValue();
                this.addAttachment('file', filename, content);
            }
            this.closeMenu();
        }

        /**
         * Attach selection
         */
        attachSelection() {
            if (window.monacoEditor) {
                const filename = window.currentFile || 'current-file';
                const content = window.monacoEditor.getSelectedText();
                if (content) {
                    this.addAttachment('selection', `${filename} (selection)`, content);
                }
            }
            this.closeMenu();
        }

        /**
         * Attach custom file (placeholder)
         */
        attachCustomFile() {
            // This would require file picker implementation
            alert('Custom file attachment requires file picker implementation');
            this.closeMenu();
        }

        /**
         * Add attachment
         */
        addAttachment(type, name, content) {
            const attachment = {
                id: Date.now(),
                type,
                name,
                content
            };

            this.attachments.push(attachment);
            this.renderPills();
        }

        /**
         * Remove attachment
         */
        removeAttachment(id) {
            this.attachments = this.attachments.filter(att => att.id !== id);
            this.renderPills();
        }

        /**
         * Render attachment pills
         */
        renderPills() {
            if (!this.container) return;

            this.container.innerHTML = '';

            this.attachments.forEach(att => {
                const pill = document.createElement('div');
                pill.className = 'attachment-pill';
                pill.innerHTML = `
                    <span class="pill-icon">${this.getTypeIcon(att.type)}</span>
                    <span class="pill-name">${att.name}</span>
                    <button class="pill-remove" onclick="window.contextAttachments.removeAttachment(${att.id})">×</button>
                `;
                this.container.appendChild(pill);
            });
        }

        /**
         * Get type icon
         */
        getTypeIcon(type) {
            const icons = {
                'file': '📄',
                'selection': '✂️',
                'custom': '📂'
            };
            return icons[type] || '📎';
        }

        /**
         * Close menu
         */
        closeMenu() {
            const menu = document.querySelector('.attachment-menu');
            if (menu) {
                menu.remove();
            }
        }

        /**
         * Get serialized context for API
         */
        getContext() {
            return this.attachments.map(att => ({
                type: att.type,
                name: att.name,
                content: att.content
            }));
        }

        /**
         * Clear all attachments
         */
        clear() {
            this.attachments = [];
            this.renderPills();
        }
    }

    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', () => {
        window.contextAttachments = new ContextAttachments();
        window.contextAttachments.initialize();
    });

})();