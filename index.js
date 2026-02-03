import { eventSource, event_types, main_api, stopGeneration } from '/script.js';
import { renderExtensionTemplateAsync } from '/scripts/extensions.js';
import { POPUP_RESULT, POPUP_TYPE, Popup } from '/scripts/popup.js';
import { getTokenCountAsync } from '/scripts/tokenizers.js';

const extensionName = 'ST-Prompt-Viewer';
const templatePath = `third-party/${extensionName}`;
const STORAGE_KEY = 'prompt_viewer_enabled';

if (!('GENERATE_AFTER_COMBINE_PROMPTS' in event_types) || !('CHAT_COMPLETION_PROMPT_READY' in event_types)) {
    toastr.error('【提示词查看】错误：您的SillyTavern版本过旧，缺少必要的事件支持。请更新至最新版本。');
    throw new Error('【提示词查看】缺少必要的事件支持。');
}

let inspectEnabled = localStorage.getItem(STORAGE_KEY) === 'true';

function addLaunchButton() {
    const enabledText = '关闭提示词查看';
    const disabledText = '开启提示词查看';
    const iconClass = 'fa-solid fa-eye';

    const getText = () => inspectEnabled ? enabledText : disabledText;

    const launchButton = document.createElement('div');
    launchButton.id = 'promptViewerLaunchButton';
    launchButton.classList.add('list-group-item', 'flex-container', 'flexGap5', 'interactable');
    launchButton.tabIndex = 0;
    launchButton.title = '切换【提示词查看】状态';

    const icon = document.createElement('i');
    icon.className = iconClass;
    launchButton.appendChild(icon);

    const textSpan = document.createElement('span');
    textSpan.textContent = getText();
    launchButton.appendChild(textSpan);

    const extensionsMenu = document.getElementById('extensionsMenu');
    if (!extensionsMenu) {
        console.error('【提示词查看】无法找到左下角扩展菜单 (extensionsMenu)。');
        return;
    }

    if (document.getElementById(launchButton.id)) {
        return;
    }

    extensionsMenu.appendChild(launchButton);
    launchButton.addEventListener('click', () => {
        toggleInspect();
        textSpan.textContent = getText();
        launchButton.classList.toggle('active', inspectEnabled);
    });

    launchButton.classList.toggle('active', inspectEnabled);
}

function toggleInspect() {
    inspectEnabled = !inspectEnabled;
    toastr.info(`【提示词查看】已${inspectEnabled ? '开启' : '关闭'}`);
    localStorage.setItem(STORAGE_KEY, String(inspectEnabled));
}

function buildMergedText(chat) {
    const lines = [];
    for (const message of chat) {
        lines.push(`[${message.role}]`);
        lines.push(message.content);
        lines.push('─'.repeat(40));
    }
    if (lines.length > 0) {
        lines.pop(); // remove trailing separator
    }
    return lines.join('\n');
}

