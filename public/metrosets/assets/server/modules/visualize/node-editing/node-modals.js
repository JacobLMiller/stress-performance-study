/**
 * Modal dialogs for node operations — Add Node and Extend Lines modals.
 */

import { validateLineSelection, addNode, extendLinesToNode } from './node-operations.js';

let currentAddNodeModal = null;

/**
 * Close the add node modal if it's open.
 */
export function closeAddNodeModal() {
    if (currentAddNodeModal) {
        if (currentAddNodeModal.parentNode) currentAddNodeModal.parentNode.removeChild(currentAddNodeModal);
        currentAddNodeModal = null;
    }
}

/**
 * Show modal for selecting which lines to add the new node to.
 */
export function showAddNodeModal(visualization, afterNodeId, availableLines) {
    closeAddNodeModal();

    const setOrder = visualization.data.set_order || {};
    for (const line of availableLines) {
        const stations = setOrder[line.lineId];
        const idx = stations.indexOf(afterNodeId);
        line.isEndOfLine = idx >= stations.length - 1;
        line.isStartOfLine = idx === 0;
    }

    const modal = createOverlay();
    const dialog = createDialog();

    // Header
    appendEl(dialog, 'h3', 'Add New Node', 'margin:0 0 8px;font-size:18px;color:#1f2937;');
    appendEl(dialog, 'p', 'Select which lines the new node should be added to (at least one):', 'margin:0 0 16px;font-size:14px;color:#6b7280;');

    // Name input
    appendEl(dialog, 'label', 'Node Name:', 'display:block;margin-bottom:4px;font-size:14px;font-weight:500;color:#374151;');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Enter node name (optional)';
    nameInput.style.cssText = 'width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:4px;font-size:14px;margin-bottom:16px;box-sizing:border-box;';
    dialog.appendChild(nameInput);

    // Line checkboxes
    const linesContainer = document.createElement('div');
    linesContainer.style.cssText = 'margin-bottom:16px;max-height:200px;overflow-y:auto;';
    const checkboxes = [];

    availableLines.forEach(line => {
        const { checkbox } = createLineCheckbox(line, true);
        checkboxes.push(checkbox);
        linesContainer.appendChild(checkbox.parentElement);
    });
    dialog.appendChild(linesContainer);

    // New line creation
    const { newLineCb, newLineNameInput, container: newLineContainer, toggleForm } = createNewLineUI();
    dialog.appendChild(newLineContainer);

    // Error message
    const errorMsg = document.createElement('div');
    errorMsg.style.cssText = 'color:#dc2626;font-size:13px;margin-bottom:12px;display:none;';
    dialog.appendChild(errorMsg);

    // Buttons
    const addBtn = createButton('Add Node', '#3b82f6', 'white');
    const cancelBtn = createButton('Cancel', '#f3f4f6', '#374151', '1px solid #d1d5db');
    cancelBtn.addEventListener('click', closeAddNodeModal);

    addBtn.addEventListener('click', () => {
        const selected = checkboxes.filter(cb => cb.checked).map(cb => availableLines.find(l => l.lineId === cb.value));
        const isNewLine = newLineCb.checked && newLineNameInput.parentElement.style.display !== 'none';
        const newLineName = newLineNameInput.value.trim();

        if (selected.length === 0 && !isNewLine) {
            showError(errorMsg, 'Please select at least one line (or create a new one).');
            return;
        }
        if (isNewLine && !newLineName) {
            showError(errorMsg, 'Please enter a name for the new line.');
            return;
        }

        let chosenAnchorNodeId = afterNodeId;
        let canCreateTerminal = false;

        if (selected.length > 0) {
            const validation = validateLineSelection(visualization, afterNodeId, selected.map(l => l.lineId));
            if (!validation.valid) { showError(errorMsg, validation.reason); return; }
            chosenAnchorNodeId = validation.chosenAnchorNodeId || afterNodeId;
            canCreateTerminal = validation.canCreateTerminal;
        } else {
            canCreateTerminal = true;
        }

        closeAddNodeModal();
        addNode(visualization, chosenAnchorNodeId, selected, nameInput.value.trim(), canCreateTerminal, isNewLine ? { name: newLineName } : null);
    });

    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;';
    buttonsContainer.append(cancelBtn, addBtn);
    dialog.appendChild(buttonsContainer);

    // Validation
    const validateState = () => {
        const selectedIds = checkboxes.filter(cb => cb.checked).map(cb => cb.value);
        const isNewLine = newLineCb.checked && newLineNameInput.parentElement.style.display !== 'none';

        if (selectedIds.length === 0 && !isNewLine) {
            addBtn.disabled = true;
            addBtn.style.opacity = '0.5';
            addBtn.style.cursor = 'not-allowed';
            return;
        }
        if (selectedIds.length > 0) {
            const validation = validateLineSelection(visualization, afterNodeId, selectedIds);
            if (!validation.valid) {
                showError(errorMsg, validation.reason);
                addBtn.disabled = true;
                addBtn.style.opacity = '0.5';
                addBtn.style.cursor = 'not-allowed';
                return;
            }
        }
        errorMsg.style.display = 'none';
        addBtn.disabled = false;
        addBtn.style.opacity = '1';
        addBtn.style.cursor = 'pointer';
    };

    checkboxes.forEach(cb => cb.addEventListener('change', validateState));
    newLineCb.addEventListener('change', validateState);
    newLineNameInput.addEventListener('input', validateState);
    toggleForm.addEventListener('click', () => setTimeout(validateState, 0));

    modal.addEventListener('click', e => { if (e.target === modal) closeAddNodeModal(); });
    modal.appendChild(dialog);
    document.body.appendChild(modal);
    currentAddNodeModal = modal;
    nameInput.focus();
}

