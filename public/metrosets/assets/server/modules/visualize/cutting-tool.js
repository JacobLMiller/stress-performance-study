/**
 * Cutting Tool - Insert dummy nodes at cut intersections
 * Allows users to draw a cut line and insert invisible dummy nodes
 * at all intersections with metro lines to spread them apart
 */

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { Port, DIRECTIONS } from '../schematize/port.js';
import provenanceTracker from '../provenance.js';

let isCuttingToolActive = false;
let cutStartPoint = null;
let cutLine = null;
let cuttingVisualization = null;

/**
 * Check if the cutting tool is currently active
 */
export function isCuttingToolEnabled() {
    return isCuttingToolActive;
}

/**
 * Enable or disable the cutting tool
 */
export function setCuttingToolEnabled(enabled, visualization) {
    isCuttingToolActive = enabled;
    cuttingVisualization = enabled ? visualization : null;

    if (enabled) {
        setupCuttingTool(visualization);
    } else {
        cleanupCuttingTool(visualization);
    }
}

/**
 * Set up the cutting tool interaction handlers
 */
function setupCuttingTool(visualization) {
    const svg = visualization.svg;

    // Change cursor to crosshair when cutting tool is active
    svg.style("cursor", "crosshair");

    // Store original zoom behavior filter
    visualization._originalZoomFilter = visualization.zoom.filter();

    // Disable zoom while cutting tool is active
    visualization.zoom.filter(() => false);

    // Set up mouse event handlers for drawing the cut line
    svg.on("mousedown.cutting", function(event) {
        if (!isCuttingToolActive) return;

        event.preventDefault();
        event.stopPropagation();

        const [x, y] = d3.pointer(event, visualization.zoomGroup.node());
        cutStartPoint = { x, y };

        // Create the preview cut line
        cutLine = visualization.zoomGroup.append("line")
            .attr("class", "cut-line-preview")
            .attr("x1", x)
            .attr("y1", y)
            .attr("x2", x)
            .attr("y2", y)
            .style("stroke", "#ff4444")
            .style("stroke-width", 3)
            .style("stroke-dasharray", "8,4")
            .style("pointer-events", "none");
    });

    svg.on("mousemove.cutting", function(event) {
        if (!isCuttingToolActive || !cutStartPoint || !cutLine) return;

        const [x, y] = d3.pointer(event, visualization.zoomGroup.node());
        cutLine
            .attr("x2", x)
            .attr("y2", y);
    });

    svg.on("mouseup.cutting", function(event) {
        if (!isCuttingToolActive || !cutStartPoint || !cutLine) return;

        const [x, y] = d3.pointer(event, visualization.zoomGroup.node());
        const cutEndPoint = { x, y };

        // Only process if the cut line has some length
        const cutLength = Math.sqrt(
            Math.pow(cutEndPoint.x - cutStartPoint.x, 2) +
            Math.pow(cutEndPoint.y - cutStartPoint.y, 2)
        );

        if (cutLength > 10) {
            processCutLine(visualization, cutStartPoint, cutEndPoint);
        }

        // Clean up the preview line
        cutLine.remove();
        cutLine = null;
        cutStartPoint = null;
    });
}

/**
 * Clean up cutting tool handlers
 */
function cleanupCuttingTool(visualization) {
    if (!visualization) return;

    const svg = visualization.svg;

    // Restore cursor
    svg.style("cursor", null);

    // Restore zoom behavior
    if (visualization._originalZoomFilter) {
        visualization.zoom.filter(visualization._originalZoomFilter);
    }

    // Remove event handlers
    svg.on("mousedown.cutting", null);
    svg.on("mousemove.cutting", null);
    svg.on("mouseup.cutting", null);

    // Clean up any preview line
    if (cutLine) {
        cutLine.remove();
        cutLine = null;
    }
    cutStartPoint = null;
}

/**
 * Find the intersection point between two line segments
 * Returns the intersection point or null if no intersection
 */
