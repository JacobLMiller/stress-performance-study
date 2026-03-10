/**
 * Station reorder logic — pure data-manipulation functions for computing
 * new node positions when stations are reordered on a metro line.
 * No DOM manipulation; used by the line-connections modal.
 */

/**
 * Check if a node belongs to only one metro line.
 */
export function isNodeOnSingleLine(visualization, nodeId) {
    const setOrder = visualization.data.set_order || {};
    let lineCount = 0;
    for (const lineStations of Object.values(setOrder)) {
        if (lineStations.includes(nodeId)) {
            lineCount++;
            if (lineCount > 1) return false;
        }
    }
    return lineCount === 1;
}

/**
 * Calculate a new position for a moved node based on its new neighbors in the line.
 * @returns {{x: number, y: number, swapPositions?: Array}|null}
 */
export function calculateNewNodePosition(visualization, movedNodeId, newIndex, lineStations) {
    const useSchematic = visualization.currentView === 'schematic';
    const coordX = useSchematic ? 'x_s' : 'x';
    const coordY = useSchematic ? 'y_s' : 'y';

    const movedNode = visualization.nodes.find(n => n.id === movedNodeId);
    if (!movedNode) return null;

    const prevStationId = newIndex > 0 ? lineStations[newIndex - 1] : null;
    const nextStationId = newIndex < lineStations.length - 1 ? lineStations[newIndex + 1] : null;
    const prevNode = prevStationId ? visualization.nodes.find(n => n.id === prevStationId) : null;
    const nextNode = nextStationId ? visualization.nodes.find(n => n.id === nextStationId) : null;

    if (prevNode && nextNode) {
        if (isNodeOnSingleLine(visualization, movedNodeId)) {
            return calculatePushAndSwapPositions(visualization, movedNodeId, newIndex, lineStations, coordX, coordY);
        }
        return {
            x: (prevNode[coordX] + nextNode[coordX]) / 2,
            y: (prevNode[coordY] + nextNode[coordY]) / 2
        };
    }

    if (prevNode && !nextNode) {
        return extendFromEnd(visualization, lineStations, newIndex, coordX, coordY, prevNode, -2, +1);
    }

    if (!prevNode && nextNode) {
        return extendFromEnd(visualization, lineStations, newIndex, coordX, coordY, nextNode, +2, -1);
    }

    return null;
}

/**
 * Calculate positions using push-and-swap approach.
 * Pushes existing nodes along the line direction to make room for the moved node.
 */
function calculatePushAndSwapPositions(visualization, movedNodeId, newIndex, lineStations, coordX, coordY) {
    const lineLength = lineStations.length;
    const distanceToEnd = lineLength - 1 - newIndex;
    const pushTowardsEnd = distanceToEnd <= newIndex;

    const swapPositions = [];

    if (pushTowardsEnd) {
        const result = pushTowards(visualization, movedNodeId, newIndex, lineStations, coordX, coordY, 'end', swapPositions);
        if (result) return result;
    } else {
        const result = pushTowards(visualization, movedNodeId, newIndex, lineStations, coordX, coordY, 'start', swapPositions);
        if (result) return result;
    }

    // Fallback to midpoint
    const prev = visualization.nodes.find(n => n.id === lineStations[newIndex - 1]);
    const next = visualization.nodes.find(n => n.id === lineStations[newIndex + 1]);
    if (prev && next) {
        return {
            x: (prev[coordX] + next[coordX]) / 2,
            y: (prev[coordY] + next[coordY]) / 2,
            swapPositions: []
        };
    }
    return null;
}

