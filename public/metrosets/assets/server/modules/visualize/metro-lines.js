/**
 * Metro line rendering - draws the colored metro lines along station paths,
 * handles line ordering, bend curves, and context menus on line segments.
 */

import { get_line_order } from '../line-crossing-minimization.js';
import { assignLineColors } from './line-colors.js';
import { showContextMenu } from './context-menu.js';
import { showLineConnectionsModal } from './line-connections/index.js';
import { startReorderConnections } from './line-connections/index.js';

/**
 * Draw metro lines on the visualization.
 * @param {Object} vis - The Visualization instance
 */
export function drawMetrolines(vis) {
    if (!vis.show_lines) return;

    const useSchematic = vis.currentView === 'schematic' || vis.currentView === 'presentation';
    const xScale = useSchematic ? vis.xScale_s : vis.xScale;
    const yScale = useSchematic ? vis.yScale_s : vis.yScale;
    const coordX = useSchematic ? 'x_s' : 'x';
    const coordY = useSchematic ? 'y_s' : 'y';

    const nodeDict = new Map(vis.nodes.map(node => [node.id, node]));
    const edgeDict = new Map();
    vis.links.forEach(link => {
        const key1 = `${link.source.id}|${link.target.id}`;
        const key2 = `${link.target.id}|${link.source.id}`;
        edgeDict.set(key1, link);
        edgeDict.set(key2, link);
    });

    // Get optimal line order for each edge
    const paths = vis.data.set_order;
    const layout = new Map();
    vis.nodes.forEach(node => {
        layout.set(node.id, { x: node[coordX], y: node[coordY] });
    });

    const edgeLineOrder = get_line_order(paths, layout);

    // Override with custom line orders
    for (const [edgeKey, customOrder] of vis.customLineOrders.entries()) {
        edgeLineOrder.set(edgeKey, customOrder);
    }

    const hypersetColors = generateHypersetColors(vis);
    const metroLinesData = buildMetroLinesData(vis.data.set_order, nodeDict, edgeDict, edgeLineOrder, hypersetColors, xScale, yScale, coordX, coordY, useSchematic);

    // Ensure metro-lines group exists in the correct layer
    let metroLinesGroup = vis.zoomGroup.select("g.metro-lines");
    if (!metroLinesGroup.node()) {
        const nodeGroup = vis.zoomGroup.select("g.nodes");
        if (nodeGroup.node()) {
            metroLinesGroup = vis.zoomGroup.insert("g", "g.nodes").attr("class", "metro-lines");
        } else {
            metroLinesGroup = vis.zoomGroup.append("g").attr("class", "metro-lines");
        }
    } else {
        metroLinesGroup.selectAll("*").remove();
    }

    const pathsToRender = computeRenderPaths(metroLinesData);
    const lineStroke = 4;

    metroLinesGroup.selectAll(".metro-line-segment")
        .data(pathsToRender)
        .enter()
        .append("path")
        .attr("class", "metro-line-segment")
        .attr("d", d => d.path)
        .attr("stroke", d => d.color)
        .attr("stroke-width", lineStroke - 1)
        .attr("fill", "none")
        .attr("opacity", 0.7)
        .style("cursor", "pointer")
        .on("contextmenu", function (event, d) {
            event.preventDefault();
            event.stopPropagation();
            showContextMenu(event.pageX, event.pageY, [
                {
                    label: 'View Line Connections',
                    action: () => showLineConnectionsModal(vis, d.hypersetId)
                },
                {
                    label: 'Reorder Connections',
                    action: () => startReorderConnections(vis, d.hypersetId)
                }
            ]);
        });
}

/**
 * Toggle metro line visibility.
 * @param {Object} vis - The Visualization instance
 */
export function toggleMetrolines(vis) {
    vis.show_lines = !vis.show_lines;

    if (vis.show_labels) {
        vis.invalidateLabels();
    }

    if (!vis.data.set_order || !vis.nodes) {
        console.warn("Cannot toggle metro lines: missing required data");
        return;
    }

    if (!vis.show_lines) {
        vis.zoomGroup.selectAll(".metro-line").remove();
        vis.zoomGroup.selectAll(".metro-lines").remove();
        if (vis.show_labels) vis.drawLabels();
        vis.drawLegend();
        return;
    }

    drawMetrolines(vis);
    if (vis.show_labels) vis.drawLabels();
    vis.drawLegend();
}

/**
 * Generate colors for all hypersets/metro lines.
 * Uses colors defined in data.sets, falling back to the heuristic color assignment.
 * @param {Object} vis - The Visualization instance
 * @returns {Object} Map of hypersetId -> color string
 */
export function generateHypersetColors(vis) {
    const hypersetColors = {};

    if (vis.data.sets) {
        for (const [hypersetId, setData] of Object.entries(vis.data.sets)) {
            if (setData.color) {
                hypersetColors[hypersetId] = `#${setData.color}`;
            }
        }
    }

    const hypersetIds = Object.keys(vis.data.set_order || {});
    const uncoloredHypersets = hypersetIds.filter(id => !hypersetColors[id]);

    if (uncoloredHypersets.length > 0) {
        const assignedColors = assignLineColors(vis.data.set_order);
        for (const hypersetId of uncoloredHypersets) {
            hypersetColors[hypersetId] = assignedColors[hypersetId];
        }
    }

    return hypersetColors;
}

// Internal helpers

