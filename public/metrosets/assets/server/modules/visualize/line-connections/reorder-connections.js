/**
 * Reorder Connections — interactive experience for manually (and/or via TSP)
 * reordering the stations on a single metro line.
 */

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { solveTSPHeldKarp } from '../../support.js';
import provenanceTracker from '../../provenance.js';

// Module state

let active = false;                 // Is the reorder mode currently active?
let ctx = null;                     // Context object for the current session

//  Public API

export function isReorderConnectionsActive() {
    return active;
}

/**
 * Enter reorder-connections mode for the given metro line.
 */
export function startReorderConnections(visualization, hypersetId) {
    if (active) cancelReorderConnections();

    const nodeOrder = visualization.data.set_order?.[hypersetId] || [];
    if (nodeOrder.length === 0) return;

    const hypersetColors = visualization.generateHypersetColors();
    const lineColor = hypersetColors[hypersetId] || '#999';

    // Snapshot state so we can restore on cancel
    const originalOrder = [...nodeOrder];
    const originalLinks = visualization.links.map(l => ({
        sourceId: l.source.id,
        targetId: l.target.id
    }));

    // Determine which node IDs belong to this line
    const lineNodeIds = new Set(nodeOrder);

    ctx = {
        visualization,
        hypersetId,
        lineColor,
        lineNodeIds,
        originalOrder,
        originalLinks,
        // The user-chosen ordering so far (list of node IDs in chosen order)
        chosenOrder: [],
        // Undo/redo history stacks — each entry is a snapshot of chosenOrder
        undoHistory: [],
        redoHistory: [],
        // Temporary edges drawn between consecutively chosen nodes
        tempEdges: [],
        // UI elements
        overlay: null,
        numberGroup: null,
        tempEdgeGroup: null,
        // Simulation state to restore later
        simulationWasRunning: false,
    };

    active = true;

    // 0. Stop the force simulation so it doesn't redraw / reposition anything
    if (visualization.simulation) {
        // Check if alpha is still decaying (i.e. sim was "active")
        ctx.simulationWasRunning = visualization.simulation.alpha() > visualization.simulation.alphaMin();
        visualization.simulation.stop();
    }

    // 1. Dim everything except the target line's nodes
    dimOtherElements();

    // 2. Hide the metro line segments for this line (the coloured line)
    hideLineSegments();

    // 3. Hide existing graph edges that belong to this line
    hideLineEdges();

    // 4. Make the line's nodes clickable
    enableNodeClicking();

    // 5. Create SVG groups for numbers and temp edges
    ctx.tempEdgeGroup = ctx.visualization.zoomGroup
        .append('g').attr('class', 'reorder-temp-edges');
    ctx.numberGroup = ctx.visualization.zoomGroup
        .append('g').attr('class', 'reorder-numbers');

    // 6. Show action buttons overlay
    createButtonOverlay();
}

/**
 * Cancel the current reorder session — restores original graph state.
 */
export function cancelReorderConnections() {
    if (!active || !ctx) return;
    restoreOriginalState();
    teardown();
}

/**
 * Undo the last action during a reorder session.
 * If the last action was TSP, this undoes all TSP-added connections at once.
 * If the last action was a manual click, this undoes that single click.
 * Returns true if an undo was performed, false otherwise.
 */
export function undoReorderClick() {
    if (!active || !ctx || ctx.undoHistory.length === 0) return false;
    // Save current state for redo
    ctx.redoHistory.push([...ctx.chosenOrder]);
    // Restore previous state
    ctx.chosenOrder = ctx.undoHistory.pop();
    redrawAllNumbers();
    redrawAllTempEdges();
    updateButtons();
    return true;
}

/**
 * Redo a previously undone action during a reorder session.
 * Returns true if a redo was performed, false otherwise.
 */
export function redoReorderClick() {
    if (!active || !ctx || ctx.redoHistory.length === 0) return false;
    // Save current state for undo
    ctx.undoHistory.push([...ctx.chosenOrder]);
    // Restore the redo state
    ctx.chosenOrder = ctx.redoHistory.pop();
    redrawAllNumbers();
    redrawAllTempEdges();
    updateButtons();
    return true;
}

//  Internal — dimming / restoring