function findIntersection(p1, p2, p3, p4) {
    const x1 = p1.x, y1 = p1.y;
    const x2 = p2.x, y2 = p2.y;
    const x3 = p3.x, y3 = p3.y;
    const x4 = p4.x, y4 = p4.y;

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

    if (Math.abs(denom) < 1e-10) {
        return null; // Lines are parallel
    }

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

    // Check if intersection is within both line segments
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        return {
            x: x1 + t * (x2 - x1),
            y: y1 + t * (y2 - y1),
            t: t, // Parameter along cut line
            u: u  // Parameter along edge
        };
    }

    return null;
}

/**
 * Process the cut line and insert dummy nodes at intersections
 */
async function processCutLine(visualization, startPoint, endPoint) {
    console.log('[CUT] Processing cut line from', startPoint, 'to', endPoint);

    // Get the current coordinate system
    const useSchematic = visualization.currentView === 'schematic' || visualization.currentView === 'presentation';
    const xScale = useSchematic ? visualization.xScale_s : visualization.xScale;
    const yScale = useSchematic ? visualization.yScale_s : visualization.yScale;
    const coordX = useSchematic ? 'x_s' : 'x';
    const coordY = useSchematic ? 'y_s' : 'y';

    // Convert cut points from screen to data coordinates
    const cutStart = {
        x: xScale.invert(startPoint.x),
        y: yScale.invert(startPoint.y)
    };
    const cutEnd = {
        x: xScale.invert(endPoint.x),
        y: yScale.invert(endPoint.y)
    };

    console.log('[CUT] Cut line in data coordinates:', cutStart, cutEnd);

    // Find all edge intersections
    const intersections = [];
    const processedEdges = new Set();

    for (const link of visualization.links) {
        const sourceId = link.source.id;
        const targetId = link.target.id;

        // Avoid processing same edge twice
        const edgeKey = [sourceId, targetId].sort().join('-');
        if (processedEdges.has(edgeKey)) continue;
        processedEdges.add(edgeKey);

        const sourceNode = link.source;
        const targetNode = link.target;

        const edgeStart = {
            x: sourceNode[coordX] ?? sourceNode.x,
            y: sourceNode[coordY] ?? sourceNode.y
        };
        const edgeEnd = {
            x: targetNode[coordX] ?? targetNode.x,
            y: targetNode[coordY] ?? targetNode.y
        };

        // Check for bend points in schematic view
        if (useSchematic && link.bend) {
            // Edge has a bend - check both segments
            const bendPoint = { x: link.bend.x, y: link.bend.y };

            // First segment: source to bend
            const int1 = findIntersection(cutStart, cutEnd, edgeStart, bendPoint);
            if (int1) {
                intersections.push({
                    sourceId,
                    targetId,
                    point: { x: int1.x, y: int1.y },
                    u: int1.u * 0.5, // Adjust u for first half
                    link,
                    segment: 'first',
                    bendPoint
                });
            }

            // Second segment: bend to target
            const int2 = findIntersection(cutStart, cutEnd, bendPoint, edgeEnd);
            if (int2) {
                intersections.push({
                    sourceId,
                    targetId,
                    point: { x: int2.x, y: int2.y },
                    u: 0.5 + int2.u * 0.5, // Adjust u for second half
                    link,
                    segment: 'second',
                    bendPoint
                });
            }
        } else {
            // Straight edge
            const intersection = findIntersection(cutStart, cutEnd, edgeStart, edgeEnd);
            if (intersection) {
                intersections.push({
                    sourceId,
                    targetId,
                    point: { x: intersection.x, y: intersection.y },
                    u: intersection.u,
                    link
                });
            }
        }
    }

    console.log('[CUT] Found', intersections.length, 'intersections');

    if (intersections.length === 0) {
        console.log('[CUT] No intersections found');
        return;
    }

    // Deduplicate intersections - only keep one intersection per original edge
    // This handles the case where a cut line crosses both segments of a bent edge
    const uniqueIntersections = [];
    const seenEdges = new Set();
    for (const intersection of intersections) {
        const edgeKey = [intersection.sourceId, intersection.targetId].sort().join('-');
        if (!seenEdges.has(edgeKey)) {
            seenEdges.add(edgeKey);
            uniqueIntersections.push(intersection);
        }
    }

    if (uniqueIntersections.length < intersections.length) {
        console.log('[CUT] Deduplicated to', uniqueIntersections.length, 'unique edge intersections');
    }

    // Insert dummy nodes at each intersection
    const insertedCuts = [];
    for (const intersection of uniqueIntersections) {
        const result = await insertDummyNode(visualization, intersection);
        if (result) insertedCuts.push(result);
    }

    // Track the batch of cut insertions in provenance for undo support
    if (insertedCuts.length > 0 && provenanceTracker.trrack) {
        // Capture set_order entries for each inserted dummy node
        const setOrder = visualization.data.set_order || {};
        const cutsWithSetOrder = insertedCuts.map(cut => {
            const setOrderEntries = [];
            for (const [lineId, lineStations] of Object.entries(setOrder)) {
                const idx = lineStations.indexOf(cut.nodeId);
                if (idx > -1) {
                    setOrderEntries.push({ lineId, index: idx });
                }
            }
            return { ...cut, setOrderEntries };
        });
        provenanceTracker.trackCutInsertion(cutsWithSetOrder);
    }

    // Refresh the visualization
    visualization.isDirty = true;

    // Update the force simulation with new nodes and links
    if (visualization.simulation) {
        visualization.simulation.nodes(visualization.nodes);
        visualization.simulation.force('link').links(visualization.links);
    }

    // Refresh edges (handles adding/removing edges properly)
    if (visualization.refreshEdges) {
        visualization.refreshEdges();
    }

    // Redraw everything
    visualization.draw();

    if (visualization.show_lines) {
        visualization.drawMetrolines();
    }

    // Re-run schematization if needed
    try {
        await visualization.refreshVisualization('cut_tool');
    } catch (error) {
        console.error('[CUT] Error refreshing visualization:', error);
    }
}

