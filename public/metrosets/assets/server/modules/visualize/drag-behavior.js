/**
 * Drag behavior for visualization nodes.
 * Handles drag start/move/end with coordinate transforms, provenance tracking,
 * and optional schematization re-runs.
 */

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import provenanceTracker from '../provenance.js';
import { onSimulationTick } from './simulation.js';
import { isReorderConnectionsActive } from './line-connections/index.js';

/**
 * Apply drag behavior to all node elements in the visualization.
 * @param {Object} vis - The Visualization instance
 */
export function applyDragBehavior(vis) {
    const dragBehavior = d3.drag()
        .filter(function (event) {
            if (isReorderConnectionsActive()) return false;
            return vis.currentView === 'edit' && vis.nodeDraggingEnabled && !event.button;
        })
        .on("start", function (event, d) {
            event.sourceEvent.stopPropagation();
            vis.draggedNodeId = d.id;
            vis.dragStartPos = { x: d.x, y: d.y };
            vis.dragStartHasManualEdits = vis.hasManualEdits;

            if (!vis.singleNodeDragMode) {
                if (!event.active) vis.simulation.alphaTarget(0.3).restart();
            }

            const coords = screenToDataCoords(vis, event.sourceEvent);
            d.fx = coords.x;
            d.fy = coords.y;
        })
        .on("drag", function (event, d) {
            const coords = screenToDataCoords(vis, event.sourceEvent);
            d.fx = coords.x;
            d.fy = coords.y;

            if (vis.singleNodeDragMode) {
                d.x = coords.x;
                d.y = coords.y;

                const originalNode = vis.data.nodes.find(n => n.id === d.id);
                if (originalNode) {
                    originalNode.x = coords.x;
                    originalNode.y = coords.y;
                    originalNode.x_original = coords.x;
                    originalNode.y_original = coords.y;
                }

                onSimulationTick(vis);
            }
        })
        .on("end", function (event, d) {
            if (d.fx !== null && d.fy !== null) {
                d.x = d.fx;
                d.y = d.fy;

                const originalNode = vis.data.nodes.find(n => n.id === d.id);
                if (originalNode) {
                    originalNode.x = d.x;
                    originalNode.y = d.y;
                    originalNode.x_original = d.x;
                    originalNode.y_original = d.y;
                }
            }

            d.fx = null;
            d.fy = null;
            vis.draggedNodeId = null;
            vis.isDirty = true;
            vis.hasManualEdits = true;

            // Provenance tracking
            if (vis.dragStartPos) {
                const dx = d.x - vis.dragStartPos.x;
                const dy = d.y - vis.dragStartPos.y;
                if ((dx * dx + dy * dy) > 1 && provenanceTracker.trrack) {
                    provenanceTracker.trackNodeDrag(
                        d.id,
                        vis.dragStartPos,
                        { x: d.x, y: d.y },
                        vis.dragStartHasManualEdits,
                        vis.hasManualEdits
                    );
                }
            }
            vis.dragStartPos = null;

            if (vis.singleNodeDragMode) {
                onSimulationTick(vis);
                return;
            }

            if (vis.schematizationEnabled) {
                vis.simulation.stop();
                if (!event.active) vis.simulation.alphaTarget(0);

                vis.refreshVisualization('node_drag')
                    .catch(() => {
                        vis.simulation.alpha(0.3).restart();
                    });
            } else {
                vis.simulation.alphaDecay(0.02);
                vis.simulation.alpha(0.5).alphaTarget(0).restart();
            }
        });

    vis.zoomGroup.selectAll(".node").call(dragBehavior);
}

/**
 * Convert screen (client) coordinates to data coordinates,
 * accounting for SVG transform and zoom.
 */
function screenToDataCoords(vis, sourceEvent) {
    const svgNode = vis.svg.node();
    const pt = svgNode.createSVGPoint();
    pt.x = sourceEvent.clientX;
    pt.y = sourceEvent.clientY;
    const svgP = pt.matrixTransform(svgNode.getScreenCTM().inverse());

    const transform = d3.zoomTransform(svgNode);
    const xInZoomSpace = (svgP.x - transform.x) / transform.k;
    const yInZoomSpace = (svgP.y - transform.y) / transform.k;

    return {
        x: vis.xScale.invert(xInZoomSpace),
        y: vis.yScale.invert(yInZoomSpace)
    };
}