function dimOtherElements() {
    const vis = ctx.visualization;
    const ids = ctx.lineNodeIds;

    // Nodes: dim those NOT on this line
    vis.zoomGroup.selectAll('.node')
        .style('opacity', function (d) { return ids.has(d.id) ? 1 : 0.2; });

    // Edges: dim all (the line's edges will be hidden separately)
    vis.zoomGroup.selectAll('.link')
        .style('opacity', 0.2);

    // Ports: dim
    vis.zoomGroup.selectAll('.port')
        .style('opacity', function (d) {
            return d && d.node && ids.has(d.node.id) ? 0.6 : 0.2;
        });

    // Metro-line coloured segments: dim all
    vis.zoomGroup.selectAll('.metro-line-segment')
        .style('opacity', 0.2);

    // Labels: dim only if they were visible; if labels are disabled keep them at 0
    vis.zoomGroup.selectAll('.label')
        .style('opacity', vis.show_labels ? 0.2 : 0);

    // Cut nodes: dim
    vis.zoomGroup.selectAll('.cut-node')
        .style('opacity', 0.2);
}

function hideLineSegments() {
    // Hide the coloured metro-line segments that belong to this hypersetId
    ctx.visualization.zoomGroup.selectAll('.metro-line-segment')
        .filter(d => d && d.hypersetId === ctx.hypersetId)
        .style('display', 'none');
}

function hideLineEdges() {
    // We don't actually remove edges from the data; just visually hide the
    // underlying graph edges that connect consecutive stations on this line.
    const order = ctx.originalOrder;
    const edgePairs = new Set();
    for (let i = 0; i < order.length - 1; i++) {
        edgePairs.add(`${order[i]}|${order[i + 1]}`);
        edgePairs.add(`${order[i + 1]}|${order[i]}`);
    }

    ctx.visualization.zoomGroup.selectAll('.link')
        .filter(d => {
            const key = `${d.source.id}|${d.target.id}`;
            return edgePairs.has(key);
        })
        .style('display', 'none');
}

function restoreOpacity() {
    const vis = ctx.visualization;
    vis.zoomGroup.selectAll('.node').style('opacity', 1);
    vis.zoomGroup.selectAll('.link').style('opacity', 1).style('display', null);
    vis.zoomGroup.selectAll('.port').style('opacity', 1);
    vis.zoomGroup.selectAll('.metro-line-segment').style('opacity', null).style('display', null);
    vis.zoomGroup.selectAll('.label').style('opacity', vis.show_labels ? 1 : 0);
    vis.zoomGroup.selectAll('.cut-node').style('opacity', 1);
}

//  Internal — node clicking

function enableNodeClicking() {
    const vis = ctx.visualization;

    vis.zoomGroup.selectAll('.node')
        .filter(d => ctx.lineNodeIds.has(d.id))
        .style('cursor', 'pointer')
        .on('click.reorder', function (event, d) {
            event.stopPropagation();
            onNodeClicked(d);
        });
}

function disableNodeClicking() {
    ctx.visualization.zoomGroup.selectAll('.node')
        .on('click.reorder', null)
        .style('cursor', null);
}

function onNodeClicked(node) {
    if (!active || !ctx) return;
    // Don't allow double-selection
    if (ctx.chosenOrder.includes(node.id)) return;

    // A new manual click invalidates any redo history
    ctx.redoHistory.length = 0;

    // Save current state for undo (one snapshot per click)
    ctx.undoHistory.push([...ctx.chosenOrder]);

    ctx.chosenOrder.push(node.id);
    drawOrderNumber(node, ctx.chosenOrder.length);
    drawTempEdge();
    updateButtons();
}


// Internal — drawing helpers

function drawOrderNumber(node, number) {
    const vis = ctx.visualization;
    const useSchematic = vis.currentView === 'schematic' || vis.currentView === 'presentation';
    const xScale = useSchematic ? vis.xScale_s : vis.xScale;
    const yScale = useSchematic ? vis.yScale_s : vis.yScale;
    const coordX = useSchematic ? 'x_s' : 'x';
    const coordY = useSchematic ? 'y_s' : 'y';

    const x = xScale(node[coordX] ?? node.x);
    const y = yScale(node[coordY] ?? node.y);

    const g = ctx.numberGroup.append('g')
        .attr('class', 'reorder-number')
        .attr('data-node-id', node.id)
        .attr('transform', `translate(${x}, ${y})`);

    g.append('circle')
        .attr('r', 12)
        .attr('fill', ctx.lineColor)
        .attr('stroke', 'white')
        .attr('stroke-width', 2)
        .attr('opacity', 0.95);

    g.append('text')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('fill', 'white')
        .attr('font-weight', 'bold')
        .attr('font-size', '11px')
        .attr('pointer-events', 'none')
        .text(number);
}

