/**
 * Main Visualization class — thin orchestrator that delegates to specialized modules.
 */

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { createScales } from './scaling.js';
import { createEventHandlers } from './event-handlers.js';
import {
    drawNodes, drawEdges, drawPorts, drawCutNodes, drawLabels,
    updateRoseVisibility, getPortFillColor, setupSVGElements,
    refreshPortElements, refreshEdgeElements
} from './drawing.js';
import { preprocessVisualizationData } from './data-preprocessing.js';
import { DPNiedermannLabeling } from './labeling.js';
import { visualization } from './ui-state.js';

// Extracted modules
import { initializeSimulation, updateSimulationForces, createSchematicForce } from './simulation.js';
import { applyDragBehavior } from './drag-behavior.js';
import { drawMetrolines, toggleMetrolines, generateHypersetColors } from './metro-lines.js';
import { drawLegend } from './legend.js';
import { showEdit, showPresentation, refreshVisualization } from './view-modes.js';
import { removeCut } from './cut-removal.js';
import provenanceTracker from '../provenance.js';


export default class Visualization {
    constructor(svg, data) {
        this.svg = d3.select(svg);
        this.data = data;
        this.currentView = 'edit';
        this.show_lines = false;
        this.show_labels = false;
        this.computedLabels = null;
        this.isDirty = false;
        this.hasManualEdits = false;
        this.manualFontSize = null;       // User-overridden font size (null = auto)
        this.lastComputedFontSize = null;  // Font size from last labeling run
        this.labelEditMode = 'full';       // 'full' = all labels at 100%, 'drafting' = non-fixed at 20%

        // Edit view toggles
        this.nodeDraggingEnabled = true;
        this.schematizationEnabled = true;
        this.singleNodeDragMode = false;

        this.customLineOrders = new Map();
        this.hasSchematized = data.nodes?.some(n => n.x_s !== undefined && n.y_s !== undefined) || false;
        this.draggedNodeId = null;
        this.manualLabelPreferences = new Map();
        this.manualLineLabelPreferences = new Map();

        // Scale functions (identity until resize)
        this.xScale = v => v;
        this.yScale = v => v;
        this.xScale_s = v => v;
        this.yScale_s = v => v;

        this.zoom = d3.zoom()
            .scaleExtent([0.1, 10])
            .on("zoom", (event) => this.handleZoom(event));

        this.data.fixedAssignments = this.data.fixedAssignments || new Map();
        this.simulation = null;

        this.init();
    }

    init() {
        this.preprocess();
        this.resize();
        this.setup();
        this.draw();
    }

    // Toggle methods

    setNodeDragging(enabled) {
        this.nodeDraggingEnabled = enabled;
        this.updateSimulationForces();
        if (this.simulation && this.currentView === 'edit') {
            this.simulation.alpha(0.3).alphaTarget(0).restart();
        }
    }

    setSchematization(enabled) {
        this.schematizationEnabled = enabled;

        if (this.simulation) {
            this.updateSimulationForces();

            if (enabled) {
                this.simulation.force('schematic', createSchematicForce(this));
                this.data.useInitialCoordinates = true;
                this.refreshVisualization('node_drag').catch(e => console.error('Error running schematization:', e));
            } else {
                this.simulation.force('schematic', null);
            }

            if (this.currentView === 'edit') {
                this.simulation.alpha(0.3).alphaTarget(0).restart();
            }
        }
    }

    setSingleNodeDragMode(enabled) {
        this.singleNodeDragMode = enabled;
    }

    // Data & scales

    preprocess() {
        const preprocessed = preprocessVisualizationData(this.data);
        this.nodes = preprocessed.nodes;
        this.links = preprocessed.links;
    }

    resize() {
        const width = this.svg.node().getBoundingClientRect().width;
        const height = this.svg.node().getBoundingClientRect().height;
        const scales = createScales(this.nodes, width, height, this.links);

        this.xScale = scales.xScale;
        this.yScale = scales.yScale;
        this.xScale_s = scales.xScale_s;
        this.yScale_s = scales.yScale_s;
        this.nodeRadius = scales.nodeRadius;
        this.portRadius = scales.portRadius;
        this.portDistance = scales.portDistance;
        this.minEdgeLengthPx = scales.minEdgeLengthPx;

        if (this.zoomGroup) this.draw();
        this.drawLegend();
    }

    updateScales() {
        const width = this.svg.node().getBoundingClientRect().width;
        const height = this.svg.node().getBoundingClientRect().height;
        const scales = createScales(this.nodes, width, height, this.links);

        this.xScale = scales.xScale;
        this.yScale = scales.yScale;
        this.xScale_s = scales.xScale_s;
        this.yScale_s = scales.yScale_s;
        this.updateSimulationForces();
    }

    // Setup

