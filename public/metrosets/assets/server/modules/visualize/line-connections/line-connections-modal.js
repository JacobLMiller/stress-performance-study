/**
 * Modal for viewing and editing metro line connections.
 * Shows station order for a metro line with drag-and-drop reordering.
 */

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import {
    calculateNewNodePosition,
    updateEdgeConnections,
    updateNodePositionAndLayout
} from './station-reorder-logic.js';

let currentModal = null;
let currentModalContext = null;

/**
 * Update the position of overlay elements to match current node positions.
 * Called externally (e.g., from simulation tick) when nodes move.
 */
export function updatePositionNumbersOverlay(visualization) {
    if (!currentModalContext) return;

    if (visualization.currentView === 'presentation') {
        removePositionNumbersFromNodes();
        return;
    }

    const { line } = currentModalContext;
    if (!line || !visualization) return;

    const useSchematic = visualization.currentView === 'schematic' || visualization.currentView === 'presentation';
    const xScale = useSchematic ? visualization.xScale_s : visualization.xScale;
    const yScale = useSchematic ? visualization.yScale_s : visualization.yScale;
    const coordX = useSchematic ? 'x_s' : 'x';
    const coordY = useSchematic ? 'y_s' : 'y';

    if (d3.select(".line-position-numbers").empty()) {
        const { lineColor } = currentModalContext;
        addPositionNumbersToNodes(visualization, line, lineColor);
        return;
    }

    d3.selectAll('.position-number').each(function () {
        const element = d3.select(this);
        const stationId = element.attr('data-station-id');
        const node = visualization.nodes.find(n => n.id === stationId);
        if (node) {
            element.attr('transform', `translate(${xScale(node[coordX])}, ${yScale(node[coordY])})`);
        }
    });
}

/** Check if the line connections modal is currently open. */
export function isLineConnectionsModalOpen() {
    return currentModal !== null;
}

/** Add position number circles to nodes on the map for the selected line. */
function addPositionNumbersToNodes(visualization, line, lineColor) {
    removePositionNumbersFromNodes();
    if (visualization.currentView === 'presentation') return;

    const useSchematic = visualization.currentView === 'schematic';
    const xScale = useSchematic ? visualization.xScale_s : visualization.xScale;
    const yScale = useSchematic ? visualization.yScale_s : visualization.yScale;
    const coordX = useSchematic ? 'x_s' : 'x';
    const coordY = useSchematic ? 'y_s' : 'y';

    const positionGroup = visualization.zoomGroup.append("g").attr("class", "line-position-numbers");

    line.stations.forEach((stationId, index) => {
        const node = visualization.nodes.find(n => n.id === stationId);
        if (!node) return;

        const x = xScale(node[coordX]);
        const y = yScale(node[coordY]);

        const g = positionGroup.append("g")
            .attr("class", "position-number")
            .attr("data-station-id", stationId)
            .attr("transform", `translate(${x}, ${y})`);

        g.append("circle").attr("class", "position-circle")
            .attr("r", 10).attr("fill", lineColor)
            .attr("stroke", "white").attr("stroke-width", 2).attr("opacity", 0.9);

        g.append("text")
            .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
            .attr("fill", "white").attr("font-weight", "bold")
            .attr("font-size", "11px").attr("pointer-events", "none")
            .text(index + 1);
    });
}

function removePositionNumbersFromNodes() {
    d3.selectAll(".line-position-numbers").remove();
}

/**
 * Show the line connections modal for a given hyperset.
 */
