/**
 * Event handlers for visualization interactions
 */

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { ui, setHoverNode, resetUIState, setSelectedPort, clearSelectedPort } from './ui-state.js';
import { updateSchematizeWithPortSelections } from '../../metro_pipeline.js';
import provenanceTracker from '../provenance.js';
import { showNodeContextMenu } from './node-editing/index.js';
import { showContextMenu } from './context-menu.js';

export function createEventHandlers(visualization) {
    return {
        handleNodeHover: (node) => {
            setHoverNode(node);
            visualization.updateRoseVisibility();
        },


        handleMouseLeave: () => {
            resetUIState();
            visualization.updateRoseVisibility();
        },

        handleNodeContextMenu: (event, node) => {
            showNodeContextMenu(event, node, visualization);
        },

        handleCutContextMenu: (event, node) => {
            event.preventDefault();
            event.stopPropagation();

            showContextMenu(event.pageX, event.pageY, [
                {
                    label: 'Remove Cut',
                    action: () => {
                         visualization.removeCut(node);
                    }
                }
            ]);
        },
        handlePortHover: (event) => {
            d3.select(event.target).style("fill", "orange");
        },

        handlePortLeave: (event, portData) => {
            // Don't change color if this port is selected
            if (ui.selected_port && ui.selected_port.port.id === portData.port.id) {
               return;
            }
            d3.select(event.target).style("fill", visualization.getPortFillColor(portData));
        },

        handlePortClick: async (event, portData) => {
            // Check if port reassignment is enabled - ALWAYS ENABLED
            // if (!isPortReassignmentEnabled()) {
            //     console.log("Port reassignment is disabled");
            //     return;
            // }

            console.log(`Port clicked on node ${portData.node.id}, port ${portData.port.id}.`);
            console.log(`Current state - selected_port:`, ui.selected_port ? `Node ${ui.selected_port.node.id}, Port ${ui.selected_port.port.id}` : 'NONE');

            // If nothing is selected yet, just select the port.
            if (!ui.selected_port) {
                if (portData.port.usedCount > 0) { // Can only select used ports
                    setSelectedPort(portData);
                    d3.select(event.target).style("fill", "yellow");
                    console.log(`First port selected: Node ${portData.node.id}, Port ${portData.port.id}.`);
                    console.log(`State after selection - selected_port:`, ui.selected_port);
                } else {
                    console.log("Cannot select port: It is not used by any edge.");
                }
                return;
            }

            console.log(`A second port was clicked. Currently selected: Node ${ui.selected_port.node.id}, Port ${ui.selected_port.port.id}`);

            // If the same port is clicked again, deselect it.
            if (ui.selected_port.port.id === portData.port.id) {
                console.log("Same port clicked again. Deselecting.");
                clearSelectedPort();
                d3.select(event.target).style("fill", visualization.getPortFillColor(portData));
                return;
            }

            // A second, different port has been clicked.
            // Scenario 1: The second port is on the same node.
            if (portData.node.id === ui.selected_port.node.id) {
                console.log("Second port is on the same node. Attempting port assignment.");
                await handlePortAssignment(portData, visualization);
                return;
            }

            // Scenario 2: The second port is on a different node
            const previouslySelectedPort = ui.selected_port;

            // Reset color of the previously selected port
            visualization.zoomGroup.selectAll(".port")
                .filter(d => d.port.id === previouslySelectedPort.port.id)
                .style("fill", d => visualization.getPortFillColor(d));

            // Select the new port if it's valid
            if (portData.port.usedCount > 0) {
                setSelectedPort(portData);
                d3.select(event.target).style("fill", "yellow");
                console.log(`Selection switched to: Node ${portData.node.id}, Port ${portData.port.id}`);
            } else {
                clearSelectedPort(); // Clear selection if the new port is not valid
                console.log("Cannot switch selection: new port is not used.");
            }
        },

        handlePortDoubleClick: async (event, portData) => {
            event.preventDefault();
            event.stopPropagation();

            // Edge straightening is disabled - ALWAYS ENABLED
            // if (!isEdgeStraighteningEnabled()) {
            //     console.log("Edge straightening is disabled");
            //     return;
            // }

            // Double click is now only for straightening
            await handlePortStraightening(portData, visualization);
        }
    };
}

async function handlePortAssignment(portData, visualization) {
    const original = ui.selected_port;
    const node = original.node;
    const edge = (original.port.edges && original.port.edges[0]) || null;

    if (!edge) {
        visualization.zoomGroup.selectAll(".port")
            .filter(d => d.port.id === original.port.id)
            .style("fill", d => visualization.getPortFillColor(d));
        clearSelectedPort();
        return;
    }

    const movingSourceSide = edge.source.id === node.id;
    const currentSourcePortId = edge.source_port?.octilinear_id;
    const currentTargetPortId = edge.target_port?.octilinear_id;

    if (currentSourcePortId == null || currentTargetPortId == null) {
        console.warn("Edge missing port ids; aborting fixed assignment.");
        clearSelectedPort();
        return;
    }

    const newPortId = portData.port.octilinear_id;
    const oppositePortId = (newPortId + 4) % 8;
    const assignment = {
        sourcePort: movingSourceSide ? newPortId : oppositePortId,
        targetPort: movingSourceSide ? oppositePortId : newPortId
    };

    // Track via provenance (this will apply & refresh)
    if (provenanceTracker.trrack) {
        provenanceTracker.trackPortAssignment(edge.source.id, edge.target.id, assignment);
    } else {
        // Fallback if provenance not initialized yet
        const key = `${edge.source.id}-${edge.target.id}`;
        visualization.data.fixedAssignments.set(key, assignment);
        await updateSchematizeWithPortSelections(visualization.data);
        await visualization.refreshVisualization();
    }

    visualization.zoomGroup.selectAll(".port")
        .filter(d => d.port.id === original.port.id)
        .style("fill", d => visualization.getPortFillColor(d));
    clearSelectedPort();
}