    setup() {
        this.zoom.filter((event) => {
            if (event.target.classList?.contains('node') && this.currentView === 'initial') return false;
            return !event.button;
        });

        this.svg.call(this.zoom);
        this.zoomGroup = this.svg.append("g").attr("class", "zoom-group");
        this.eventHandlers = createEventHandlers(this);
        setupSVGElements(this.zoomGroup, this.links, this.nodes, this.eventHandlers);

        initializeSimulation(this);
        this.applyDragBehavior();
        this.refreshPortData();
    }

    // Simulation delegates

    updateSimulationForces() { updateSimulationForces(this); }
    applyDragBehavior() { applyDragBehavior(this); }

    // Drawing delegates

    draw() {
        this.drawNodes();
        this.drawLabels();
        this.updatePorts();

        if (this.currentView === 'presentation') {
            this.zoomGroup.selectAll(".link").style("display", "none");
        } else {
            this.zoomGroup.selectAll(".link").style("display", null);
            this.refreshEdges();
        }

        this.drawCutNodes();
    }

    drawNodes() {
        const useSchematic = this.currentView === 'schematic' || this.currentView === 'presentation';
        const xs = useSchematic ? this.xScale_s : this.xScale;
        const ys = useSchematic ? this.yScale_s : this.yScale;
        const isPresentation = this.currentView === 'presentation';

        // For presentation mode, precompute max metro lines on any incident edge per node
        let maxLinesPerNode = null;
        if (isPresentation && this.data.set_order) {
            maxLinesPerNode = computeMaxLinesPerNode(this.data.set_order, this.links);
        }

        drawNodes(this.zoomGroup, this.nodes, xs, ys, useSchematic, this.hasSchematized ? this.nodeRadius : null, isPresentation, maxLinesPerNode);
    }

    drawLabels() {
        const useSchematic = this.currentView === 'schematic' || this.currentView === 'presentation';
        const xs = useSchematic ? this.xScale_s : this.xScale;
        const ys = useSchematic ? this.yScale_s : this.yScale;

        if (this.show_labels && (!this.computedLabels || this.computedLabels.length === 0)) {
            this.computeLabels();
        }
        drawLabels(this.zoomGroup, xs, ys, useSchematic, this.show_labels, this.computedLabels, this.labelEditMode);
    }

    drawEdges() {
        const showSchematicFeatures = this.currentView === 'schematic' || this.currentView === 'presentation' || (this.currentView === 'edit' && this.hasSchematized && this.schematizationEnabled);
        drawEdges(this.zoomGroup, this.links, this.xScale, this.yScale, this.xScale_s, this.yScale_s, this.currentView, showSchematicFeatures);
    }

    refreshEdges() {
        const showSchematicFeatures = this.currentView === 'schematic' || this.currentView === 'presentation' || (this.currentView === 'edit' && this.hasSchematized && this.schematizationEnabled);
        refreshEdgeElements(this.zoomGroup, this.links, this.xScale, this.yScale, this.xScale_s, this.yScale_s, this.currentView, showSchematicFeatures);
    }

    drawCutNodes() {
        const showSchematicFeatures = this.currentView === 'schematic' || this.currentView === 'presentation' || (this.currentView === 'edit' && this.hasSchematized && this.schematizationEnabled);
        drawCutNodes(this.zoomGroup, this.nodes, this.xScale, this.yScale, this.xScale_s, this.yScale_s, this.currentView, this.eventHandlers, showSchematicFeatures);
    }

    updatePorts() {
        if (this.currentView === 'presentation') {
            this.zoomGroup.selectAll(".port").style("display", "none");
            return;
        }
        this.zoomGroup.selectAll(".port").style("display", null);
        drawPorts(this.zoomGroup, null, this.xScale, this.yScale, this.xScale_s, this.yScale_s, this.currentView, this.getPortFillColor.bind(this),
            this.hasSchematized ? this.portRadius : null,
            this.hasSchematized ? this.portDistance : null);
    }

    refreshPortData() {
        refreshPortElements(this.zoomGroup, this.nodes, this.eventHandlers);
        this.updatePorts();
    }

    handleZoom(event) {
        this.zoomGroup.attr("transform", event.transform);
    }

    updateRoseVisibility() { updateRoseVisibility(this.zoomGroup, this.currentView); }
    getPortFillColor(portData) { return getPortFillColor(portData); }

    // Metro lines & legend delegates

    drawMetrolines() { drawMetrolines(this); }
    toggleMetrolines() { toggleMetrolines(this); }
    generateHypersetColors() { return generateHypersetColors(this); }
    drawLegend() { drawLegend(this); }

    // Labels