function buildMetroLinesData(setOrder, nodeDict, edgeDict, edgeLineOrder, hypersetColors, xScale, yScale, coordX, coordY, useSchematic) {
    const lineStroke = 4;
    const metroLinesData = [];

    for (const [hypersetId, nodeOrder] of Object.entries(setOrder)) {
        if (!nodeOrder || nodeOrder.length < 2) continue;

        const pathSegments = [];
        let validPath = true;

        for (let i = 0; i < nodeOrder.length - 1; i++) {
            const sourceId = nodeOrder[i];
            const targetId = nodeOrder[i + 1];

            if (!nodeDict.has(sourceId) || !nodeDict.has(targetId)) {
                validPath = false;
                break;
            }

            const sourceNode = nodeDict.get(sourceId);
            const targetNode = nodeDict.get(targetId);

            const edgeKey = `${sourceId}|${targetId}`;
            const edge = edgeDict.get(edgeKey);
            const hasBend = useSchematic && edge && edge.bend;

            const sx = xScale(sourceNode[coordX]);
            const sy = yScale(sourceNode[coordY]);
            const tx = xScale(targetNode[coordX]);
            const ty = yScale(targetNode[coordY]);

            const orderedLines = edgeLineOrder.get(edgeKey) || [];
            const totalLinesOnEdge = orderedLines.length;
            const lineIndex = orderedLines.indexOf(hypersetId);
            const offset = (lineIndex - (totalLinesOnEdge - 1) / 2) * lineStroke;

            if (hasBend) {
                const bx = xScale(edge.bend.x);
                const by = yScale(edge.bend.y);

                pathSegments.push({
                    source: { x: sx, y: sy }, target: { x: bx, y: by },
                    offset, hasBend: true, edgeKey
                });
                pathSegments.push({
                    source: { x: bx, y: by }, target: { x: tx, y: ty },
                    offset, hasBend: true, edgeKey
                });
            } else {
                pathSegments.push({
                    source: { x: sx, y: sy }, target: { x: tx, y: ty },
                    offset, hasBend: false, edgeKey
                });
            }
        }

        if (validPath) {
            metroLinesData.push({ id: hypersetId, color: hypersetColors[hypersetId], segments: pathSegments });
        }
    }

    return metroLinesData;
}

function computeRenderPaths(metroLinesData) {
    const allSegments = [];
    metroLinesData.forEach(lineData => {
        lineData.segments.forEach(seg => {
            allSegments.push({
                hypersetId: lineData.id, color: lineData.color,
                segment: seg, edgeKey: seg.edgeKey
            });
        });
    });

    // Group segments by hyperset + edge key to identify bend pairs
    const segmentsByKey = new Map();
    allSegments.forEach(seg => {
        const key = `${seg.hypersetId}|${seg.edgeKey}`;
        if (!segmentsByKey.has(key)) segmentsByKey.set(key, []);
        segmentsByKey.get(key).push(seg);
    });

    const drawnSegments = new Set();
    const pathsToRender = [];

    allSegments.forEach((segData, idx) => {
        if (drawnSegments.has(idx)) return;

        const seg = segData.segment;
        const dx = seg.target.x - seg.source.x;
        const dy = seg.target.y - seg.source.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length === 0) return;

        const offsetX = -dy / length * seg.offset;
        const offsetY = dx / length * seg.offset;
        const sourceX = seg.source.x + offsetX;
        const sourceY = seg.source.y + offsetY;
        const targetX = seg.target.x + offsetX;
        const targetY = seg.target.y + offsetY;

        const segmentKey = `${segData.hypersetId}|${segData.edgeKey}`;
        const segmentsForEdge = segmentsByKey.get(segmentKey) || [];

        if (segmentsForEdge.length === 2 &&
            seg.hasBend &&
            segmentsForEdge[0].segment.hasBend &&
            segmentsForEdge[1].segment.hasBend) {

            const firstSegIdx = allSegments.indexOf(segmentsForEdge[0]);
            const secondSegIdx = allSegments.indexOf(segmentsForEdge[1]);

            if (!drawnSegments.has(firstSegIdx) && !drawnSegments.has(secondSegIdx)) {
                const seg1 = segmentsForEdge[0].segment;
                const seg2 = segmentsForEdge[1].segment;

                const calcOffset = (s) => {
                    const ddx = s.target.x - s.source.x;
                    const ddy = s.target.y - s.source.y;
                    const len = Math.sqrt(ddx * ddx + ddy * ddy);
                    return len > 0
                        ? { x: -ddy / len * s.offset, y: ddx / len * s.offset }
                        : { x: 0, y: 0 };
                };

                const off1 = calcOffset(seg1);
                const off2 = calcOffset(seg2);

                const s1x = seg1.source.x + off1.x;
                const s1y = seg1.source.y + off1.y;
                const bendX = seg1.target.x + off1.x;
                const bendY = seg1.target.y + off1.y;
                const s2x = seg2.target.x + off2.x;
                const s2y = seg2.target.y + off2.y;

                pathsToRender.push({
                    hypersetId: segData.hypersetId, color: segData.color,
                    path: `M ${s1x},${s1y} Q ${bendX},${bendY} ${s2x},${s2y}`,
                    isBend: true
                });

                drawnSegments.add(firstSegIdx);
                drawnSegments.add(secondSegIdx);
            }
        } else {
            pathsToRender.push({
                hypersetId: segData.hypersetId, color: segData.color,
                path: `M ${sourceX},${sourceY} L ${targetX},${targetY}`,
                isBend: false
            });
            drawnSegments.add(idx);
        }
    });

    return pathsToRender;
}

