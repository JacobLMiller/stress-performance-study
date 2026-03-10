/**
 * Node graph operations — add, remove, and extend nodes on the metro map.
 * Pure data-mutation logic with minimal DOM interaction.
 */

import { Port, DIRECTIONS } from '../../schematize/port.js';

/**
 * Get all lines (hypersets) that pass through a specific node.
 */
export function getLinesAtNode(visualization, nodeId) {
    const setOrder = visualization.data.set_order || {};
    const hypersetColors = visualization.generateHypersetColors();
    const sets = visualization.data.sets || {};
    const lines = [];

    for (const [lineId, lineStations] of Object.entries(setOrder)) {
        const nodeIndex = lineStations.indexOf(nodeId);
        if (nodeIndex !== -1) {
            lines.push({
                lineId,
                lineName: sets[lineId]?.label || lineId,
                color: hypersetColors[lineId] || '#999',
                indexInLine: nodeIndex
            });
        }
    }
    return lines;
}

/**
 * Generate a unique node ID.
 */
export function generateUniqueNodeId(visualization) {
    const existingIds = new Set(visualization.nodes.map(n => n.id));
    let counter = 1;
    let newId = `new_node_${counter}`;
    while (existingIds.has(newId)) {
        counter++;
        newId = `new_node_${counter}`;
    }
    return newId;
}

/**
 * Find valid insertion candidates around a clicked node.
 */