async function showPromptInspector(input) {
    const template = $(await renderExtensionTemplateAsync(templatePath, 'template'));
    const splitContainer = template.find('#pv-split-container');
    const mergedContainer = template.find('#pv-merged-container');
    const mergedTextarea = template.find('#pv-merged-textarea');
    const splitBtn = template.find('#pv-split-view-btn');
    const mergedBtn = template.find('#pv-merged-view-btn');
    let isJsonMode = false;
    let currentView = 'split';

    const titleHeader = template.find('.pv-header h3');
    const charCountDisplay = $('<span id="pv-char-count" style="font-size: 14px; color: #FFD700; margin-left: 15px; font-weight: normal;"></span>');
    titleHeader.append(charCountDisplay);

    const updateTotalCharCount = async () => {
        let totalTokens = 0;
        let totalChars = 0;
        if (isJsonMode) {
            const textareas = template.find('.pv-message-textarea');
            for (const textarea of textareas) {
                const text = $(textarea).val();
                totalTokens += await getTokenCountAsync(text);
                totalChars += text.length;
            }
        } else {
            const text = template.find('#pv-plain-text-editor').val();
            totalTokens = await getTokenCountAsync(text);
            totalChars = text.length;
        }
        charCountDisplay.text(`(总 ${totalTokens} Tokens / ${totalChars} 字)`);
    };

    const updateMergedView = () => {
        if (!isJsonMode) return;
        const chat = [];
        template.find('.pv-message-block').each(function () {
            const role = $(this).data('role');
            const content = $(this).find('textarea').val();
            chat.push({ role, content });
        });
        mergedTextarea.val(buildMergedText(chat));
    };

    // View toggle logic
    splitBtn.on('click', () => {
        if (currentView === 'split') return;
        currentView = 'split';
        splitBtn.addClass('pv-toggle-active');
        mergedBtn.removeClass('pv-toggle-active');
        splitContainer.show();
        mergedContainer.hide();
    });

    mergedBtn.on('click', () => {
        if (currentView === 'merged') return;
        currentView = 'merged';
        mergedBtn.addClass('pv-toggle-active');
        splitBtn.removeClass('pv-toggle-active');
        mergedContainer.show();
        splitContainer.hide();
        updateMergedView();
    });

    try {
        const chat = JSON.parse(input);
        if (Array.isArray(chat)) {
            isJsonMode = true;
            splitContainer.empty();
            for (const message of chat) {
                const block = $(`
                    <div class="pv-message-block" data-role="${message.role}">
                        <div class="pv-message-header">
                            <span class="pv-line-char-count" style="font-weight: normal; color: #FFD700; margin-right: 10px;"></span>
                            <span class="pv-role">${message.role}</span>
                        </div>
                        <div class="pv-message-content">
                            <textarea class="pv-message-textarea"></textarea>
                        </div>
                    </div>
                `);

                const textarea = block.find('textarea');
                textarea.val(message.content);
                splitContainer.append(block);

                const lineCharCountDisplay = block.find('.pv-line-char-count');
                const updateLineCharCount = async () => {
                    const text = textarea.val();
                    const lineTokens = await getTokenCountAsync(text);
                    const lineChars = text.length;
                    lineCharCountDisplay.text(`(${lineTokens} Tokens / ${lineChars} 字)`);
                };

                await updateLineCharCount();
                textarea.on('input', async () => {
                    await updateLineCharCount();
                    await updateTotalCharCount();
                });

                block.find('.pv-message-header').on('click', function (e) {
                    if ($(e.target).is('.pv-line-char-count')) {
                        e.stopPropagation();
                        return;
                    }
                    const content = $(this).siblings('.pv-message-content');
                    const parentBlock = $(this).closest('.pv-message-block');
                    parentBlock.toggleClass('expanded');
                    content.slideToggle('fast');
                });
            }
        } else {
            throw new Error('Input is not a chat array.');
        }
    } catch (e) {
        isJsonMode = false;
        // Hide view toggle in plain text mode (no merged view distinction needed)
        template.find('.pv-view-toggle').hide();
        const textArea = $('<textarea id="pv-plain-text-editor" style="width: 100%; height: 100%; box-sizing: border-box;"></textarea>');
        textArea.val(input);
        splitContainer.empty().append(textArea);
        textArea.on('input', async () => await updateTotalCharCount());
    }

    await updateTotalCharCount();

    // Search functionality
    const searchInput = template.find('#pv-search-input');
    const searchButton = template.find('#pv-search-button');
    const clearButton = template.find('#pv-clear-button');

    const performSearch = () => {
        const searchTerm = searchInput.val().trim();
        if (!searchTerm) return;

        clearHighlights();

        let firstMatch = null;
        const textareas = template.find('.pv-message-textarea, #pv-plain-text-editor, #pv-merged-textarea');

        textareas.each(function () {
            const textarea = $(this);
            const content = textarea.val();
            const regex = new RegExp(searchTerm.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');

            if (regex.test(content)) {
                textarea.addClass('pv-highlight-border');
                if (!firstMatch) {
                    firstMatch = textarea;
                }

                const block = textarea.closest('.pv-message-block');
                if (block.length && !block.hasClass('expanded')) {
                    block.addClass('expanded');
                    block.find('.pv-message-content').slideDown('fast');
                }
            }
        });

        if (firstMatch) {
            firstMatch[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            toastr.info('【提示词查看】未找到匹配项。');
        }
    };

    const clearHighlights = () => {
        template.find('.pv-highlight-border').removeClass('pv-highlight-border');
    };

    searchButton.on('click', performSearch);
    searchInput.on('keypress', (e) => {
        if (e.which === 13) {
            performSearch();
        }
    });
    clearButton.on('click', clearHighlights);

    const customButton = {
        text: '取消生成',
        result: POPUP_RESULT.CANCELLED,
        appendAtEnd: true,
        action: async () => {
            await stopGeneration();
            await popup.complete(POPUP_RESULT.CANCELLED);
        },
    };

    const popup = new Popup(template, POPUP_TYPE.CONFIRM, '', {
        wide: true,
        large: true,
        okButton: '确认修改',
        cancelButton: '放弃修改',
        customButtons: [customButton],
    });

    const result = await popup.show();

    if (!result) {
        return input;
    }

    if (isJsonMode) {
        const newChat = [];
        template.find('.pv-message-block').each(function () {
            const role = $(this).data('role');
            const content = $(this).find('textarea').val();
            newChat.push({ role, content });
        });
        return JSON.stringify(newChat, null, 4);
    } else {
        return template.find('#pv-plain-text-editor').val();
    }
}

function isChatCompletion() {
    return main_api === 'openai';
}

eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, async (data) => {
    if (!inspectEnabled || data.dryRun || isChatCompletion()) return;
    if (typeof data.prompt !== 'string') return;

    const result = await showPromptInspector(data.prompt);
    if (result !== data.prompt) {
        data.prompt = result;
        console.log('【提示词查看】提示词已修改 (Text Gen)。');
    }
});

eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, async (data) => {
    if (!inspectEnabled || data.dryRun || !isChatCompletion()) return;
    if (!Array.isArray(data.chat)) return;

    const originalJson = JSON.stringify(data.chat, null, 4);
    const resultJson = await showPromptInspector(originalJson);

    if (resultJson === originalJson) return;

    try {
        const modifiedChat = JSON.parse(resultJson);
        data.chat.splice(0, data.chat.length, ...modifiedChat);
        console.log('【提示词查看】提示词已修改 (Chat Completion)。');
    } catch (e) {
        console.error('【提示词查看】解析修改后的JSON失败:', e);
        toastr.error('【提示词查看】解析JSON失败，本次修改未生效。');
    }
});

addLaunchButton();
