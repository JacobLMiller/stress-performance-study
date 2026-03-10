/**
 * Path analysis utilities for degree-2 nodes and spacewalking
 */

import { oppositePort } from './port.js';

export function isStraightDeg2(node) {
    if (!node.edges || node.edges.length !== 2) return false;
    const port0 = node.edges[0].getPortAt(node);
    const port1 = node.edges[1].getPortAt(node);
    if (port0 === null || port1 === null) return false;
    return port0 === oppositePort(port1);
}

export function spacewalk(node, prev, seen) {
    seen.add(node.id);
    let walk = [];

    if (isStraightDeg2(node)) {
        const v0 = node.edges[0].getOther(node);
        const v1 = node.edges[1].getOther(node);
        const next = v1 === prev ? v0 : v1;

        if (!seen.has(next.id)) {
            walk = spacewalk(next, node, seen);
        }
    }
    walk.push(node);
    return walk;
}

export function preprocessEdges(networkData) {
    // Pre-process nodes to include edges
    const nodeMap = new Map(networkData.nodes.map(node => [node.id, node]));
    
    for (const node of networkData.nodes) {
        node.edges = [];
    }

    for (const edge of networkData.edges) {
        const { sourceNode, targetNode } = resolveEdgeNodes(edge, nodeMap);

        if (sourceNode && targetNode) {
            setupEdgeConnections(edge, sourceNode, targetNode);
        } else {
            console.warn('Could not find source or target node for edge:', edge);
        }
    }
}

function resolveEdgeNodes(edge, nodeMap) {
    let sourceNode, targetNode;

    if (typeof edge.source === 'string' || typeof edge.source === 'number') {
        sourceNode = nodeMap.get(edge.source);
    } else if (edge.source && edge.source.id) {
        sourceNode = nodeMap.get(edge.source.id);
    }

    if (typeof edge.target === 'string' || typeof edge.target === 'number') {
        targetNode = nodeMap.get(edge.target);
    } else if (edge.target && edge.target.id) {
        targetNode = nodeMap.get(edge.target.id);
    }

    return { sourceNode, targetNode };
}

function setupEdgeConnections(edge, sourceNode, targetNode) {
    edge.nodes = [sourceNode, targetNode];
    edge.source = sourceNode;
    edge.target = targetNode;
    sourceNode.edges.push(edge);
    targetNode.edges.push(edge);

    const sourcePortId = edge.source_port?.octilinear_id ?? -1;
    const targetPortId = edge.target_port?.octilinear_id ?? -1;
    edge.ports = [sourcePortId, targetPortId];

    // Connect port to edge
    if (sourcePortId !== -1 && sourceNode.portById?.[sourcePortId]) {
        sourceNode.portById[sourcePortId].edges.push(edge);
    }
    if (targetPortId !== -1 && targetNode.portById?.[targetPortId]) {
        targetNode.portById[targetPortId].edges.push(edge);
    }

    // Add helper methods
    edge.getPortAt = function(node) {
        return this.nodes[0].id === node.id ? this.ports[0] :
               this.nodes[1].id === node.id ? this.ports[1] : null;
    };

    edge.getOther = function(node) {
        return this.nodes[0].id === node.id ? this.nodes[1] :
               this.nodes[1].id === node.id ? this.nodes[0] : null;
    };
}
