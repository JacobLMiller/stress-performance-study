/**
 * Line coloring module - assigns visually distinct colors to metro lines
 * Based on the heuristic from lineColors.py
 */

import { lab, rgb } from "https://cdn.jsdelivr.net/npm/d3-color@3/+esm";

const COLORS = [
    '#4E79A7', '#E15759', '#59A14F', '#D37295', '#9D7660', 
    '#F28E2B', '#499894', '#79706E', '#B07AA1', '#B6992D', 
    '#A0CBE8', '#FFBE7D', '#8CD17D', '#F1CE63', '#86BCB6', 
    '#FF9D9A', '#BAB0AC', '#FABFD2', '#D4A6C8', '#D7B5A6'
];

/**
 * Convert hex color to Lab color space
 */
function hexToLab(hexColor) {
    const rgbColor = rgb(hexColor);
    const labColor = lab(rgbColor);
    return labColor;
}

/**
 * Calculate color difference using CIE1976 formula
 * This is the delta E formula used in the Python version
 */
function colorDifferenceCIE76(lab1, lab2) {
    const deltaL = lab1.l - lab2.l;
    const deltaA = lab1.a - lab2.a;
    const deltaB = lab1.b - lab2.b;
    return Math.sqrt(deltaL * deltaL + deltaA * deltaA + deltaB * deltaB);
}

/**
 * Calculate the intersection size between two paths
 */
function calculateIntersection(path1, path2) {
    const set1 = new Set(path1);
    const set2 = new Set(path2);
    let intersection = 0;
    for (const node of set1) {
        if (set2.has(node)) {
            intersection++;
        }
    }
    return intersection;
}

/**
 * Assign colors to metro lines using a heuristic that maximizes
 * color difference between heavily intersecting lines.
 * 
 * @param {Object} paths - Dictionary where keys are line IDs and values are arrays of node IDs
 * @returns {Object} Dictionary mapping line IDs to hex color strings
 */
export function assignLineColors(paths) {
    const lineIds = Object.keys(paths);
    const numLines = lineIds.length;
    
    if (numLines === 0) {
        return {};
    }

    // Precompute Lab colors
    const colorsLab = COLORS.map(hexToLab);
    
    // Precompute color differences
    const colorDiff = new Map();
    for (let i = 0; i < COLORS.length; i++) {
        for (let j = i + 1; j < COLORS.length; j++) {
            const diff = colorDifferenceCIE76(colorsLab[i], colorsLab[j]);
            colorDiff.set(`${COLORS[i]},${COLORS[j]}`, diff);
            colorDiff.set(`${COLORS[j]},${COLORS[i]}`, diff);
        }
    }

    // Extend color palette if needed
    const repeat = Math.floor(numLines / COLORS.length) + 1;
    let availableColors = [];
    let availableColorsLab = [];
    
    for (let i = 0; i < repeat; i++) {
        availableColors.push(...COLORS);
        availableColorsLab.push(...colorsLab);
    }
    
    availableColors = availableColors.slice(0, numLines);
    availableColorsLab = availableColorsLab.slice(0, numLines);

    // Build color graph
    const colorGraph = new Map();
    const assignedColors = [];
    
    for (const lineId of lineIds) {
        colorGraph.set(lineId, {
            neighbors: [],
            color: null,
            colorLab: null
        });
    }

    // Build edges with intersection weights
    const edges = [];
    for (let i = 0; i < lineIds.length; i++) {
        for (let j = i + 1; j < lineIds.length; j++) {
            const line1 = lineIds[i];
            const line2 = lineIds[j];
            const intersectionSize = calculateIntersection(paths[line1], paths[line2]);
            
            if (intersectionSize > 0) {
                edges.push({ line1, line2, intersection: intersectionSize });
                
                colorGraph.get(line1).neighbors.push({
                    id: line2,
                    weight: intersectionSize
                });
                colorGraph.get(line2).neighbors.push({
                    id: line1,
                    weight: intersectionSize
                });
            }
        }
    }

    // Sort edges by intersection size (descending)
    edges.sort((a, b) => b.intersection - a.intersection);

    // Process edges in order of intersection size
    for (const edge of edges) {
        let { line1, line2 } = edge;
        const node1 = colorGraph.get(line1);
        const node2 = colorGraph.get(line2);

        // Skip if both already have colors
        if (node1.color && node2.color) {
            continue;
        }

        // Calculate total degree (weighted) for each line
        const total1 = node1.neighbors.reduce((sum, n) => sum + n.weight, 0);
        const total2 = node2.neighbors.reduce((sum, n) => sum + n.weight, 0);

        // Process higher degree node first
        if (total2 > total1) {
            [line1, line2] = [line2, line1];
        }

        // Assign color to line1 if it doesn't have one
        if (!colorGraph.get(line1).color) {
            const color = assignColorToLine(
                line1,
                colorGraph,
                availableColors,
                availableColorsLab,
                assignedColors,
                edge.intersection
            );
            
            if (color) {
                const idx = availableColors.indexOf(color);
                availableColors.splice(idx, 1);
                availableColorsLab.splice(idx, 1);
            }
        }

        // Assign color to line2 if it doesn't have one
        if (!colorGraph.get(line2).color) {
            const color = assignColorToLine(
                line2,
                colorGraph,
                availableColors,
                availableColorsLab,
                assignedColors,
                edge.intersection
            );
            
            if (color) {
                const idx = availableColors.indexOf(color);
                availableColors.splice(idx, 1);
                availableColorsLab.splice(idx, 1);
            }
        }
    }

    // Handle any uncolored lines (isolated lines with no intersections)
    for (const lineId of lineIds) {
        const node = colorGraph.get(lineId);
        if (!node.color && availableColors.length > 0) {
            node.color = availableColors[0];
            node.colorLab = availableColorsLab[0];
            assignedColors.push(availableColorsLab[0]);
            availableColors.shift();
            availableColorsLab.shift();
        }
    }

    // Build result dictionary
    const colorDict = {};
    for (const lineId of lineIds) {
        const node = colorGraph.get(lineId);
        colorDict[lineId] = node.color || COLORS[0];
    }

    return colorDict;
}

/**
 * Assign a color to a specific line, maximizing difference from neighbors
 */
function assignColorToLine(lineId, colorGraph, availableColors, availableColorsLab, assignedColors, edgeWeight) {
    const node = colorGraph.get(lineId);
    const colorDiffs = new Array(availableColors.length).fill(0);

    // Calculate color differences from all neighbors that have colors
    for (const neighbor of node.neighbors) {
        const neighborNode = colorGraph.get(neighbor.id);
        if (neighborNode.colorLab) {
            for (let i = 0; i < availableColorsLab.length; i++) {
                colorDiffs[i] += colorDifferenceCIE76(neighborNode.colorLab, availableColorsLab[i]) * neighbor.weight;
            }
        }
    }

    // If no neighbors have colors yet, maximize difference from already assigned colors
    if (Math.max(...colorDiffs) <= 0) {
        for (let i = 0; i < availableColorsLab.length; i++) {
            for (const assignedLab of assignedColors) {
                colorDiffs[i] -= colorDifferenceCIE76(availableColorsLab[i], assignedLab);
            }
        }
    }

    // Select color with maximum difference
    const bestIndex = colorDiffs.indexOf(Math.max(...colorDiffs));
    const selectedColor = availableColors[bestIndex];
    const selectedColorLab = availableColorsLab[bestIndex];

    node.color = selectedColor;
    node.colorLab = selectedColorLab;
    assignedColors.push(selectedColorLab);

    return selectedColor;
}

