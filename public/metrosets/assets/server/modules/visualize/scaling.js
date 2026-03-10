/**
 * Scaling and coordinate transformation utilities
 */

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { visualization } from './ui-state.js';

// Shared configuration for both views
const SHARED_VIEW_CONFIG = {
    minNodeGapPx: 10,           // Minimum gap between node edges
    portDistanceExtra: 1.4,        // Extra spacing beyond nodeRadius + portRadius
    minPortRadius: 1.5           // Minimum port radius
};

export function createScales(nodes, width, height, edges = []) {
    const extentX = d3.extent(nodes, d => d.x);
    const extentY = d3.extent(nodes, d => d.y);
    const extentX_s = d3.extent(nodes, d => d.x_s);
    const extentY_s = d3.extent(nodes, d => d.y_s);

    const { xScale, yScale, scaleFactor: scaleFactor_init } = buildUniformScales(extentX, extentY, width, height);

    let xScale_s, yScale_s, scaleFactor_s;
    if (extentX_s[0] != null && extentY_s[0] != null) {
        ({ xScale: xScale_s, yScale: yScale_s, scaleFactor: scaleFactor_s } = buildUniformScales(extentX_s, extentY_s, width, height));
    } else {
        xScale_s = xScale;
        yScale_s = yScale;
        scaleFactor_s = scaleFactor_init;
    }

    // Calculate minimum edge length in schematized layout and recommended node radius
    let minEdgeLengthData = Infinity;
    for (const edge of edges) {
        const source = typeof edge.source === 'object' ? edge.source : nodes.find(n => n.id === edge.source);
        const target = typeof edge.target === 'object' ? edge.target : nodes.find(n => n.id === edge.target);
        if (!source || !target) continue;
        if (source.x_s === undefined || target.x_s === undefined) continue;

        const dx = target.x_s - source.x_s;
        const dy = target.y_s - source.y_s;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0 && len < minEdgeLengthData) {
            minEdgeLengthData = len;
        }
    }

    // Calculate what the min edge length will be in screen pixels
    const minEdgeLengthPx = minEdgeLengthData === Infinity ? 100 : minEdgeLengthData * scaleFactor_s;

    // Calculate unified sizing
    const nodeRadius = calculateNodeRadius(minEdgeLengthPx, SHARED_VIEW_CONFIG.minNodeGapPx);
    const portRadius = calculatePortRadius(nodeRadius, SHARED_VIEW_CONFIG.minPortRadius);
    const portDistance = nodeRadius + portRadius + SHARED_VIEW_CONFIG.portDistanceExtra;

    console.log(`[createScales] Min edge length: ${minEdgeLengthData.toFixed(1)} data units, ${minEdgeLengthPx.toFixed(1)}px`);
    console.log(`[createScales] Unified view - nodeRadius: ${nodeRadius.toFixed(1)}px, portRadius: ${portRadius.toFixed(1)}px, portDistance: ${portDistance.toFixed(1)}px`);

    return {
        xScale, yScale, xScale_s, yScale_s,
        scaleFactor_s,
        minEdgeLengthPx,

        // Unifed sizing
        nodeRadius,
        portRadius,
        portDistance
    };
}

// Helper function to calculate node radius based on minimum edge length and desired gap
function calculateNodeRadius(minEdgeLengthPx, minGapPx) {
    // minEdgeLengthPx = 2 * nodeRadius + minGapPx
    // nodeRadius = (minEdgeLengthPx - minGapPx) / 2
    let nodeRadius = Math.max(3, (minEdgeLengthPx - minGapPx) / 2);

    // Clamp to reasonable range
    nodeRadius = Math.min(nodeRadius, visualization.nodeRadius); // Don't exceed default
    nodeRadius = Math.max(nodeRadius, 3); // Minimum visible size

    return nodeRadius;
}

// Helper function to calculate port radius proportional to node radius
function calculatePortRadius(nodeRadius, minPortRadius) {
    const nodeScaleRatio = nodeRadius / visualization.nodeRadius;
    return Math.max(minPortRadius, visualization.portRadius * nodeScaleRatio);
}

function buildUniformScales(extentX, extentY, width, height) {
    const [minX, maxX] = extentX;
    const [minY, maxY] = extentY;
    const dataW = (maxX - minX) || 1;
    const dataH = (maxY - minY) || 1;

    const availW = width - 2 * visualization.margin;
    const availH = height - 2 * visualization.margin;
    const scale = Math.min(availW / dataW, availH / dataH);

    console.log(`[buildUniformScales] Data extent: [${minX.toFixed(1)}, ${maxX.toFixed(1)}] x [${minY.toFixed(1)}, ${maxY.toFixed(1)}]`);
    console.log(`[buildUniformScales] Data size: ${dataW.toFixed(1)} x ${dataH.toFixed(1)}`);
    console.log(`[buildUniformScales] Viewport: ${width} x ${height}, available: ${availW} x ${availH}`);
    console.log(`[buildUniformScales] Scale factor: ${scale.toFixed(4)} (pixels per data unit)`);
    console.log(`[buildUniformScales] Node diameter in data units: ${(20 / scale).toFixed(2)}`);

    const usedW = dataW * scale;
    const usedH = dataH * scale;
    const offsetX = (width - usedW) / 2;
    const offsetY = (height - usedH) / 2;

    const xScale = v => offsetX + (v - minX) * scale;
    xScale.invert = v => (v - offsetX) / scale + minX;

    const yScale = v => (height - offsetY) - (v - minY) * scale;
    yScale.invert = v => ((height - offsetY) - v) / scale + minY;

    return { xScale, yScale, scaleFactor: scale };
}

export function getPortPosition(portData, xScale, yScale, isSchematic = false, portDistance = null) {
    const directions = [
        { x: -1, y:  0 }, // 0: W
        { x: -1, y:  1 }, // 1: SW
        { x:  0, y:  1 }, // 2: S
        { x:  1, y:  1 }, // 3: SE
        { x:  1, y:  0 }, // 4: E
        { x:  1, y: -1 }, // 5: NE
        { x:  0, y: -1 }, // 6: N
        { x: -1, y: -1 }  // 7: NW
    ];

    const nodeX = xScale(isSchematic ? (portData.node.x_s ?? portData.node.x) : portData.node.x);
    const nodeY = yScale(isSchematic ? (portData.node.y_s ?? portData.node.y) : portData.node.y);

    // Use provided portDistance or default
    const distance = portDistance !== null ? portDistance : visualization.portDistance;

    const dir = directions[portData.octilinear_id];
    const isDiagonal = dir.x !== 0 && dir.y !== 0;
    const scale = isDiagonal ? (1 / Math.sqrt(2)) : 1;
    const screenDirY = -dir.y; // Flip Y for screen coordinates

    return {
        x: nodeX + dir.x * distance * scale,
        y: nodeY + screenDirY * distance * scale
    };
}