    computeLabels() {
        const useSchematic = this.currentView === 'schematic' || this.currentView === 'presentation';
        const xs = useSchematic ? this.xScale_s : this.xScale;
        const ys = useSchematic ? this.yScale_s : this.yScale;

        // Build per-node label preferences from line-level preferences
        const linePreferencesForNode = new Map();
        if (this.manualLineLabelPreferences.size > 0 && this.data.set_order) {
            for (const [lineId, direction] of this.manualLineLabelPreferences.entries()) {
                for (const nodeId of (this.data.set_order[lineId] || [])) {
                    linePreferencesForNode.set(nodeId, direction);
                }
            }
        }

        const labelingNodes = this.nodes.map(node => {
            let radius;
            if (useSchematic) {
                const totalUsedCount = node.ports ? node.ports.reduce((sum, p) => sum + p.usedCount, 0) : 0;
                radius = 1.5 + (Math.max(totalUsedCount, 1) * 1.2);
            } else {
                radius = this.nodeRadius || 5;
            }

            const dataX = useSchematic ? (node.x_s ?? node.x) : node.x;
            const dataY = useSchematic ? (node.y_s ?? node.y) : node.y;

            return {
                id: node.id, label: node.label,
                x: xs(dataX), y: ys(dataY),
                ports: node.ports, radius,
                manualPreference: this.manualLabelPreferences.get(node.id) ?? linePreferencesForNode.get(node.id)
            };
        });

        const nodeMap = new Map(labelingNodes.map(n => [n.id, n]));
        const labelingLinks = this.links.map(link => {
            const result = { source: nodeMap.get(link.source.id), target: nodeMap.get(link.target.id), lines: link.lines || [] };
            if (useSchematic && link.bend) result.bend = { x: xs(link.bend.x), y: ys(link.bend.y) };
            return result;
        }).filter(l => l.source && l.target);

        const distance = this.portDistance ?? visualization.portDistance ?? 14;

        try {
            const result = DPNiedermannLabeling(
                labelingNodes, labelingLinks, this.data.set_order || {},
                distance, 4, 16, 8, 4, { enabled: true, maxEventsPerTrial: 50 },
                this.manualFontSize
            );
            this.computedLabels = result.labels;
            this.lastComputedFontSize = result.fontsize;
        } catch (error) {
            console.error('[LABELS] Error computing labels:', error);
            this.computedLabels = [];
        }
    }

    invalidateLabels() { this.computedLabels = null; }

    toggleLabels() {
        this.show_labels = !this.show_labels;
        if (this.show_labels) {
            this.labelEditMode = 'full';
            this.invalidateLabels();
        }
        this.drawLabels();
    }

    setManualFontSize(size) {
        this.manualFontSize = size;
        this.invalidateLabels();
        this.drawLabels();
    }

    clearManualFontSize() {
        this.manualFontSize = null;
        this.invalidateLabels();
        this.drawLabels();
    }

    /**
     * Enter drafting mode: the algo result is still shown but non-fixed labels
     * are rendered at 20% opacity. The user can then set preferences one by one.
     */
    clearLabelling() {
        this.labelEditMode = 'drafting';
        // Recompute so the isFixed flags are current
        this.invalidateLabels();
        this.drawLabels();
    }

    /**
     * Remove ALL manual preferences (node-level and line-level) and recompute
     * from scratch. Stays in whatever labelEditMode we are in.
     */
    clearAllPreferences() {
        this.manualLabelPreferences.clear();
        this.manualLineLabelPreferences.clear();
        this.invalidateLabels();
        this.drawLabels();
    }

    /**
     * Finalize: accept the current labelling as-is. All labels become fully
     * visible (switch back to 'full' mode).
     */
    finalizeLabels() {
        this.labelEditMode = 'full';
        this.drawLabels();
    }

    // Label preferences

    setManualLabelPreference(nodeId, direction, isFromProvenance = false) {
        const previousDirection = this.manualLabelPreferences.get(nodeId) ?? null;
        if (direction == null) this.manualLabelPreferences.delete(nodeId);
        else this.manualLabelPreferences.set(nodeId, direction);
        this.invalidateLabels();
        this.drawLabels();

        if (!isFromProvenance && provenanceTracker.trrack) {
            provenanceTracker.trackLabelPreference(nodeId, direction, previousDirection);
        }
    }

    setManualLineLabelPreference(lineId, direction, isFromProvenance = false) {
        const previousDirection = this.manualLineLabelPreferences.get(lineId) ?? null;
        if (direction == null) this.manualLineLabelPreferences.delete(lineId);
        else this.manualLineLabelPreferences.set(lineId, direction);
        this.invalidateLabels();
        this.drawLabels();

        if (!isFromProvenance && provenanceTracker.trrack) {
            provenanceTracker.trackLineLabelPreference(lineId, direction, previousDirection);
        }
    }