function drawTempEdge() {
    if (ctx.chosenOrder.length < 2) return;

    const vis = ctx.visualization;
    const useSchematic = vis.currentView === 'schematic' || vis.currentView === 'presentation';
    const xScale = useSchematic ? vis.xScale_s : vis.xScale;
    const yScale = useSchematic ? vis.yScale_s : vis.yScale;
    const coordX = useSchematic ? 'x_s' : 'x';
    const coordY = useSchematic ? 'y_s' : 'y';

    const prevId = ctx.chosenOrder[ctx.chosenOrder.length - 2];
    const currId = ctx.chosenOrder[ctx.chosenOrder.length - 1];
    const prevNode = vis.nodes.find(n => n.id === prevId);
    const currNode = vis.nodes.find(n => n.id === currId);
    if (!prevNode || !currNode) return;

    const x1 = xScale(prevNode[coordX] ?? prevNode.x);
    const y1 = yScale(prevNode[coordY] ?? prevNode.y);
    const x2 = xScale(currNode[coordX] ?? currNode.x);
    const y2 = yScale(currNode[coordY] ?? currNode.y);

    ctx.tempEdgeGroup.append('line')
        .attr('class', 'reorder-temp-edge')
        .attr('x1', x1).attr('y1', y1)
        .attr('x2', x2).attr('y2', y2)
        .attr('stroke', ctx.lineColor)
        .attr('stroke-width', 3)
        .attr('stroke-dasharray', '6,3')
        .attr('opacity', 0.8);
}

function redrawAllTempEdges() {
    if (!ctx || !ctx.tempEdgeGroup) return;
    ctx.tempEdgeGroup.selectAll('*').remove();

    const vis = ctx.visualization;
    const useSchematic = vis.currentView === 'schematic' || vis.currentView === 'presentation';
    const xScale = useSchematic ? vis.xScale_s : vis.xScale;
    const yScale = useSchematic ? vis.yScale_s : vis.yScale;
    const coordX = useSchematic ? 'x_s' : 'x';
    const coordY = useSchematic ? 'y_s' : 'y';

    for (let i = 1; i < ctx.chosenOrder.length; i++) {
        const prevNode = vis.nodes.find(n => n.id === ctx.chosenOrder[i - 1]);
        const currNode = vis.nodes.find(n => n.id === ctx.chosenOrder[i]);
        if (!prevNode || !currNode) continue;

        const x1 = xScale(prevNode[coordX] ?? prevNode.x);
        const y1 = yScale(prevNode[coordY] ?? prevNode.y);
        const x2 = xScale(currNode[coordX] ?? currNode.x);
        const y2 = yScale(currNode[coordY] ?? currNode.y);

        ctx.tempEdgeGroup.append('line')
            .attr('class', 'reorder-temp-edge')
            .attr('x1', x1).attr('y1', y1)
            .attr('x2', x2).attr('y2', y2)
            .attr('stroke', ctx.lineColor)
            .attr('stroke-width', 3)
            .attr('stroke-dasharray', '6,3')
            .attr('opacity', 0.8);
    }
}

function redrawAllNumbers() {
    if (!ctx || !ctx.numberGroup) return;
    ctx.numberGroup.selectAll('*').remove();

    const vis = ctx.visualization;
    ctx.chosenOrder.forEach((nodeId, idx) => {
        const node = vis.nodes.find(n => n.id === nodeId);
        if (node) drawOrderNumber(node, idx + 1);
    });
}


//  Internal — button overlay


function createButtonOverlay() {
    // Remove any existing overlay
    d3.select('#reorder-connections-overlay').remove();

    const overlay = document.createElement('div');
    overlay.id = 'reorder-connections-overlay';
    overlay.style.cssText = `
        position: fixed; bottom: 24px; right: 24px; z-index: 10001;
        display: flex; flex-direction: column; gap: 10px; align-items: flex-end;
    `;

    // Info label
    const info = document.createElement('div');
    info.id = 'reorder-info-label';
    info.style.cssText = `
        background: rgba(255,255,255,0.95); padding: 8px 14px; border-radius: 6px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15); font-size: 13px; color: #374151;
        max-width: 320px; text-align: right;
    `;
    info.textContent = 'Click nodes in desired order to reorder the line.';
    overlay.appendChild(info);


    // TSP button
    const tspBtn = document.createElement('button');
    tspBtn.id = 'reorder-tsp-btn';
    tspBtn.textContent = 'Finish rest with TSP';
    tspBtn.style.cssText = btnStyle('#2563eb');
    tspBtn.disabled = true;
    tspBtn.addEventListener('click', onTSP);
    overlay.appendChild(tspBtn);

    // Reintegrate button
    const reintegrateBtn = document.createElement('button');
    reintegrateBtn.id = 'reorder-reintegrate-btn';
    reintegrateBtn.textContent = 'Reintegrate Line';
    reintegrateBtn.style.cssText = btnStyle('#16a34a');
    reintegrateBtn.disabled = true;
    reintegrateBtn.addEventListener('click', onReintegrate);
    overlay.appendChild(reintegrateBtn);

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'reorder-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = btnStyle('#dc2626');
    cancelBtn.addEventListener('click', () => cancelReorderConnections());
    overlay.appendChild(cancelBtn);

    document.body.appendChild(overlay);
    ctx.overlay = overlay;
}

