/**
 * Node context menu — right-click menu on nodes with actions for
 * adding/removing nodes and setting label preferences.
 */

import { showContextMenu } from '../context-menu.js';
import { getLinesAtNode, getExtendableLines, removeNode } from './node-operations.js';
import { showAddNodeModal, showExtendLinesModal, closeAddNodeModal } from './node-modals.js';

/**
 * Show context menu for a node.
 */
export function showNodeContextMenu(event, node, visualization) {
    event.preventDefault();
    closeAddNodeModal();

    const menuItems = [
        {
            label: 'Add Node Here',
            action: () => {
                const availableLines = getLinesAtNode(visualization, node.id);
                showAddNodeModal(visualization, node.id, availableLines);
            }
        }
    ];

    const extendableLines = getExtendableLines(visualization, node);
    if (extendableLines.length > 0) {
        menuItems.push({
            label: 'Add to Existing Line',
            action: () => showExtendLinesModal(visualization, node, extendableLines)
        });
    }

    menuItems.push({
        label: 'Set Label Position',
        action: () => showLabelPositionMenu(event, node, visualization)
    });

    menuItems.push({
        label: 'Set Line Label Position',
        action: () => showLineLabelPositionMenu(event, node, visualization)
    });

    menuItems.push({
        label: 'Set Segment Label Position',
        action: () => showSegmentLabelPositionMenu(event, node, visualization)
    });

    menuItems.push({
        label: 'Remove Node',
        action: () => {
            if (confirm(`Are you sure you want to remove the node "${node.label}"?`)) {
                removeNode(visualization, node.id);
            }
        }
    });

    const x = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
    const y = event.clientY ?? event.touches?.[0]?.clientY ?? 0;
    showContextMenu(x, y, menuItems);
}

// Helpers

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Label position submenus

function showLabelPositionMenu(event, node, visualization) {
    const directions = [
        { label: '↑', value: 'top' },
        { label: '↓', value: 'bottom' },
        { label: '←', value: 'left' },
        { label: '→', value: 'right' },
        { label: '↖', value: 'top-left' },
        { label: '↗', value: 'top-right' },
        { label: '↙', value: 'bottom-left' },
        { label: '↘', value: 'bottom-right' },
        { label: 'Clear Preference', value: null }
    ];

    const menuItems = directions.map(dir => ({
        label: dir.label,
        action: () => visualization.setManualLabelPreference(node.id, dir.value)
    }));

    const x = (event.clientX ?? event.pageX) + 10;
    const y = (event.clientY ?? event.pageY) + 10;
    showContextMenu(x, y, menuItems);
}

function showLineLabelPositionMenu(event, node, visualization) {
    const lines = getLinesAtNode(visualization, node.id);
    if (lines.length === 0) { alert("No lines pass through this node."); return; }

    const directions = [
        { label: '↑', value: 'top' },
        { label: '↓', value: 'bottom' },
        { label: '←', value: 'left' },
        { label: '→', value: 'right' },
        { label: 'Clear Preference', value: null }
    ];

    const x = (event.clientX ?? event.pageX) + 10;
    const y = (event.clientY ?? event.pageY) + 10;

    if (lines.length === 1) {
        const lineId = lines[0].lineId;
        showContextMenu(x, y, directions.map(dir => ({
            label: dir.label,
            action: () => visualization.setManualLineLabelPreference(lineId, dir.value)
        })));
    } else {
        showContextMenu(x, y, lines.map(line => {
            const hasPreference = visualization.manualLineLabelPreferences.has(line.lineId);
            const nameHtml = hasPreference
                ? `<strong>${escapeHtml(line.lineName)}</strong>`
                : escapeHtml(line.lineName);
            const dotHtml = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${line.color};margin-left:6px;vertical-align:middle;"></span>`;
            return {
                label: line.lineName,
                html: nameHtml + dotHtml,
                action: () => {
                    showContextMenu(x + 10, y + 10, directions.map(dir => ({
                        label: dir.label,
                        action: () => visualization.setManualLineLabelPreference(line.lineId, dir.value)
                    })));
                }
            };
        }));
    }
}

function showSegmentLabelPositionMenu(event, node, visualization) {
    const segmentNodes = visualization.getSegmentNodes(node.id);
    if (!segmentNodes || segmentNodes.length === 0) {
        alert("No segment found at this node.");
        return;
    }

    // Determine the majority label direction among the segment nodes
    const majorityDir = getMajorityLabelDirection(visualization, segmentNodes);

    const directions = [
        { label: '↑', value: 'top' },
        { label: '↓', value: 'bottom' },
        { label: '←', value: 'left' },
        { label: '→', value: 'right' },
        { label: '↖', value: 'top-left' },
        { label: '↗', value: 'top-right' },
        { label: '↙', value: 'bottom-left' },
        { label: '↘', value: 'bottom-right' },
        { label: 'Clear Preference', value: null }
    ];

    const menuItems = directions.map(dir => {
        const suffix = dir.value && dir.value === majorityDir
            ? ` (majority – ${segmentNodes.length} nodes)`
            : dir.value === null
                ? ` (${segmentNodes.length} nodes)`
                : '';
        return {
            label: dir.label + suffix,
            action: () => visualization.setSegmentLabelPreferences(segmentNodes, dir.value)
        };
    });

    const x = (event.clientX ?? event.pageX) + 10;
    const y = (event.clientY ?? event.pageY) + 10;
    showContextMenu(x, y, menuItems);
}

/**
 * Determine the most common label direction among a set of node IDs
 * by inspecting the current computed labels.
 */
function getMajorityLabelDirection(visualization, nodeIds) {
    if (!visualization.computedLabels || visualization.computedLabels.length === 0) return null;

    const nodeIdSet = new Set(nodeIds);
    const directionCounts = {};

    for (const lbl of visualization.computedLabels) {
        if (!nodeIdSet.has(lbl.Id)) continue;
        const dir = labelToDirection(lbl);
        if (dir) {
            directionCounts[dir] = (directionCounts[dir] || 0) + 1;
        }
    }

    let bestDir = null;
    let bestCount = 0;
    for (const [dir, count] of Object.entries(directionCounts)) {
        if (count > bestCount) {
            bestCount = count;
            bestDir = dir;
        }
    }
    return bestDir;
}

/**
 * Map a computed label's geometric properties back to a direction string.
 */
function labelToDirection(lbl) {
    const angle = lbl.Angle;
    const align = lbl.Align;

    // Center-aligned labels go above or below
    if (align === 'C') {
        if (Math.abs(angle) < 1) {
            return null; // Can't distinguish without more info, skip center labels
        }
        return null;
    }

    // L = text extends to the right of anchor, R = extends to the left
    if (Math.abs(angle) < 1) {
        // Horizontal
        return align === 'L' ? 'right' : 'left';
    } else if (angle < -20) {
        // -45° angle
        return align === 'L' ? 'top-right' : 'left';
    } else if (angle > 20) {
        // +45° angle
        return align === 'R' ? 'top-left' : 'right';
    }

    return null;
}