    /**
     * Get the "segment" of nodes around nodeId — the contiguous run of nodes
     * where exactly the same set of metro lines pass through.
     * A segment ends when a line joins or leaves.
     */
    getSegmentNodes(nodeId) {
        const setOrder = this.data.set_order || {};

        // Find all lines passing through this node
        const linesAtNode = [];
        for (const [lineId, stations] of Object.entries(setOrder)) {
            if (stations.includes(nodeId)) {
                linesAtNode.push(lineId);
            }
        }

        if (linesAtNode.length === 0) return [nodeId];

        // Sort for consistent comparison
        const linesAtNodeSorted = [...linesAtNode].sort();

        // Helper: get all lines through a given node
        const getLinesAt = (nid) => {
            const lines = [];
            for (const [lineId, stations] of Object.entries(setOrder)) {
                if (stations.includes(nid)) lines.push(lineId);
            }
            return lines.sort();
        };

        // Helper: check if a node has exactly the same set of lines
        const hasSameLines = (nid) => {
            const lines = getLinesAt(nid);
            if (lines.length !== linesAtNodeSorted.length) return false;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i] !== linesAtNodeSorted[i]) return false;
            }
            return true;
        };

        // Use the first line as reference for traversal order
        // Walk in both directions along this line, stopping when the set of lines changes
        const refLineId = linesAtNode[0];
        const refStations = setOrder[refLineId];
        const nodeIndex = refStations.indexOf(nodeId);

        const segmentNodeIds = [nodeId];

        // Walk backward (toward index 0)
        for (let i = nodeIndex - 1; i >= 0; i--) {
            const nid = refStations[i];
            if (hasSameLines(nid)) {
                segmentNodeIds.unshift(nid);
            } else {
                break;
            }
        }

        // Walk forward (toward end)
        for (let i = nodeIndex + 1; i < refStations.length; i++) {
            const nid = refStations[i];
            if (hasSameLines(nid)) {
                segmentNodeIds.push(nid);
            } else {
                break;
            }
        }

        return segmentNodeIds;
    }

    /**
     * Batch-set manual label preferences for a list of node IDs.
     * Used by "Set Segment Label Position".
     */
    setSegmentLabelPreferences(nodeIds, direction, isFromProvenance = false) {
        // Capture previous preferences for provenance undo
        const previousPreferences = new Map();
        for (const nid of nodeIds) {
            previousPreferences.set(nid, this.manualLabelPreferences.get(nid) ?? null);
        }

        // Apply new preferences
        for (const nid of nodeIds) {
            if (direction == null) this.manualLabelPreferences.delete(nid);
            else this.manualLabelPreferences.set(nid, direction);
        }
        this.invalidateLabels();
        this.drawLabels();

        if (!isFromProvenance && provenanceTracker.trrack) {
            provenanceTracker.trackSegmentLabelPreferences(
                nodeIds, direction, previousPreferences
            );
        }
    }

    // View mode delegates

    async showEdit(track = true) { return showEdit(this, track); }
    async showPresentation(track = true) { return showPresentation(this, track); }
    refreshVisualization(context = 'port_assignment') { return refreshVisualization(this, context); }

    // Cut removal delegate

    removeCut(node, isFromProvenance = false) { removeCut(this, node, isFromProvenance); }
}

/**
 * For each node, compute the maximum number of metro lines on any single incident edge.
 * This is used in presentation mode to size the node circle so it covers the widest bundle of lines.
 * @param {Object} setOrder - map of hypersetId -> array of station IDs
 * @param {Array} links - array of link objects with source/target
 * @returns {Map<string, number>} nodeId -> max lines on any incident edge
 */
function computeMaxLinesPerNode(setOrder, links) {
    // Count how many metro lines pass through each edge
    const edgeLineCounts = new Map();
    for (const [, stations] of Object.entries(setOrder)) {
        if (!stations || stations.length < 2) continue;
        for (let i = 0; i < stations.length - 1; i++) {
            const a = stations[i];
            const b = stations[i + 1];
            // Normalize edge key so both directions count the same
            const key = a < b ? `${a}|${b}` : `${b}|${a}`;
            edgeLineCounts.set(key, (edgeLineCounts.get(key) || 0) + 1);
        }
    }

    // For each node, find the max line count across all its incident edges
    const maxLinesPerNode = new Map();
    for (const link of links) {
        const sId = link.source.id ?? link.source;
        const tId = link.target.id ?? link.target;
        const key = sId < tId ? `${sId}|${tId}` : `${tId}|${sId}`;
        const count = edgeLineCounts.get(key) || 0;

        if (!maxLinesPerNode.has(sId) || maxLinesPerNode.get(sId) < count) {
            maxLinesPerNode.set(sId, count);
        }
        if (!maxLinesPerNode.has(tId) || maxLinesPerNode.get(tId) < count) {
            maxLinesPerNode.set(tId, count);
        }
    }

    return maxLinesPerNode;
}