function btnStyle(bg) {
    return `
        padding: 10px 20px; border: none; border-radius: 6px;
        color: white; font-size: 14px; font-weight: 600; cursor: pointer;
        background-color: ${bg}; box-shadow: 0 2px 8px rgba(0,0,0,0.18);
        transition: opacity 0.2s;
    `;
}

function updateButtons() {
    const total = ctx.lineNodeIds.size;
    const chosen = ctx.chosenOrder.length;
    const remaining = total - chosen;
    const allDone = remaining === 0;

    const tspBtn = document.getElementById('reorder-tsp-btn');
    const reintegrateBtn = document.getElementById('reorder-reintegrate-btn');
    const infoLabel = document.getElementById('reorder-info-label');


    if (tspBtn) {
        // TSP needs at least some remaining nodes and at least 0 chosen (can run from scratch too)
        tspBtn.disabled = allDone;
        tspBtn.style.opacity = allDone ? '0.5' : '1';
    }

    if (reintegrateBtn) {
        reintegrateBtn.disabled = !allDone;
        reintegrateBtn.style.opacity = allDone ? '1' : '0.5';
    }

    if (infoLabel) {
        if (allDone) {
            infoLabel.textContent = 'All nodes ordered! Click "Reintegrate Line" to apply.';
        } else {
            infoLabel.textContent = `${chosen} of ${total} nodes ordered. ${remaining} remaining.`;
        }
    }
}