export function showLineConnectionsModal(visualization, hypersetId) {
    closeLineConnectionsModal();
    if (!hypersetId) return;

    const modal = document.createElement('div');
    modal.className = 'line-connections-modal';
    modal.style.cssText = `
        position:fixed;top:0;right:0;bottom:0;background-color:white;padding:20px;
        box-shadow:-4px 0 20px rgba(0,0,0,0.3);z-index:10000;width:400px;max-width:90vw;
        overflow-y:auto;animation:slideInRight 0.3s ease-out;
    `;

    ensureAnimationStyles();

    const nodeOrder = visualization.data.set_order?.[hypersetId] || [];
    const lineData = visualization.data.sets?.[hypersetId] || null;
    const hypersetColors = visualization.generateHypersetColors();
    const lineColor = hypersetColors[hypersetId] || '#999';
    const lineName = lineData?.label || hypersetId;

    const line = { id: hypersetId, name: lineName, color: lineColor, stations: nodeOrder };

    currentModalContext = { visualization, line, lineColor, hypersetId };
    addPositionNumbersToNodes(visualization, line, lineColor);

    modal.innerHTML = `
        <div style="margin-bottom:15px;border-bottom:2px solid #e5e7eb;padding-bottom:10px;position:relative;">
            <button id="close-modal-x" style="position:absolute;top:0;right:0;width:32px;height:32px;border:none;background:none;color:#6b7280;font-size:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:4px;" title="Close">×</button>
            <h2 style="margin:0;font-size:20px;font-weight:bold;color:#1f2937;padding-right:40px;">${lineName} - Station Connections</h2>
            <div style="margin-top:8px;font-size:14px;color:#6b7280;">View and edit how stations are connected on this metro line</div>
        </div>
        <div id="lines-list" style="margin-bottom:15px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:10px;border-top:1px solid #e5e7eb;padding-top:15px;">
            <button id="close-modal" style="padding:8px 16px;background-color:#3b82f6;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;">Close</button>
        </div>
    `;

    const linesList = modal.querySelector('#lines-list');
    const lineCard = document.createElement('div');
    lineCard.style.cssText = 'margin-bottom:12px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;';

    // Header
    const lineHeader = document.createElement('div');
    lineHeader.style.cssText = 'display:flex;align-items:center;padding:12px;background-color:#f9fafb;user-select:none;';
    lineHeader.innerHTML = `
        <div style="width:40px;height:6px;background-color:${lineColor};margin-right:12px;border-radius:3px;"></div>
        <div style="flex:1;font-size:15px;font-weight:600;color:#1f2937;">${lineName}</div>
        <div style="font-size:13px;color:#6b7280;">${line.stations.length} stations</div>
    `;

    // Stations list with drag-and-drop
    const stationsList = document.createElement('div');
    stationsList.className = 'stations-list';
    stationsList.style.cssText = 'padding:12px;background-color:white;border-top:1px solid #e5e7eb;';

    let draggedElement = null, draggedIndex = null, placeholder = null, targetDropIndex = null;

    const createPlaceholder = () => {
        const ph = document.createElement('div');
        ph.className = 'drop-placeholder';
        ph.style.cssText = `height:44px;margin-bottom:4px;background:linear-gradient(90deg,${lineColor}22,${lineColor}11);border:2px dashed ${lineColor};border-radius:4px;transition:all 0.2s ease;`;
        return ph;
    };

    const calculateDropIndex = () => {
        if (!placeholder?.parentNode) return draggedIndex;
        let count = 0;
        for (const child of stationsList.children) {
            if (child === placeholder) break;
            if (child.classList.contains('station-item') && child !== draggedElement) count++;
        }
        return count;
    };

    const handleDrop = () => {
        if (!draggedElement || targetDropIndex === null || targetDropIndex === draggedIndex) return;

        const dropIndex = targetDropIndex;
        const movedStationId = line.stations[draggedIndex];
        const oldIndex = draggedIndex;
        const oldLineStations = [...line.stations];

        const [movedStation] = line.stations.splice(draggedIndex, 1);
        line.stations.splice(dropIndex, 0, movedStation);
        visualization.data.set_order[hypersetId] = [...line.stations];

        updateEdgeConnections(visualization, movedStationId, oldIndex, dropIndex, oldLineStations, line.stations);

        const newPosition = calculateNewNodePosition(visualization, movedStationId, dropIndex, line.stations);

        renderStations();
        addPositionNumbersToNodes(visualization, line, lineColor);

        if (visualization.show_lines) visualization.drawMetrolines();

        if (newPosition) {
            updateNodePositionAndLayout(visualization, movedStationId, newPosition.x, newPosition.y, newPosition.swapPositions || [])
                .then(() => addPositionNumbersToNodes(visualization, line, lineColor));
        }
    };

    const renderStations = () => {
        stationsList.innerHTML = '';

        line.stations.forEach((stationId, index) => {
            const stationNode = visualization.nodes.find(n => n.id === stationId);
            const stationName = stationNode ? (stationNode.label || stationId) : stationId;

            const item = document.createElement('div');
            item.draggable = true;
            item.dataset.stationId = stationId;
            item.dataset.index = index;
            item.className = 'station-item';
            item.style.cssText = 'display:flex;align-items:center;padding:8px;margin-bottom:4px;background-color:#f9fafb;border-radius:4px;font-size:14px;cursor:grab;transition:transform 0.2s,box-shadow 0.2s,opacity 0.2s;border:1px solid transparent;';

            item.innerHTML = `
                <div style="width:28px;height:28px;background-color:${lineColor};color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-right:10px;font-weight:bold;font-size:12px;flex-shrink:0;">${index + 1}</div>
                <div style="flex:1;color:#1f2937;">${stationName}</div>
                <div style="color:#9ca3af;font-size:18px;margin-left:8px;">⋮⋮</div>
            `;

            item.addEventListener('dragstart', (e) => {
                draggedElement = item;
                draggedIndex = parseInt(item.dataset.index);
                targetDropIndex = null;
                placeholder = createPlaceholder();

                setTimeout(() => {
                    item.style.opacity = '0.4';
                    item.style.transform = 'scale(1.02)';
                    item.style.boxShadow = '0 8px 25px rgba(0,0,0,0.15)';
                    item.style.cursor = 'grabbing';
                }, 0);

                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', stationId);

                d3.selectAll('.position-number')
                    .filter(function () { return d3.select(this).attr('data-station-id') === stationId; })
                    .select('.position-circle')
                    .attr('stroke', 'red').attr('stroke-width', 3);
            });

            item.addEventListener('dragend', () => {
                if (draggedElement) {
                    const sid = draggedElement.dataset.stationId;
                    draggedElement.style.opacity = '1';
                    draggedElement.style.transform = 'scale(1)';
                    draggedElement.style.boxShadow = 'none';
                    draggedElement.style.cursor = 'grab';

                    if (placeholder?.parentNode) placeholder.parentNode.removeChild(placeholder);
                    placeholder = null;

                    stationsList.querySelectorAll('.station-item').forEach(el => { el.style.marginTop = '0'; el.style.marginBottom = '4px'; });

                    draggedElement = null;
                    draggedIndex = null;
                    targetDropIndex = null;

                    d3.selectAll('.position-number')
                        .filter(function () { return d3.select(this).attr('data-station-id') === sid; })
                        .select('.position-circle')
                        .attr('stroke', 'white').attr('stroke-width', 2);
                }
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (!draggedElement || item === draggedElement) return;

                const rect = item.getBoundingClientRect();
                if (placeholder?.parentNode) placeholder.parentNode.removeChild(placeholder);

                if (e.clientY < rect.top + rect.height / 2) {
                    item.parentNode.insertBefore(placeholder, item);
                } else {
                    item.parentNode.insertBefore(placeholder, item.nextSibling);
                }
                targetDropIndex = calculateDropIndex();
            });

            item.addEventListener('dragenter', (e) => {
                e.preventDefault();
                if (item !== draggedElement) item.style.borderColor = lineColor;
            });

            item.addEventListener('dragleave', (e) => {
                if (!item.contains(e.relatedTarget)) item.style.borderColor = 'transparent';
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                item.style.borderColor = 'transparent';
                handleDrop();
            });

            stationsList.appendChild(item);
        });
    };

    stationsList.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    stationsList.addEventListener('drop', (e) => { e.preventDefault(); handleDrop(); });

    renderStations();

    lineCard.appendChild(lineHeader);
    lineCard.appendChild(stationsList);
    linesList.appendChild(lineCard);

    modal.querySelector('#close-modal').addEventListener('click', closeLineConnectionsModal);
    const closeX = modal.querySelector('#close-modal-x');
    closeX.addEventListener('click', closeLineConnectionsModal);
    closeX.addEventListener('mouseenter', () => { closeX.style.backgroundColor = '#f3f4f6'; closeX.style.color = '#1f2937'; });
    closeX.addEventListener('mouseleave', () => { closeX.style.backgroundColor = 'transparent'; closeX.style.color = '#6b7280'; });

    document.body.appendChild(modal);
    currentModal = { modal };
}

export function closeLineConnectionsModal() {
    if (currentModal) {
        removePositionNumbersFromNodes();
        if (currentModal.modal.parentNode) currentModal.modal.parentNode.removeChild(currentModal.modal);
        currentModal = null;
    }
    currentModalContext = null;
}

function ensureAnimationStyles() {
    if (!document.getElementById('line-connections-modal-styles')) {
        const style = document.createElement('style');
        style.id = 'line-connections-modal-styles';
        style.textContent = '@keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }';
        document.head.appendChild(style);
    }
}