function pushTowards(visualization, movedNodeId, newIndex, lineStations, coordX, coordY, direction, swapPositions) {
    const lineLength = lineStations.length;

    if (direction === 'end') {
        const lastIndex = lineLength - 1;
        const lastNodeId = lineStations[lastIndex];
        const secondLastNodeId = lineLength >= 2 ? lineStations[lastIndex - 1] : null;
        const lastNode = visualization.nodes.find(n => n.id === lastNodeId);
        const secondLastNode = secondLastNodeId ? visualization.nodes.find(n => n.id === secondLastNodeId) : null;

        let dx = 50, dy = 0;
        if (lastNode && secondLastNode) {
            dx = lastNode[coordX] - secondLastNode[coordX];
            dy = lastNode[coordY] - secondLastNode[coordY];
            if (dx === 0 && dy === 0) { dx = 50; dy = 0; }
        }

        if (lastNode && lastNodeId !== movedNodeId) {
            swapPositions.push({ nodeId: lastNodeId, x: lastNode[coordX] + dx, y: lastNode[coordY] + dy });
        }

        for (let i = lastIndex - 1; i >= newIndex; i--) {
            const currentNodeId = lineStations[i];
            if (currentNodeId === movedNodeId) continue;
            const nextNode = visualization.nodes.find(n => n.id === lineStations[i + 1]);
            if (nextNode) {
                swapPositions.push({ nodeId: currentNodeId, x: nextNode[coordX], y: nextNode[coordY] });
            }
        }

        const nodeAtTargetId = lineStations[newIndex + 1];
        const nodeAtTarget = nodeAtTargetId ? visualization.nodes.find(n => n.id === nodeAtTargetId) : null;
        if (nodeAtTarget) {
            return { x: nodeAtTarget[coordX], y: nodeAtTarget[coordY], swapPositions };
        }
    } else {
        const firstNodeId = lineStations[0];
        const secondNodeId = lineLength >= 2 ? lineStations[1] : null;
        const firstNode = visualization.nodes.find(n => n.id === firstNodeId);
        const secondNode = secondNodeId ? visualization.nodes.find(n => n.id === secondNodeId) : null;

        let dx = -50, dy = 0;
        if (firstNode && secondNode) {
            dx = firstNode[coordX] - secondNode[coordX];
            dy = firstNode[coordY] - secondNode[coordY];
            if (dx === 0 && dy === 0) { dx = -50; dy = 0; }
        }

        if (firstNode && firstNodeId !== movedNodeId) {
            swapPositions.push({ nodeId: firstNodeId, x: firstNode[coordX] + dx, y: firstNode[coordY] + dy });
        }

        for (let i = 1; i <= newIndex; i++) {
            const currentNodeId = lineStations[i];
            if (currentNodeId === movedNodeId) continue;
            const prevNode = visualization.nodes.find(n => n.id === lineStations[i - 1]);
            if (prevNode) {
                swapPositions.push({ nodeId: currentNodeId, x: prevNode[coordX], y: prevNode[coordY] });
            }
        }

        const nodeAtTargetId = lineStations[newIndex - 1];
        const nodeAtTarget = nodeAtTargetId ? visualization.nodes.find(n => n.id === nodeAtTargetId) : null;
        if (nodeAtTarget) {
            return { x: nodeAtTarget[coordX], y: nodeAtTarget[coordY], swapPositions };
        }
    }

    return null;
}

/**
 * Update edge connections for a moved node — removes old edges, creates new ones,
 * and closes gaps left by the move.
 */