function onTSP() {
    if (!active || !ctx) return;

    // Save current state for undo (TSP is a single undoable action)
    ctx.undoHistory.push([...ctx.chosenOrder]);
    ctx.redoHistory.length = 0;

    const vis = ctx.visualization;
    const useSchematic = vis.currentView === 'schematic' || vis.currentView === 'presentation';
    const coordX = useSchematic ? 'x_s' : 'x';
    const coordY = useSchematic ? 'y_s' : 'y';

    // Collect remaining (un-chosen) node IDs
    const remaining = [...ctx.lineNodeIds].filter(id => !ctx.chosenOrder.includes(id));
    if (remaining.length === 0) return;

    const hasChain = ctx.chosenOrder.length > 0;

    // Build the full node list for the TSP
    // Order: [ ...chosenOrder, ...remaining ]
    // This way chain nodes come first, and we know their indices.
    const allNodes = [...ctx.chosenOrder, ...remaining];
    const n = allNodes.length;
    const nodeObjs = allNodes.map(id => vis.nodes.find(nd => nd.id === id));

    // Trivial case
    if (remaining.length === 1 && !hasChain) {
        ctx.chosenOrder.push(remaining[0]);
        redrawAllNumbers();
        redrawAllTempEdges();
        updateButtons();
        return;
    }

    // Build full Euclidean distance matrix
    const cost = Array.from({ length: n }, () => Array(n).fill(-1));
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if (i === j) continue;
            const ni = nodeObjs[i];
            const nj = nodeObjs[j];
            if (!ni || !nj) continue;
            const dx = (ni[coordX] ?? ni.x) - (nj[coordX] ?? nj.x);
            const dy = (ni[coordY] ?? ni.y) - (nj[coordY] ?? nj.y);
            cost[i][j] = Math.sqrt(dx * dx + dy * dy);
        }
    }

    // Cut the graph according to the user's chain
    if (hasChain) {
        const chainLen = ctx.chosenOrder.length;
        // Indices 0 .. chainLen-1 are chain nodes.
        // startIdx = 0, endIdx = chainLen - 1, middle = 1 .. chainLen-2

        // For every chain node, cut all connections except:
        //   - its immediate chain predecessor / successor (within the chain)
        //   - if it is the start or end of the chain, keep connections to remaining nodes
        for (let ci = 0; ci < chainLen; ci++) {
            const isStart = (ci === 0);
            const isEnd   = (ci === chainLen - 1);
            const isMiddle = !isStart && !isEnd;

            for (let j = 0; j < n; j++) {
                if (ci === j) continue;

                const jIsChain = j < chainLen;

                if (jIsChain) {
                    // Within the chain: only allow edges between immediate neighbours
                    const isNeighbour = (j === ci - 1) || (j === ci + 1);
                    if (!isNeighbour) {
                        cost[ci][j] = -1;
                        cost[j][ci] = -1;
                    }
                } else {
                    // j is a remaining (non-chain) node
                    if (isMiddle) {
                        // Middle chain nodes cannot connect to any outside node
                        cost[ci][j] = -1;
                        cost[j][ci] = -1;
                    }
                    // Start and End keep their connections to remaining nodes (already set)
                }
            }
        }
    }

    // Solve TSP
    let permutation;
    if (n <= 20) {
        const result = solveTSPHeldKarp(cost, n);
        permutation = result.permutation;
        if (!result.optimal || permutation.length === 0) {
            permutation = nearestNeighbourTSP(cost, n);
        }
    } else {
        permutation = nearestNeighbourTSP(cost, n);
    }

    // Convert the TSP cycle into a path
    // Cut the cycle at the longest edge to open it into a linear path.
    let maxDist = -1;
    let cutIdx = 0;
    for (let i = 0; i < permutation.length; i++) {
        const a = permutation[i];
        const b = permutation[(i + 1) % permutation.length];
        // Use original Euclidean distance for cutting (not the modified cost which may be -1)
        const na = nodeObjs[a];
        const nb = nodeObjs[b];
        let d = 0;
        if (na && nb) {
            const dx = (na[coordX] ?? na.x) - (nb[coordX] ?? nb.x);
            const dy = (na[coordY] ?? na.y) - (nb[coordY] ?? nb.y);
            d = Math.sqrt(dx * dx + dy * dy);
        }
        if (d > maxDist) {
            maxDist = d;
            cutIdx = i;
        }
    }
    const path = [
        ...permutation.slice(cutIdx + 1),
        ...permutation.slice(0, cutIdx + 1)
    ];

    // Map indices back to node IDs
    ctx.chosenOrder = path.map(idx => allNodes[idx]);

    redrawAllNumbers();
    redrawAllTempEdges();
    updateButtons();
}

/**
 * Simple nearest-neighbour TSP heuristic. Returns a permutation (cycle).
 */
function nearestNeighbourTSP(cost, n, startIdx = 0) {
    const visited = new Set();
    const path = [startIdx];
    visited.add(startIdx);

    let current = startIdx;
    while (visited.size < n) {
        let bestDist = Infinity;
        let bestNext = -1;
        for (let j = 0; j < n; j++) {
            if (visited.has(j)) continue;
            const d = cost[current][j];
            if (d >= 0 && d < bestDist) {
                bestDist = d;
                bestNext = j;
            }
        }
        if (bestNext === -1) break;
        path.push(bestNext);
        visited.add(bestNext);
        current = bestNext;
    }
    return path;
}


// Internal — reintegrate


function onReintegrate() {
    if (!active || !ctx) return;
    if (ctx.chosenOrder.length !== ctx.lineNodeIds.size) return;

    const vis = ctx.visualization;
    const hypersetId = ctx.hypersetId;
    const newOrder = [...ctx.chosenOrder];
    const oldOrder = [...ctx.originalOrder];

    // 1. Write the new station order into data
    vis.data.set_order[hypersetId] = newOrder;

    // 2. Rebuild edges: remove old line edges, add new ones
    rebuildLineEdges(vis, oldOrder, newOrder);

    // 3. Track in provenance for undo/redo
    provenanceTracker.trackReorderConnections(hypersetId, oldOrder, newOrder);

    // 4. Teardown UI (restores opacity, removes overlays, etc.)
    teardown();

    // 5. Mark as dirty so the pipeline knows about manual edits
    vis.isDirty = true;
    vis.hasManualEdits = true;

    // 6. Re-run the full schematization pipeline (port assignment + LP solve)
    //    so that ports get proper usedCount values (grey instead of white) and
    //    edges get octolinear bend data for correct schematic layout.
    vis.data.useInitialCoordinates = true;
    vis.refreshVisualization('port_assignment')
        .then(() => {
            vis.drawLegend();
            if (vis.show_labels) {
                vis.invalidateLabels();
                vis.drawLabels();
            }
        })
        .catch(err => {
            console.error('[REINTEGRATE] refreshVisualization failed:', err);
            // Fallback: at least do a basic redraw so the UI isn't broken
            vis.preprocess();
            vis.draw();
            vis.refreshPortData();
            vis.refreshEdges();
            if (vis.show_lines) vis.drawMetrolines();
            vis.drawLegend();
            if (vis.show_labels) {
                vis.invalidateLabels();
                vis.drawLabels();
            }
        });
}

