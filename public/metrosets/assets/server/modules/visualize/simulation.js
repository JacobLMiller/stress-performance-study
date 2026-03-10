/**
 * Force simulation management for the visualization.
 * Handles initialization, force updates, schematic forces, and bend position tracking.
 */

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { isLineConnectionsModalOpen, updatePositionNumbersOverlay } from './line-connections/index.js';
import { isReorderConnectionsActive } from './line-connections/index.js';

/**
 * Initialize the d3 force simulation for node dragging interactions.
 * @param {Object} vis - The Visualization instance
 */
export function initializeSimulation(vis) {
    vis.simulation = d3.forceSimulation(vis.nodes)
        .force("link", d3.forceLink(vis.links).id(d => d.id).distance(50).strength(20))
        .force("charge", d3.forceManyBody().strength(-40))
        .force("collide", d3.forceCollide().radius(() => (vis.nodeRadius || 10) * 1.5).strength(0.7))
        .alphaTarget(0)
        .alphaDecay(0)
        .on("tick", () => onSimulationTick(vis));

    vis.simulation.stop();
    updateSimulationForces(vis);
}

/**
 * Update simulation forces based on current scale parameters and edit mode settings.
 * @param {Object} vis - The Visualization instance
 */
export function updateSimulationForces(vis) {
    if (!vis.simulation) return;

    const muteStandardForces = !vis.nodeDraggingEnabled && vis.schematizationEnabled;

    vis.simulation.nodes(vis.nodes);

    const linkDistance = vis.minEdgeLengthPx ? vis.minEdgeLengthPx * 1.5 : 50;
    const linkForce = vis.simulation.force("link");
    if (linkForce) {
        linkForce.links(vis.links);
        linkForce.distance(linkDistance);
        linkForce.strength(muteStandardForces ? 0 : 0.1);
    }

    const chargeStrength = vis.nodeRadius ? -vis.nodeRadius * 15 : -30;
    const chargeForce = vis.simulation.force("charge");
    if (chargeForce) {
        chargeForce.strength(muteStandardForces ? 0 : chargeStrength);
    }

    const collisionRadius = (vis.nodeRadius || 10) * 1.5;
    const collideForce = vis.simulation.force("collide");
    if (collideForce) {
        collideForce.radius(collisionRadius);
        collideForce.strength(muteStandardForces ? 0 : 0.7);
    }
}

/**
 * Custom force that pulls nodes towards their schematic positions.
 * Only active when schematization is enabled and NOT dragging.
 * @param {Object} vis - The Visualization instance
 * @returns {Function} A d3 force function
 */
export function createSchematicForce(vis) {
    return function (alpha) {
        if (!vis.hasSchematized || !vis.schematizationEnabled) return;
        if (vis.draggedNodeId !== null) return;

        const strength = 0.3;

        for (let i = 0, n = vis.nodes.length; i < n; i++) {
            const node = vis.nodes[i];
            if (node.x_s === undefined || node.y_s === undefined) continue;
            if (!isFinite(node.x) || !isFinite(node.y) ||
                !isFinite(node.x_s) || !isFinite(node.y_s)) continue;

            const dx = node.x_s - node.x;
            const dy = node.y_s - node.y;
            if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) continue;

            const maxDelta = 100;
            const clampedDx = Math.max(-maxDelta, Math.min(maxDelta, dx));
            const clampedDy = Math.max(-maxDelta, Math.min(maxDelta, dy));

            const k = alpha * strength;
            node.vx += clampedDx * k;
            node.vy += clampedDy * k;
        }
    };
}

/**
 * Store reference positions for bend points and their source/target nodes.
 * Called after schematization so bend positions can track node movement.
 * @param {Object} vis - The Visualization instance
 */
export function storeBendReferencePositions(vis) {
    for (const link of vis.links) {
        if (link.bend) {
            link._bendRef = {
                bend: { x: link.bend.x, y: link.bend.y },
                source: { x: link.source.x, y: link.source.y },
                target: { x: link.target.x, y: link.target.y }
            };
        } else {
            link._bendRef = null;
        }
    }
}

/**
 * Update bend positions based on how their source and target nodes have moved
 * since schematization. Uses affine transformation to preserve both parallel
 * and perpendicular components.
 * @param {Object} vis - The Visualization instance
 */
export function updateBendPositions(vis) {
    for (const link of vis.links) {
        if (!link.bend || !link._bendRef) continue;

        const ref = link._bendRef;
        const srcDx = link.source.x - ref.source.x;
        const srcDy = link.source.y - ref.source.y;
        const tgtDx = link.target.x - ref.target.x;
        const tgtDy = link.target.y - ref.target.y;

        if (srcDx === 0 && srcDy === 0 && tgtDx === 0 && tgtDy === 0) continue;

        const refEdgeDx = ref.target.x - ref.source.x;
        const refEdgeDy = ref.target.y - ref.source.y;
        const refEdgeLenSq = refEdgeDx * refEdgeDx + refEdgeDy * refEdgeDy;

        let t = 0.5, s = 0;
        if (refEdgeLenSq > 1e-10) {
            const bendVecX = ref.bend.x - ref.source.x;
            const bendVecY = ref.bend.y - ref.source.y;
            t = (bendVecX * refEdgeDx + bendVecY * refEdgeDy) / refEdgeLenSq;
            s = (bendVecX * (-refEdgeDy) + bendVecY * refEdgeDx) / Math.sqrt(refEdgeLenSq);
        }

        const newEdgeDx = link.target.x - link.source.x;
        const newEdgeDy = link.target.y - link.source.y;
        const newEdgeLen = Math.sqrt(newEdgeDx * newEdgeDx + newEdgeDy * newEdgeDy);

        if (newEdgeLen > 1e-10) {
            const ux = newEdgeDx / newEdgeLen;
            const uy = newEdgeDy / newEdgeLen;
            const px = -uy;
            const py = ux;

            link.bend.x = link.source.x + t * newEdgeDx + s * px;
            link.bend.y = link.source.y + t * newEdgeDy + s * py;
        } else {
            link.bend.x = ref.bend.x + (srcDx + tgtDx) / 2;
            link.bend.y = ref.bend.y + (srcDy + tgtDy) / 2;
        }
    }
}

/**
 * Called on each simulation tick. Updates visual elements to reflect current positions.
 * @param {Object} vis - The Visualization instance
 */
export function onSimulationTick(vis) {
    // Skip all tick updates while the reorder-connections experience is active
    if (isReorderConnectionsActive()) return;

    if (vis.currentView === 'edit') {
        updateBendPositions(vis);
        vis.drawNodes();
        vis.drawEdges();
        vis.updatePorts();
        vis.drawCutNodes();

        if (vis.show_lines) {
            vis.drawMetrolines();
        }
    }

    if (isLineConnectionsModalOpen()) {
        updatePositionNumbersOverlay(vis);
    }
}