async function handlePortStraightening(portData, visualization) {
    // Only proceed if the port is actually used (has edges)
    if (!portData.port.edges || portData.port.edges.length === 0) {
        console.warn("Cannot straighten: port has no edges.");
        return;
    }
    const startNode = portData.node;
    const startPortId = portData.port.octilinear_id;
    const currentEdge = portData.port.edges[0];

    if (!currentEdge) {
        console.warn("Cannot straighten: no edge found for this port.");
        return;
    }

    const straighteningResult = findStraighteningPath(startNode, currentEdge, startPortId, visualization.links, visualization.data.fixedAssignments);

    if (straighteningResult.newAssignments.length > 0) {
        console.log(`Straightening path with ${straighteningResult.newAssignments.length} edges using port direction ${startPortId}`);

        if (provenanceTracker.trrack) {
            provenanceTracker.trackPathStraightening(
                straighteningResult.newAssignments,
                straighteningResult.previousAssignments
            );
        } else {
            // Fallback direct apply
            straighteningResult.newAssignments.forEach(({ key, assignment }) =>
                visualization.data.fixedAssignments.set(key, assignment)
            );
            await updateSchematizeWithPortSelections(visualization.data);
            await visualization.refreshVisualization();
        }
    } else {
        console.log("No path to straighten found.");
    }
}

function findStraighteningPath(startNode, startEdge, startPortId, links, fixedAssignments) {
    const oppositePortId = (startPortId + 4) % 8;

    // Helper to get previous assignment (fixed or effective)
    const getEffectiveAssignment = (edge) => {
        const key = `${edge.source.id}-${edge.target.id}`;
        let assignment = fixedAssignments?.get(key);
        // If not fixed, capture current visual state (link ports)
        if (!assignment && edge.source_port && edge.target_port) {
            assignment = {
                sourcePort: edge.source_port.octilinear_id,
                targetPort: edge.target_port.octilinear_id
            };
        }
        return { key, assignment };
    };

    // Create a map of node to edges for efficient lookup
    const nodeToEdges = new Map();
    links.forEach(link => {
        if (!nodeToEdges.has(link.source.id)) nodeToEdges.set(link.source.id, []);
        if (!nodeToEdges.has(link.target.id)) nodeToEdges.set(link.target.id, []);
        nodeToEdges.get(link.source.id).push(link);
        nodeToEdges.get(link.target.id).push(link);
    });

    let currentEdge = startEdge;
    let currentNode = (currentEdge.source.id === startNode.id) ? currentEdge.target : currentEdge.source;
    const visitedNodes = new Set([startNode.id]);
    const newAssignments = [];
    const previousAssignments = [];

    // Store the assignment for the initial edge
    previousAssignments.push(getEffectiveAssignment(currentEdge));

    const isInitialSource = currentEdge.source.id === startNode.id;
    const initialKey = `${currentEdge.source.id}-${currentEdge.target.id}`;
    const initialAssignment = {
        sourcePort: isInitialSource ? startPortId : oppositePortId,
        targetPort: isInitialSource ? oppositePortId : startPortId
    };
    newAssignments.push({ key: initialKey, assignment: initialAssignment });

    // Traverse the path, straightening as we go
    while (currentNode && !visitedNodes.has(currentNode.id)) {
        visitedNodes.add(currentNode.id);
        const edges = nodeToEdges.get(currentNode.id) || [];

        // Only continue if this node has exactly 2 edges (degree 2)
        if (edges.length !== 2) break;

        // Find the next edge (not the one we just came from)
        const prevEdge = currentEdge;
        currentEdge = edges.find(e => e !== prevEdge);
        if (!currentEdge) break;

        // Determine port assignments for this edge
        previousAssignments.push(getEffectiveAssignment(currentEdge));

        const isSource = currentEdge.source.id === currentNode.id;
        const key = `${currentEdge.source.id}-${currentEdge.target.id}`;

        const assignment = {
            sourcePort: isSource ? startPortId : oppositePortId,
            targetPort: isSource ? oppositePortId : startPortId
        };
        newAssignments.push({ key, assignment });

        // Move to the next node
        currentNode = (currentEdge.source.id === currentNode.id) ? currentEdge.target : currentEdge.source;
    }

    return { newAssignments, previousAssignments };
}