function rebuildLineEdges(vis, oldOrder, newOrder) {
    const findEdge = (aId, bId) => vis.links.find(l =>
        (l.source.id === aId && l.target.id === bId) ||
        (l.source.id === bId && l.target.id === aId)
    );

    const removeEdge = (edge) => {
        const idx = vis.links.indexOf(edge);
        if (idx > -1) vis.links.splice(idx, 1);
        if (vis.data.links) {
            const di = vis.data.links.findIndex(l => {
                const sid = typeof l.source === 'object' ? l.source.id : l.source;
                const tid = typeof l.target === 'object' ? l.target.id : l.target;
                return (sid === edge.source.id && tid === edge.target.id) ||
                       (sid === edge.target.id && tid === edge.source.id);
            });
            if (di > -1) vis.data.links.splice(di, 1);
        }
    };

    const createEdgeIfNeeded = (aId, bId) => {
        if (findEdge(aId, bId)) return; // already exists
        const srcNode = vis.nodes.find(n => n.id === aId);
        const tgtNode = vis.nodes.find(n => n.id === bId);
        if (!srcNode || !tgtNode) return;
        vis.links.push({ source: srcNode, target: tgtNode });
        if (vis.data.links) {
            vis.data.links.push({ source: aId, target: bId });
        }
    };

    // Determine which edges are used ONLY by this line (and can be removed)
    // Build a map of edge -> set of lines that use it
    const edgeLines = new Map();
    for (const [lineId, stations] of Object.entries(vis.data.set_order)) {
        if (lineId === ctx.hypersetId) continue; // skip the line being reordered
        for (let i = 0; i < stations.length - 1; i++) {
            const key1 = `${stations[i]}|${stations[i + 1]}`;
            const key2 = `${stations[i + 1]}|${stations[i]}`;
            edgeLines.set(key1, (edgeLines.get(key1) || 0) + 1);
            edgeLines.set(key2, (edgeLines.get(key2) || 0) + 1);
        }
    }

    // Remove old line edges that are NOT shared with other lines
    for (let i = 0; i < oldOrder.length - 1; i++) {
        const key = `${oldOrder[i]}|${oldOrder[i + 1]}`;
        if (!edgeLines.has(key)) {
            const edge = findEdge(oldOrder[i], oldOrder[i + 1]);
            if (edge) removeEdge(edge);
        }
    }

    // Add new line edges
    for (let i = 0; i < newOrder.length - 1; i++) {
        createEdgeIfNeeded(newOrder[i], newOrder[i + 1]);
    }

    // Refresh simulation link force if present
    if (vis.simulation) {
        const linkForce = vis.simulation.force('link');
        if (linkForce) linkForce.links(vis.links);
    }
}


// Internal — restore original state (for cancel)


function restoreOriginalState() {
    const vis = ctx.visualization;
    // Restore original station order
    vis.data.set_order[ctx.hypersetId] = [...ctx.originalOrder];
}


//  Internal — teardown


function teardown() {
    if (!ctx) return;
    const vis = ctx.visualization;
    const shouldRestartSim = ctx.simulationWasRunning;

    // Remove SVG groups
    vis.zoomGroup.selectAll('.reorder-temp-edges').remove();
    vis.zoomGroup.selectAll('.reorder-numbers').remove();

    // Remove button overlay
    d3.select('#reorder-connections-overlay').remove();

    // Disable node-click handlers
    disableNodeClicking();

    // Restore opacity
    restoreOpacity();

    // Redraw metro lines & edges
    vis.draw();
    vis.refreshEdges();
    if (vis.show_lines) vis.drawMetrolines();

    // Restart the simulation if it was running before we stopped it
    if (vis.simulation && shouldRestartSim) {
        vis.simulation.alpha(0.3).alphaTarget(0).restart();
    }

    active = false;
    ctx = null;
}