/**
 * Show modal to select lines to extend to the current node.
 */
export function showExtendLinesModal(visualization, node, candidates) {
    closeAddNodeModal();

    const modal = createOverlay();
    const dialog = createDialog();

    appendEl(dialog, 'h3', 'Add to Existing Line', 'margin:0 0 8px;font-size:18px;color:#1f2937;');
    appendEl(dialog, 'p', 'Select lines to extend to this node:', 'margin:0 0 16px;font-size:14px;color:#6b7280;');

    const linesContainer = document.createElement('div');
    linesContainer.style.cssText = 'margin-bottom:16px;max-height:200px;overflow-y:auto;';

    const checkboxes = [];
    candidates.forEach(line => {
        const { checkbox } = createLineCheckbox({
            ...line,
            lineName: line.lineName + (line.neighborId ? ` (via node ${line.neighborId})` : '')
        }, false);
        checkboxes.push(checkbox);
        linesContainer.appendChild(checkbox.parentElement);
    });
    dialog.appendChild(linesContainer);

    const errorMsg = document.createElement('div');
    errorMsg.style.cssText = 'color:#dc2626;font-size:13px;margin-bottom:12px;display:none;';
    dialog.appendChild(errorMsg);

    const addBtn = createButton('Extend Lines', '#3b82f6', 'white');
    const cancelBtn = createButton('Cancel', '#f3f4f6', '#374151', '1px solid #d1d5db');
    cancelBtn.addEventListener('click', closeAddNodeModal);

    addBtn.addEventListener('click', () => {
        const selectedIds = checkboxes.filter(cb => cb.checked).map(cb => cb.value);
        if (selectedIds.length === 0) { showError(errorMsg, 'Please select at least one line.'); return; }
        const selected = selectedIds.map(id => candidates.find(c => c.lineId === id));
        closeAddNodeModal();
        extendLinesToNode(visualization, node, selected);
    });

    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;';
    buttonsContainer.append(cancelBtn, addBtn);
    dialog.appendChild(buttonsContainer);

    modal.addEventListener('click', e => { if (e.target === modal) closeAddNodeModal(); });
    modal.appendChild(dialog);
    document.body.appendChild(modal);
    currentAddNodeModal = modal;
}

// ── Shared UI helpers ────────────────────────────────────────────

function createOverlay() {
    const el = document.createElement('div');
    el.className = 'add-node-modal-overlay';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background-color:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10001;';
    return el;
}

function createDialog() {
    const el = document.createElement('div');
    el.className = 'add-node-modal';
    el.style.cssText = 'background-color:white;border-radius:8px;padding:24px;min-width:350px;max-width:500px;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
    return el;
}

function appendEl(parent, tag, text, style) {
    const el = document.createElement(tag);
    el.textContent = text;
    el.style.cssText = style;
    parent.appendChild(el);
    return el;
}

function createButton(text, bg, color, border = 'none') {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = `padding:8px 16px;background-color:${bg};color:${color};border:${border};border-radius:4px;cursor:pointer;font-size:14px;`;
    return btn;
}

function createLineCheckbox(line, checked = true) {
    const lineItem = document.createElement('label');
    lineItem.style.cssText = 'display:flex;align-items:center;padding:8px;margin-bottom:4px;background-color:#f9fafb;border-radius:4px;cursor:pointer;transition:background-color 0.2s;';
    lineItem.addEventListener('mouseenter', () => lineItem.style.backgroundColor = '#f3f4f6');
    lineItem.addEventListener('mouseleave', () => lineItem.style.backgroundColor = '#f9fafb');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    checkbox.value = line.lineId;
    checkbox.style.cssText = 'margin-right:12px;width:18px;height:18px;cursor:pointer;';

    const colorBox = document.createElement('div');
    colorBox.style.cssText = `width:24px;height:6px;background-color:${line.color};margin-right:12px;border-radius:3px;`;

    const suffix = line.isStartOfLine && line.isEndOfLine ? ' (only node)' :
        line.isStartOfLine ? ' (start of line)' :
        line.isEndOfLine ? ' (end of line)' : '';

    const name = document.createElement('span');
    name.textContent = (line.lineName || line.lineId) + suffix;
    name.style.cssText = 'font-size:14px;color:#1f2937;';

    lineItem.append(checkbox, colorBox, name);
    return { checkbox };
}

function createNewLineUI() {
    const container = document.createElement('div');
    container.style.cssText = 'margin-bottom:16px;padding-top:10px;border-top:1px solid #eee;';

    const createBtn = document.createElement('button');
    createBtn.textContent = '+ Create New Line';
    createBtn.style.cssText = 'width:100%;padding:8px;background-color:#fff;border:1px dashed #ccc;color:#555;border-radius:4px;cursor:pointer;font-size:14px;';

    const form = document.createElement('div');
    form.style.cssText = 'display:none;align-items:center;padding:8px;background-color:#f0fdf4;border-radius:4px;margin-top:8px;';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.style.marginRight = '8px';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'New Line Name';
    input.style.cssText = 'flex:1;padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:14px;';

    form.append(cb, input);

    createBtn.addEventListener('click', () => {
        createBtn.style.display = 'none';
        form.style.display = 'flex';
        input.focus();
    });

    container.append(createBtn, form);
    return { newLineCb: cb, newLineNameInput: input, container, toggleForm: createBtn };
}

function showError(el, msg) {
    el.textContent = msg;
    el.style.display = 'block';
}