/**
 * Generate a unique dummy node ID
 */
function generateDummyNodeId(visualization) {
    const existingIds = new Set(visualization.nodes.map(n => n.id));
    let counter = 1;
    let newId = `_dummy_${counter}`;
    while (existingIds.has(newId)) {
        counter++;
        newId = `_dummy_${counter}`;
    }
    return newId;
}

/**
 * Insert a dummy node at the intersection point
 */
async function insertDummyNode(visualization, intersection) {
    const { sourceId, targetId, point, u } = intersection;

    console.log('[CUT] Inserting dummy node between', sourceId, 'and', targetId, 'at', point);

    const newNodeId = generateDummyNodeId(visualization);

    // Get source and target nodes
    const sourceNode = visualization.nodes.find(n => n.id === sourceId);
    const targetNode = visualization.nodes.find(n => n.id === targetId);

    if (!sourceNode || !targetNode) {
        console.error('[CUT] Could not find source or target node');
        return;
    }

    // The intersection point is in the current view's coordinate system (schematic if in schematic view)
    // Use the intersection point for schematic coordinates
    const schematicX = point.x;
    const schematicY = point.y;

    // For initial (non-schematic) coordinates, we need to calculate a proper interpolation

    const isSchematic = visualization.currentView === 'schematic' || visualization.currentView === 'presentation';

    let initialX, initialY;

    // Project the intersection point to the initial coordinate space
    if (isSchematic) {
        initialX = sourceNode.x + u * (targetNode.x - sourceNode.x);
        initialY = sourceNode.y + u * (targetNode.y - sourceNode.y);
    } else {
        // We are cutting in initial/edit view.
        // `point` is (x, y).

        // Use the exact point clicked for the initial view
        initialX = point.x;
        initialY = point.y;
    }

    // Create the dummy node
    const newNode = {
        id: newNodeId,
        label: '', // Empty label - won't be shown
        isDummy: true, // Mark as dummy node
        x: initialX,
        y: initialY,
        x_original: initialX,
        y_original: initialY,
        x_s: schematicX, // Default to schematicX
        y_s: schematicY  // Default to schematicY
    };

    // If not in schematic view, calculate proper schematic positions
    if (!isSchematic) {
        const sx_s = sourceNode.x_s ?? sourceNode.x;
        const sy_s = sourceNode.y_s ?? sourceNode.y;
        const tx_s = targetNode.x_s ?? targetNode.x;
        const ty_s = targetNode.y_s ?? targetNode.y;

        const link = visualization.links.find(l =>
            (l.source.id === sourceId && l.target.id === targetId) ||
            (l.source.id === targetId && l.target.id === sourceId)
        );

        if (link && link.bend) {
            const bx_s = link.bend.x;
            const by_s = link.bend.y;
            if (u <= 0.5) {
                // Determine t for the first segment (source -> bend)
                const t = u * 2; // Scale 0-0.5 to 0-1
                newNode.x_s = sx_s + t * (bx_s - sx_s);
                newNode.y_s = sy_s + t * (by_s - sy_s);
            } else {
                // Determine t for the second segment (bend -> target)
                const t = (u - 0.5) * 2; // Scale 0.5-1.0 to 0-1
                newNode.x_s = bx_s + t * (tx_s - bx_s);
                newNode.y_s = by_s + t * (ty_s - by_s);
            }
        } else {
            // Straight edge in schematic view
            newNode.x_s = sx_s + u * (tx_s - sx_s);
            newNode.y_s = sy_s + u * (ty_s - sy_s);
        }
    }

    // Force integer coordinates for schematic position to align with octilinear grid
    // This helps the LP solver find a solution easier
    if (newNode.x_s) newNode.x_s = Math.round(newNode.x_s);
    if (newNode.y_s) newNode.y_s = Math.round(newNode.y_s);

    // Create 8 octilinear ports for the new node
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

    // Add node to the visualization
    visualization.nodes.push(newNode);
    if (visualization.data.nodes) {
        visualization.data.nodes.push(newNode);
    }

    // Find all lines that use this edge and insert the dummy node
    const setOrder = visualization.data.set_order || {};
    for (const [lineId, lineStations] of Object.entries(setOrder)) {
        // Check if this line uses the edge (in either direction)
        for (let i = 0; i < lineStations.length - 1; i++) {
            const s = lineStations[i];
            const t = lineStations[i + 1];

            if ((s === sourceId && t === targetId) || (s === targetId && t === sourceId)) {
                // Insert the dummy node at this position
                lineStations.splice(i + 1, 0, newNodeId);
                console.log('[CUT] Inserted dummy node into line', lineId);
                break; // Only insert once per line
            }
        }
    }

    // Update edges: remove the old edge and create two new ones
    const edgeIndex = visualization.links.findIndex(l =>
        (l.source.id === sourceId && l.target.id === targetId) ||
        (l.source.id === targetId && l.target.id === sourceId)
    );

    if (edgeIndex > -1) {
        visualization.links.splice(edgeIndex, 1);

        // Also remove from data.links
        if (visualization.data.links) {
            const dataEdgeIndex = visualization.data.links.findIndex(l => {
                const sId = typeof l.source === 'object' ? l.source.id : l.source;
                const tId = typeof l.target === 'object' ? l.target.id : l.target;
                return (sId === sourceId && tId === targetId) ||
                       (sId === targetId && tId === sourceId);
            });
            if (dataEdgeIndex > -1) {
                visualization.data.links.splice(dataEdgeIndex, 1);
            }
        }

        // Remove any fixed port assignments for the old edge
        if (visualization.data.fixedAssignments) {
            const key1 = `${sourceId}-${targetId}`;
            const key2 = `${targetId}-${sourceId}`;
            visualization.data.fixedAssignments.delete(key1);
            visualization.data.fixedAssignments.delete(key2);
        }
    }

    const edge1 = { source: sourceNode, target: newNode };
    const edge2 = { source: newNode, target: targetNode };

    visualization.links.push(edge1);
    visualization.links.push(edge2);

    if (visualization.data.links) {
        visualization.data.links.push(edge1);
        visualization.data.links.push(edge2);
    }

    console.log('[CUT] Dummy node', newNodeId, 'inserted successfully');

    // Return info needed for provenance tracking
    return {
        nodeId: newNodeId,
        sourceId,
        targetId,
        position: { x: newNode.x, y: newNode.y },
        originalPosition: { x: newNode.x_original, y: newNode.y_original },
        schematicPosition: { x: newNode.x_s, y: newNode.y_s }
    };
}