export function getInsertionCandidates(visualization, clickedNodeId, selectedLineIds) {
    const setOrder = visualization.data.set_order || {};
    const candidates = [];

    for (const lineId of selectedLineIds) {
        const stations = setOrder[lineId];
        if (!stations) continue;
        const idx = stations.indexOf(clickedNodeId);
        if (idx === -1) continue;

        const prev = idx > 0 ? stations[idx - 1] : null;
        const next = idx < stations.length - 1 ? stations[idx + 1] : null;

        if (next) candidates.push({ type: 'forward', anchorNodeId: clickedNodeId, betweenA: clickedNodeId, betweenB: next });
        if (prev) candidates.push({ type: 'backward', anchorNodeId: prev, betweenA: prev, betweenB: clickedNodeId });
        if (!next) candidates.push({ type: 'terminal-forward', anchorNodeId: clickedNodeId, betweenA: clickedNodeId, betweenB: null });
        if (!prev) candidates.push({ type: 'terminal-backward', anchorNodeId: null, betweenA: clickedNodeId, betweenB: null });
    }

    const seen = new Set();
    return candidates.filter(c => {
        const key = `${c.type}:${c.anchorNodeId ?? 'null'}:${c.betweenA}:${c.betweenB ?? 'null'}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Validate that the selected lines can be inserted around the clicked node.
 */
export function validateLineSelection(visualization, clickedNodeId, selectedLineIds) {
    if (!selectedLineIds || selectedLineIds.length === 0) {
        return { valid: false, reason: 'Please select at least one line.', canCreateTerminal: false, chosenAnchorNodeId: null, chosenMode: null };
    }

    const candidates = getInsertionCandidates(visualization, clickedNodeId, selectedLineIds);
    const checked = [];

    for (const cand of candidates) {
        if (cand.type === 'terminal-forward') {
            checked.push({ candidate: cand, isTerminal: true, anchorNodeId: cand.anchorNodeId });
            continue;
        }
        if (cand.type === 'terminal-backward') {
            checked.push({ candidate: cand, isTerminal: true, anchorNodeId: clickedNodeId });
            continue;
        }
        if (!cand.betweenB) continue;
        checked.push({ candidate: cand, isTerminal: false, anchorNodeId: cand.anchorNodeId });
    }

    // Single line → prefer terminal extension from clicked node
    if (selectedLineIds.length === 1) {
        const terminalFromClicked = checked.find(c => !c.reasonIfInvalid && c.isTerminal && c.anchorNodeId === clickedNodeId);
        if (terminalFromClicked) {
            return { valid: true, reason: '', canCreateTerminal: true, chosenAnchorNodeId: clickedNodeId, chosenMode: terminalFromClicked.candidate.type };
        }
    }

    const validMiddle = checked.find(c => !c.reasonIfInvalid && !c.isTerminal);
    if (validMiddle) {
        return { valid: true, reason: '', canCreateTerminal: false, chosenAnchorNodeId: validMiddle.anchorNodeId, chosenMode: validMiddle.candidate.type };
    }

    const validTerminal = checked.find(c => !c.reasonIfInvalid && c.isTerminal);
    if (validTerminal) {
        return { valid: true, reason: '', canCreateTerminal: true, chosenAnchorNodeId: validTerminal.anchorNodeId, chosenMode: validTerminal.candidate.type };
    }

    const reasons = checked.map(c => c.reasonIfInvalid).filter(Boolean);
    return {
        valid: false,
        reason: reasons.length ? reasons[0] : 'No valid insertion is possible with the current selection near this node.',
        canCreateTerminal: false, chosenAnchorNodeId: null, chosenMode: null
    };
}

/**
 * Get lines that can be extended to the given node.
 */
export function getExtendableLines(visualization, node) {
    const candidates = [];
    const setOrder = visualization.data.set_order || {};
    const sets = visualization.data.sets || {};
    const hypersetColors = visualization.generateHypersetColors();

    const myLines = new Set();
    Object.entries(setOrder).forEach(([lid, stations]) => {
        if (stations.includes(node.id)) myLines.add(lid);
    });

    const neighbors = new Set();
    visualization.links.forEach(link => {
        const s = link.source.id || link.source;
        const t = link.target.id || link.target;
        if (s === node.id) neighbors.add(t);
        else if (t === node.id) neighbors.add(s);
    });

    neighbors.forEach(neighborId => {
        Object.entries(setOrder).forEach(([lineId, stations]) => {
            if (myLines.has(lineId)) return;
            const isStart = stations[0] === neighborId;
            const isEnd = stations[stations.length - 1] === neighborId;
            if (!isStart && !isEnd) return;

            candidates.push({
                lineId,
                lineName: sets[lineId]?.label || lineId,
                color: hypersetColors[lineId] || '#999',
                neighborId,
                type: isEnd ? 'append' : 'prepend'
            });
        });
    });

    const unique = new Map();
    candidates.forEach(c => { if (!unique.has(c.lineId)) unique.set(c.lineId, c); });
    return Array.from(unique.values());
}

/**
 * Add a new node to the visualization after the given anchor node.
 */
export async function addNode(visualization, afterNodeId, selectedLines, nodeName, isTerminal = false, newLineInfo = null) {
    const newNodeId = generateUniqueNodeId(visualization);
    const nodeLabel = nodeName || newNodeId;

    const afterNode = visualization.nodes.find(n => n.id === afterNodeId);
    if (!afterNode) return;

    // Compute line context
    let lineStations = [], afterIndex = -1, isStart = false, isEnd = true, isPrepend = false;
    let nextNodeId = null, prevNodeId = null, nextNode = null, prevNode = null;

    if (selectedLines.length > 0) {
        const firstLine = selectedLines[0];
        lineStations = visualization.data.set_order[firstLine.lineId];
        afterIndex = lineStations.indexOf(afterNodeId);
        isStart = afterIndex === 0;
        isEnd = afterIndex === lineStations.length - 1;
        isPrepend = isTerminal && isStart && !isEnd;
        nextNodeId = afterIndex < lineStations.length - 1 ? lineStations[afterIndex + 1] : null;
        prevNodeId = afterIndex > 0 ? lineStations[afterIndex - 1] : null;
        nextNode = nextNodeId ? visualization.nodes.find(n => n.id === nextNodeId) : null;
        prevNode = prevNodeId ? visualization.nodes.find(n => n.id === prevNodeId) : null;
    }

    const isSegmentSharedWithUnselected = (n1, n2) => {
        if (!n1 || !n2) return false;
        for (const [lid, stations] of Object.entries(visualization.data.set_order)) {
            if (selectedLines.some(sl => sl.lineId === lid)) continue;
            for (let i = 0; i < stations.length - 1; i++) {
                if ((stations[i] === n1 && stations[i + 1] === n2) || (stations[i] === n2 && stations[i + 1] === n1)) return true;
            }
        }
        return false;
    };

    const OFFSET = 50;

    // Calculate initial position
    const { x: initialX, y: initialY } = calcPosition(afterNode, 'x', 'y', nextNode, prevNode, isPrepend, nextNodeId, prevNodeId, afterNodeId, isSegmentSharedWithUnselected, visualization, OFFSET);

    // Calculate schematic position
    const afterX_s = afterNode.x_s ?? afterNode.x;
    const afterY_s = afterNode.y_s ?? afterNode.y;
    const schematicAfter = { x: afterX_s, y: afterY_s, x_s: afterX_s, y_s: afterY_s };
    const schematicNext = nextNode ? { x: nextNode.x_s ?? nextNode.x, y: nextNode.y_s ?? nextNode.y, x_s: nextNode.x_s ?? nextNode.x, y_s: nextNode.y_s ?? nextNode.y } : null;
    const schematicPrev = prevNode ? { x: prevNode.x_s ?? prevNode.x, y: prevNode.y_s ?? prevNode.y, x_s: prevNode.x_s ?? prevNode.x, y_s: prevNode.y_s ?? prevNode.y } : null;
    const { x: schematicX, y: schematicY } = calcPosition(schematicAfter, 'x', 'y', schematicNext, schematicPrev, isPrepend, nextNodeId, prevNodeId, afterNodeId, isSegmentSharedWithUnselected, visualization, OFFSET);

    // Create node
    const newNode = {
        id: newNodeId, label: nodeLabel,
        x: initialX, y: initialY,
        x_original: initialX, y_original: initialY,
        x_s: schematicX, y_s: schematicY
    };

    // Create ports
    newNode.ports = [];
    newNode.portById = [];
    for (let dirId = 0; dirId < DIRECTIONS.length; dirId++) {
        const dir = DIRECTIONS[dirId];
        let angle = Math.atan2(dir.y, dir.x);
        if (angle < 0) angle += 2 * Math.PI;
        angle = angle * 180 / Math.PI;
        const port = new Port(`${newNode.id}-${dir.x}-${dir.y}`, dir.x, dir.y, angle, newNode, dirId);
        port.usedCount = 0;
        port.edges = [];
        newNode.ports.push(port);
        newNode.portById[dirId] = port;
    }
    newNode.portsByAngle = [...newNode.ports].sort((a, b) => a.angle - b.angle);

    // Add to data
    visualization.nodes.push(newNode);
    if (visualization.data.nodes) visualization.data.nodes.push(newNode);

    // Create new line if requested
    if (newLineInfo) {
        const newLineId = `line_${Date.now()}`;
        if (!visualization.data.sets) visualization.data.sets = {};
        if (!visualization.data.set_order) visualization.data.set_order = {};
        visualization.data.sets[newLineId] = { label: newLineInfo.name, elements: [afterNodeId, newNodeId] };
        visualization.data.set_order[newLineId] = [afterNodeId, newNodeId];
        if (!visualization.data.set_colors) visualization.data.set_colors = {};
        const randomColor = '#' + Math.floor(Math.random() * 16777215).toString(16);
        visualization.data.set_colors[newLineId] = randomColor;
        selectedLines.push({ lineId: newLineId, lineName: newLineInfo.name, color: randomColor });
    }

    // Insert node into selected lines' station orders
    for (const line of selectedLines) {
        const stations = visualization.data.set_order[line.lineId];
        if (stations.includes(newNodeId)) continue;
        const idx = stations.indexOf(afterNodeId);
        const lineIsStart = idx === 0;
        const lineIsEnd = idx === stations.length - 1;

        if (isTerminal && lineIsStart && !lineIsEnd) {
            stations.splice(0, 0, newNodeId);
        } else if (idx !== -1) {
            stations.splice(idx + 1, 0, newNodeId);
        }

        if (visualization.data.sets?.[line.lineId]?.elements) {
            if (!visualization.data.sets[line.lineId].elements.includes(newNodeId)) {
                visualization.data.sets[line.lineId].elements.push(newNodeId);
            }
        }
    }

    // Process edges
    processEdgesForNewNode(visualization, selectedLines, newNodeId, isTerminal);

    // Update DOM & simulation
    addNodeToDOM(visualization, newNode);

    visualization.isDirty = true;
    if (visualization.simulation) {
        visualization.simulation.nodes(visualization.nodes);
        visualization.simulation.force('link').links(visualization.links);
        visualization.simulation.alpha(0.3).restart();
    }

    visualization.applyDragBehavior();
    if (visualization.refreshPortData) visualization.refreshPortData();
    if (visualization.refreshEdges) visualization.refreshEdges();
    visualization.draw();
    if (visualization.show_lines) visualization.drawMetrolines();

    try {
        await visualization.refreshVisualization('node_addition');
    } catch (error) {
        console.error('Error re-running schematization after node addition:', error);
    }
}

/**
 * Remove a node from the visualization and update all related data structures.
 */
export async function removeNode(visualization, nodeId) {
    const nodeToRemove = visualization.nodes.find(n => n.id === nodeId);
    if (!nodeToRemove) return;

    // Remove from lines and connect neighbors
    const setOrder = visualization.data.set_order || {};
    for (const lineStations of Object.values(setOrder)) {
        const idx = lineStations.indexOf(nodeId);
        if (idx === -1) continue;
        const prevId = idx > 0 ? lineStations[idx - 1] : null;
        const nextId = idx < lineStations.length - 1 ? lineStations[idx + 1] : null;
        lineStations.splice(idx, 1);

        if (prevId && nextId) {
            const prevNode = visualization.nodes.find(n => n.id === prevId);
            const nextNode = visualization.nodes.find(n => n.id === nextId);
            if (prevNode && nextNode) {
                const exists = visualization.links.find(l =>
                    (l.source.id === prevId && l.target.id === nextId) ||
                    (l.source.id === nextId && l.target.id === prevId)
                );
                if (!exists) {
                    visualization.links.push({ source: prevNode, target: nextNode });
                    if (visualization.data.links) visualization.data.links.push({ source: prevId, target: nextId });
                }
            }
        }
    }

    // Remove connected edges
    const edgesToRemove = visualization.links.filter(l => l.source.id === nodeId || l.target.id === nodeId);
    edgesToRemove.forEach(edge => {
        const idx = visualization.links.indexOf(edge);
        if (idx > -1) visualization.links.splice(idx, 1);
        if (visualization.data.links) {
            const di = visualization.data.links.findIndex(l => {
                const sid = typeof l.source === 'object' ? l.source.id : l.source;
                const tid = typeof l.target === 'object' ? l.target.id : l.target;
                return sid === nodeId || tid === nodeId;
            });
            if (di > -1) visualization.data.links.splice(di, 1);
        }
    });

    // Remove from sets membership
    if (visualization.data.sets) {
        for (const setData of Object.values(visualization.data.sets)) {
            if (setData.elements?.length) {
                const idx = setData.elements.indexOf(nodeId);
                if (idx > -1) setData.elements.splice(idx, 1);
            }
        }
    }

    // Remove empty lines
    for (const [lineId, stations] of Object.entries(setOrder)) {
        if (stations.length === 0) delete visualization.data.set_order[lineId];
    }

    // Remove node
    const nodeIdx = visualization.nodes.findIndex(n => n.id === nodeId);
    if (nodeIdx > -1) visualization.nodes.splice(nodeIdx, 1);
    if (visualization.data.nodes) {
        const di = visualization.data.nodes.findIndex(n => n.id === nodeId);
        if (di > -1) visualization.data.nodes.splice(di, 1);
    }

    // Update simulation
    if (visualization.simulation) {
        visualization.simulation.nodes(visualization.nodes);
        visualization.simulation.force('link').links(visualization.links);
        visualization.simulation.alpha(0.3).restart();
    }

    // Remove DOM elements
    visualization.zoomGroup.selectAll(".node").filter(d => d.id === nodeId).remove();
    visualization.zoomGroup.selectAll(".label").filter(d => d.id === nodeId).remove();
    visualization.zoomGroup.selectAll(".port").filter(d => d.node?.id === nodeId).remove();

    visualization.isDirty = true;
    if (visualization.refreshEdges) visualization.refreshEdges();
    if (visualization.show_lines) visualization.drawMetrolines();

    if (visualization.hasSchematized) {
        try { await visualization.refreshVisualization('node_removal'); }
        catch (error) { console.error('Error re-running schematization after node removal:', error); }
    }
}

/**
 * Perform extension of selected lines to the node.
 */
export async function extendLinesToNode(visualization, node, selectedCandidates) {
    for (const cand of selectedCandidates) {
        const stations = visualization.data.set_order[cand.lineId];
        if (!stations) continue;

        if (cand.type === 'append') stations.push(node.id);
        else if (cand.type === 'prepend') stations.unshift(node.id);

        if (visualization.data.sets[cand.lineId]?.elements) {
            if (!visualization.data.sets[cand.lineId].elements.includes(node.id)) {
                visualization.data.sets[cand.lineId].elements.push(node.id);
            }
        }
    }

    visualization.isDirty = true;
    if (visualization.show_lines) visualization.drawMetrolines();

    try { await visualization.refreshVisualization('line_extension'); }
    catch (error) { console.error('Error re-running schematization after line extension:', error); }
}

// ── Internal helpers ─────────────────────────────────────────────

function calcPosition(afterNode, coordX, coordY, nextNode, prevNode, isPrepend, nextNodeId, prevNodeId, afterNodeId, isShared, visualization, OFFSET) {
    if (nextNode && !isPrepend) {
        if (isShared(afterNodeId, nextNodeId)) {
            const midX = (afterNode[coordX] + nextNode[coordX]) / 2;
            const midY = (afterNode[coordY] + nextNode[coordY]) / 2;
            const dx = nextNode[coordX] - afterNode[coordX];
            const dy = nextNode[coordY] - afterNode[coordY];
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            return { x: midX - (dy / len) * OFFSET, y: midY + (dx / len) * OFFSET };
        }
        return { x: (afterNode[coordX] + nextNode[coordX]) / 2, y: (afterNode[coordY] + nextNode[coordY]) / 2 };
    }

    if (prevNode || (isPrepend && nextNode)) {
        const ref = isPrepend ? nextNode : prevNode;
        const refId = isPrepend ? nextNodeId : prevNodeId;
        const dx = afterNode[coordX] - ref[coordX];
        const dy = afterNode[coordY] - ref[coordY];
        let angle = Math.atan2(dy, dx);

        const neighbors = visualization.links
            .map(l => {
                const s = l.source.id || l.source;
                const t = l.target.id || l.target;
                return s === afterNodeId ? t : (t === afterNodeId ? s : null);
            })
            .filter(nid => nid && nid !== refId)
            .map(nid => visualization.nodes.find(n => n.id === nid))
            .filter(n => n);

        const blocked = neighbors.some(n => {
            const ndx = (n[coordX] ?? n.x) - afterNode[coordX];
            const ndy = (n[coordY] ?? n.y) - afterNode[coordY];
            let diff = Math.abs(Math.atan2(ndy, ndx) - angle);
            if (diff > Math.PI) diff = 2 * Math.PI - diff;
            return diff < 0.2;
        });

        if (blocked) angle += Math.PI / 4;
        return { x: afterNode[coordX] + Math.cos(angle) * OFFSET, y: afterNode[coordY] + Math.sin(angle) * OFFSET };
    }

    // Fallback: extend in opposite direction of existing neighbors
    const connectedLinks = visualization.links.filter(l =>
        l.source.id === afterNodeId || l.target.id === afterNodeId
    );

    let angle = 0;
    if (connectedLinks.length > 0) {
        let sumX = 0, sumY = 0;
        connectedLinks.forEach(l => {
            const other = l.source.id === afterNodeId ? l.target : l.source;
            const ox = other[coordX] ?? other.x;
            const oy = other[coordY] ?? other.y;
            const dx = ox - afterNode[coordX];
            const dy = oy - afterNode[coordY];
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            sumX += dx / len;
            sumY += dy / len;
        });
        angle = Math.atan2(-sumY, -sumX);
    }

    return { x: afterNode[coordX] + Math.cos(angle) * OFFSET, y: afterNode[coordY] + Math.sin(angle) * OFFSET };
}

function processEdgesForNewNode(visualization, selectedLines, newNodeId, isTerminal) {
    const edgesToProcess = new Map();

    for (const line of selectedLines) {
        const stations = visualization.data.set_order[line.lineId];
        const idx = stations.indexOf(newNodeId);
        if (idx === -1) continue;

        const prev = idx > 0 ? stations[idx - 1] : null;
        const next = idx < stations.length - 1 ? stations[idx + 1] : null;

        if (prev) {
            const key = [prev, newNodeId].sort().join('-');
            if (!edgesToProcess.has(key)) edgesToProcess.set(key, { node1: prev, node2: newNodeId, lines: [] });
            edgesToProcess.get(key).lines.push(line.lineId);
        }
        if (next) {
            const key = [newNodeId, next].sort().join('-');
            if (!edgesToProcess.has(key)) edgesToProcess.set(key, { node1: newNodeId, node2: next, lines: [] });
            edgesToProcess.get(key).lines.push(line.lineId);
        }
    }

    // Remove old edges that are no longer needed (middle insertions only)
    if (!isTerminal) {
        for (const line of selectedLines) {
            const stations = visualization.data.set_order[line.lineId];
            const idx = stations.indexOf(newNodeId);
            if (idx === -1) continue;
            const prev = idx > 0 ? stations[idx - 1] : null;
            const next = idx < stations.length - 1 ? stations[idx + 1] : null;

            if (prev && next) {
                let stillUsed = false;
                for (const [, checkStations] of Object.entries(visualization.data.set_order)) {
                    for (let i = 0; i < checkStations.length - 1; i++) {
                        if ((checkStations[i] === prev && checkStations[i + 1] === next) ||
                            (checkStations[i] === next && checkStations[i + 1] === prev)) {
                            stillUsed = true;
                            break;
                        }
                    }
                    if (stillUsed) break;
                }

                if (!stillUsed) {
                    const edgeIdx = visualization.links.findIndex(l =>
                        (l.source.id === prev && l.target.id === next) ||
                        (l.source.id === next && l.target.id === prev)
                    );
                    if (edgeIdx > -1) {
                        visualization.links.splice(edgeIdx, 1);
                        if (visualization.data.fixedAssignments) {
                            visualization.data.fixedAssignments.delete(`${prev}-${next}`);
                            visualization.data.fixedAssignments.delete(`${next}-${prev}`);
                        }
                        if (visualization.data.links) {
                            const di = visualization.data.links.findIndex(l => {
                                const sid = typeof l.source === 'object' ? l.source.id : l.source;
                                const tid = typeof l.target === 'object' ? l.target.id : l.target;
                                return (sid === prev && tid === next) || (sid === next && tid === prev);
                            });
                            if (di > -1) visualization.data.links.splice(di, 1);
                        }
                    }
                }
            }
        }
    }

    // Create new edges
    for (const info of edgesToProcess.values()) {
        const n1 = visualization.nodes.find(n => n.id === info.node1);
        const n2 = visualization.nodes.find(n => n.id === info.node2);
        if (!n1 || !n2) continue;

        const exists = visualization.links.find(l =>
            (l.source.id === info.node1 && l.target.id === info.node2) ||
            (l.source.id === info.node2 && l.target.id === info.node1)
        );
        if (!exists) {
            visualization.links.push({ source: n1, target: n2 });
            if (visualization.data.links) visualization.data.links.push({ source: info.node1, target: info.node2 });
        }
    }
}

function addNodeToDOM(visualization, newNode) {
    const useSchematic = visualization.currentView === 'schematic';
    const xs = useSchematic ? visualization.xScale_s : visualization.xScale;
    const ys = useSchematic ? visualization.yScale_s : visualization.yScale;
    const nodeX = useSchematic ? newNode.x_s : newNode.x;
    const nodeY = useSchematic ? newNode.y_s : newNode.y;

    const nodeGroup = visualization.zoomGroup.select("g.nodes");
    nodeGroup.append("circle")
        .datum(newNode)
        .attr("class", "node")
        .attr("id", newNode.id)
        .attr("cx", xs(nodeX))
        .attr("cy", ys(nodeY))
        .attr("r", visualization.nodeRadius || 8)
        .style("fill", "#69b3a2")
        .style("stroke", "#333")
        .style("stroke-width", 2)
        .on("mouseenter", () => visualization.eventHandlers.handleNodeHover(newNode))
        .on("mouseleave", visualization.eventHandlers.handleMouseLeave)
        .on("contextmenu", (event) => visualization.eventHandlers.handleNodeContextMenu(event, newNode));

    const labelGroup = visualization.zoomGroup.select("g.labels");
    labelGroup.append("text")
        .datum(newNode)
        .attr("class", "label")
        .text(newNode.label)
        .attr("x", xs(nodeX) + 2 * (visualization.nodeRadius || 8))
        .attr("y", ys(nodeY))
        .attr("text-anchor", "left")
        .attr("alignment-baseline", "middle")
        .style("font-family", "Arial, sans-serif")
        .style("font-size", "10px")
        .style("pointer-events", "none")
        .style("opacity", visualization.show_labels ? 1 : 0);
}

