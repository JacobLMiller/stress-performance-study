/**
 * View mode switching (edit / presentation) and the core refreshVisualization pipeline.
 */

import provenanceTracker from '../provenance.js';
import { showNotification } from '../notification.js';
import { InfeasibleSolutionError } from '../schematize/linear-programming.js';
import { updateSchematizeWithPortSelections } from '../../metro_pipeline.js';
import { isLineConnectionsModalOpen, updatePositionNumbersOverlay } from './line-connections/index.js';
import { createScales } from './scaling.js';
import { createSchematicForce, storeBendReferencePositions } from './simulation.js';

/**
 * Switch to Edit view.
 * @param {Object} vis - The Visualization instance
 * @param {boolean} track - Whether to track the view change in provenance
 */
export async function showEdit(vis, track = true) {
    const prev = vis.currentView;

    if (vis.schematizationEnabled) {
        vis.data.useInitialCoordinates = true;

        try {
            await refreshVisualization(vis, 'view_switch');
            vis.isDirty = false;
        } catch (e) {
            console.warn('[VIEW] refreshVisualization failed during showEdit:', e);
        }

        if (!vis.hasSchematized) vis.hasSchematized = true;

        if (vis.simulation) {
            vis.simulation.force('schematic', createSchematicForce(vis));
        }

        if (vis.hasSchematized) {
            syncSchematicToInitial(vis);
            recalculateScales(vis);
        }
    } else {
        if (vis.simulation) vis.simulation.force('schematic', null);
    }

    vis.currentView = 'edit';
    vis.invalidateLabels();

    if (vis.simulation) vis.simulation.stop();
    vis.updateSimulationForces();
    vis.refreshEdges();
    vis.draw();
    vis.updateRoseVisibility();

    if (isLineConnectionsModalOpen()) updatePositionNumbersOverlay(vis);
    if (vis.show_lines) vis.drawMetrolines();
    vis.drawLegend();

    if (track && provenanceTracker.trrack && prev !== 'edit') {
        provenanceTracker.trackViewChange('edit', prev);
    }
}

/**
 * Switch to Presentation view.
 * @param {Object} vis - The Visualization instance
 * @param {boolean} track - Whether to track the view change in provenance
 */
export async function showPresentation(vis, track = true) {
    const prev = vis.currentView;
    vis.currentView = 'presentation';
    vis.show_lines = true;
    vis.invalidateLabels();

    vis.data.useInitialCoordinates = true;

    const wasSchematizationEnabled = vis.schematizationEnabled;
    vis.schematizationEnabled = true;

    try {
        await refreshVisualization(vis, 'view_switch');
        vis.isDirty = false;
    } catch (e) {
        console.warn('[SCHEMATIZE] refreshVisualization failed during showPresentation');
        vis.schematizationEnabled = wasSchematizationEnabled;
        return;
    } finally {
        vis.schematizationEnabled = wasSchematizationEnabled;
    }

    if (!vis.hasSchematized) vis.hasSchematized = true;

    if (vis.schematizationEnabled && vis.simulation) {
        vis.simulation.force('schematic', createSchematicForce(vis));
    }

    if (vis.simulation) vis.simulation.stop();

    if (isLineConnectionsModalOpen()) updatePositionNumbersOverlay(vis);

    vis.updateRoseVisibility();
    vis.drawLegend();

    if (track && provenanceTracker.trrack && prev !== 'presentation') {
        provenanceTracker.trackViewChange('presentation', prev);
    }
}

/**
 * Re-run the schematization pipeline and update all visual elements.
 * @param {Object} vis - The Visualization instance
 * @param {string} context - The context triggering the refresh (e.g. 'node_drag', 'view_switch')
 * @returns {Promise}
 */
export function refreshVisualization(vis, context = 'port_assignment') {
    if (!vis.schematizationEnabled) {
        vis.invalidateLabels();
        vis.draw();
        if (vis.show_lines) vis.drawMetrolines();
        return Promise.resolve(vis.data);
    }

    const skipAlignLayouts = vis.hasManualEdits;
    vis.data.useInitialCoordinates = context === 'node_drag';

    return updateSchematizeWithPortSelections(vis.data, !skipAlignLayouts)
        .then((updatedData) => {
            vis.data = updatedData;
            vis.hasSchematized = true;
            vis.invalidateLabels();
            vis.refreshPortData();
            vis.refreshEdges();

            if (vis.simulation) {
                vis.simulation.stop();
                vis.simulation.alphaTarget(0);
            }
            vis.updateScales();

            if (vis.currentView === 'edit' && vis.hasSchematized && vis.schematizationEnabled) {
                syncSchematicToInitial(vis);
                storeBendReferencePositions(vis);
                recalculateScales(vis);

                if (vis.simulation) {
                    vis.simulation.force('schematic', createSchematicForce(vis));
                    vis.simulation.alpha(0.3).alphaTarget(0).restart();
                }
            }

            vis.draw();
            if (vis.show_lines) vis.drawMetrolines();
        })
        .catch((error) => {
            if (error instanceof InfeasibleSolutionError) {
                showNotification('Infeasible solution reached, disabling schematization', 5000);
                vis.setSchematization(false);
                const checkbox = document.getElementById('checkbox_schematization');
                if (checkbox) checkbox.checked = false;
            } else {
                throw error;
            }
        });
}

// Helpers

function syncSchematicToInitial(vis) {
    vis.nodes.forEach(d => {
        if (d.x_s != null && d.y_s != null) {
            d.x = d.x_s;
            d.y = d.y_s;
            d.vx = 0;
            d.vy = 0;
        }
    });
    vis.data.nodes.forEach(n => {
        if (n.x_s != null && n.y_s != null) {
            n.x = n.x_s;
            n.y = n.y_s;
        }
    });
}

function recalculateScales(vis) {
    const width = vis.svg.node().getBoundingClientRect().width;
    const height = vis.svg.node().getBoundingClientRect().height;
    const scales = createScales(vis.nodes, width, height, vis.links);
    vis.xScale = scales.xScale;
    vis.yScale = scales.yScale;
    vis.xScale_s = scales.xScale_s;
    vis.yScale_s = scales.yScale_s;
}