export function updateEdgeConnections(visualization, movedNodeId, oldIndex, newIndex, oldLineStations, newLineStations) {
    const movedNode = visualization.nodes.find(n => n.id === movedNodeId);
    if (!movedNode) return;

    const oldPrevId = oldIndex > 0 ? oldLineStations[oldIndex - 1] : null;
    const oldNextId = oldIndex < oldLineStations.length - 1 ? oldLineStations[oldIndex + 1] : null;
    const newPrevId = newIndex > 0 ? newLineStations[newIndex - 1] : null;
    const newNextId = newIndex < newLineStations.length - 1 ? newLineStations[newIndex + 1] : null;

    const findEdge = (a, b) => visualization.links.find(l =>
        (l.source.id === a.id && l.target.id === b.id) ||
        (l.source.id === b.id && l.target.id === a.id)
    );

    const removeEdge = (edge) => {
        const idx = visualization.links.indexOf(edge);
        if (idx > -1) visualization.links.splice(idx, 1);
        if (visualization.data.links) {
            const di = visualization.data.links.findIndex(l => {
                const sid = typeof l.source === 'object' ? l.source.id : l.source;
                const tid = typeof l.target === 'object' ? l.target.id : l.target;
                return (sid === edge.source.id && tid === edge.target.id) ||
                       (sid === edge.target.id && tid === edge.source.id);
            });
            if (di > -1) visualization.data.links.splice(di, 1);
        }
    };

    const createEdge = (src, tgt) => {
        const newEdge = { source: src, target: tgt };
        visualization.links.push(newEdge);
        if (visualization.data.links) {
            visualization.data.links.push({ source: src.id, target: tgt.id });
        }
        return newEdge;
    };

    // Remove old edges
    [oldPrevId, oldNextId].forEach(neighborId => {
        if (!neighborId) return;
        const neighbor = visualization.nodes.find(n => n.id === neighborId);
        if (neighbor) {
            const edge = findEdge(movedNode, neighbor);
            if (edge) removeEdge(edge);
        }
    });

    // Close gap between old neighbors
    if (oldPrevId && oldNextId) {
        const prevN = visualization.nodes.find(n => n.id === oldPrevId);
        const nextN = visualization.nodes.find(n => n.id === oldNextId);
        if (prevN && nextN && !findEdge(prevN, nextN)) createEdge(prevN, nextN);
    }

    // Create new edges to new neighbors
    [newPrevId, newNextId].forEach(neighborId => {
        if (!neighborId) return;
        const neighbor = visualization.nodes.find(n => n.id === neighborId);
        if (neighbor && !findEdge(movedNode, neighbor)) createEdge(movedNode, neighbor);
    });

    // Remove direct edge between new neighbors (node is now between them)
    if (newPrevId && newNextId) {
        const prevN = visualization.nodes.find(n => n.id === newPrevId);
        const nextN = visualization.nodes.find(n => n.id === newNextId);
        if (prevN && nextN) {
            const edge = findEdge(prevN, nextN);
            if (edge) removeEdge(edge);
        }
    }

    if (visualization.simulation) {
        visualization.simulation.force('link').initialize(visualization.links);
        visualization.simulation.alpha(0.3).restart();
    }
    if (visualization.refreshEdges) visualization.refreshEdges();
}

/**
 * Update a node's position (and optional swap positions) then refresh layout.
 */
export async function updateNodePositionAndLayout(visualization, nodeId, newX, newY, swapPositions = []) {
    const useSchematic = visualization.currentView === 'schematic';

    const updatePos = (id, x, y) => {
        const node = visualization.nodes.find(n => n.id === id);
        if (!node) return;
        if (useSchematic) { node.x_s = x; node.y_s = y; }
        node.x = x;
        node.y = y;

        const orig = visualization.data.nodes.find(n => n.id === id);
        if (orig) {
            orig.x = x; orig.y = y;
            orig.x_original = x; orig.y_original = y;
            if (useSchematic) { orig.x_s = x; orig.y_s = y; }
        }
    };

    for (const swap of swapPositions) updatePos(swap.nodeId, swap.x, swap.y);
    updatePos(nodeId, newX, newY);

    visualization.isDirty = true;
    visualization.hasManualEdits = true;
    visualization.draw();
    if (visualization.show_lines) visualization.drawMetrolines();

    if (visualization.hasSchematized) {
        try {
            await visualization.refreshVisualization('node_drag');
            visualization.nodes.forEach(n => {
                const orig = visualization.data.nodes.find(on => on.id === n.id);
                if (orig?.x_s !== undefined && orig?.y_s !== undefined) {
                    n.x_s = orig.x_s;
                    n.y_s = orig.y_s;
                }
            });
            if (visualization.currentView === 'initial' && visualization.simulation) {
                visualization.simulation.alphaTarget(0.05).restart();
            }
        } catch (error) {
            console.error('Error re-running schematization after node move:', error);
        }
    } else if (visualization.simulation && visualization.currentView === 'initial') {
        visualization.simulation.alphaTarget(0.3).restart();
        setTimeout(() => visualization.simulation.alphaTarget(0), 300);
    }
}

// Internal helper

function extendFromEnd(visualization, lineStations, newIndex, coordX, coordY, neighbor, secondOffset, dirMul) {
    const secondIdx = newIndex + secondOffset;
    const secondId = (secondIdx >= 0 && secondIdx < lineStations.length) ? lineStations[secondIdx] : null;
    const secondNode = secondId ? visualization.nodes.find(n => n.id === secondId) : null;

    if (secondNode) {
        const dx = neighbor[coordX] - secondNode[coordX];
        const dy = neighbor[coordY] - secondNode[coordY];
        if (Math.sqrt(dx * dx + dy * dy) > 0) {
            return { x: neighbor[coordX] + dx, y: neighbor[coordY] + dy };
        }
    }

    return { x: neighbor[coordX] + dirMul * 50, y: neighbor[coordY] };
}

