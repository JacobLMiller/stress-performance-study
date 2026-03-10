/**
 * Cut (dummy node) removal logic.
 * Handles merging edges when a cut node is removed from the graph.
 */

import provenanceTracker from '../provenance.js';

/**
 * Remove a cut (dummy) node, merging its two incident edges into one.
 * @param {Object} vis - The Visualization instance
 * @param {Object} node - The dummy node to remove
 * @param {boolean} isFromProvenance - Whether this was triggered by provenance replay
 */
export function removeCut(vis, node, isFromProvenance = false) {
    if (!node || !node.isDummy) return;

    if (!isFromProvenance && provenanceTracker.trrack) {
        provenanceTracker.trackCutRemoval(node.id);
        return; // Provenance system will call us back
    }

    const connectedEdges = vis.links.filter(l => l.source.id === node.id || l.target.id === node.id);
    if (connectedEdges.length !== 2) {
        console.warn(`Dummy node ${node.id} does not have exactly 2 edges, cannot merge.`);
        return;
    }

    const [edge1, edge2] = connectedEdges;
    const source = edge1.source.id === node.id ? edge1.target : edge1.source;
    const target = edge2.source.id === node.id ? edge2.target : edge2.source;

    // Clean up fixedAssignments referencing the dummy node
    if (vis.data.fixedAssignments) {
        for (const key of [...vis.data.fixedAssignments.keys()]) {
            if (key.includes(node.id)) vis.data.fixedAssignments.delete(key);
        }
    }

    // Clean up port state on neighboring nodes
    [source, target].forEach(neighbor => {
        if (neighbor?.ports) {
            neighbor.ports.forEach(port => {
                port.edges = port.edges.filter(e => {
                    const sId = e.source?.id ?? e.nodes?.[0]?.id;
                    const tId = e.target?.id ?? e.nodes?.[1]?.id;
                    return sId !== node.id && tId !== node.id;
                });
                port.usedCount = port.edges.length;
            });
        }
    });

    // Remove dummy node
    const nodeIndex = vis.nodes.findIndex(n => n.id === node.id);
    if (nodeIndex > -1) vis.nodes.splice(nodeIndex, 1);
    if (vis.data.nodes) {
        const dataNodeIndex = vis.data.nodes.findIndex(n => n.id === node.id);
        if (dataNodeIndex > -1) vis.data.nodes.splice(dataNodeIndex, 1);
    }

    // Remove edges connecting to the dummy node
    vis.links = vis.links.filter(l => l !== edge1 && l !== edge2);
    if (vis.data.links) {
        vis.data.links = vis.data.links.filter(l => l !== edge1 && l !== edge2);
    }
    if (vis.data.edges && vis.data.edges !== vis.data.links) {
        vis.data.edges = vis.data.links;
    }

    // Remove dummy node from set_order (metro lines)
    const setOrder = vis.data.set_order || {};
    for (const lineStations of Object.values(setOrder)) {
        const idx = lineStations.indexOf(node.id);
        if (idx > -1) lineStations.splice(idx, 1);
    }

    // Create merged edge
    const newEdge = { source, target };
    vis.links.push(newEdge);
    if (vis.data.links) vis.data.links.push(newEdge);
    if (vis.data.edges && vis.data.edges !== vis.data.links) {
        vis.data.edges = vis.data.links;
    }

    // Update force simulation
    if (vis.simulation) {
        vis.simulation.nodes(vis.nodes);
        const linkForce = vis.simulation.force("link");
        if (linkForce) linkForce.links(vis.links);
    }

    // Remove custom line orders referencing the dummy node
    if (vis.customLineOrders) {
        for (const key of [...vis.customLineOrders.keys()]) {
            if (key.includes(node.id)) vis.customLineOrders.delete(key);
        }
    }

    vis.refreshVisualization('cut_removal');
}

