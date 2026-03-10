/**
 * Drawing and rendering utilities for nodes, edges, and ports
 */
import { ui, visualization } from './ui-state.js';
import { getPortPosition } from './scaling.js';
export function drawNodes(zoomGroup, nodes, xScale, yScale, isSchematic = false, nodeRadius = null, isPresentation = false, maxLinesPerNode = null) {
    if (!zoomGroup) return;
    const nodeSelection = zoomGroup.selectAll(".node");

    // Use provided nodeRadius or default
    const radius = nodeRadius !== null ? nodeRadius : visualization.nodeRadius;

    // Metro line stroke width must match the value in metro-lines.js
    const lineStroke = 4;

    if (isSchematic) {
        nodeSelection
            .attr("cx", d => xScale(d.x_s ?? d.x))
            .attr("cy", d => yScale(d.y_s ?? d.y))
            .attr("r", isPresentation ? d => {
                // Size the node circle to exactly cover the widest bundle of metro lines
                const maxLines = (maxLinesPerNode && maxLinesPerNode.get(d.id)) || 1;
                return Math.max((maxLines * lineStroke) / 2 + 0.5, lineStroke / 2);
            } : radius);
    } else {
        nodeSelection
            .attr("cx", d => xScale(d.x))
            .attr("cy", d => yScale(d.y))
            .attr("r", radius); // Use calculated radius for initial view as well
    }

    // In presentation mode, make nodes white with black borders
    if (isPresentation) {
        nodeSelection
            .style("fill", "white")
            .style("stroke", "black")
            .style("stroke-width", 2);
    } else {
        nodeSelection
            .style("fill", "#69b3a2")
            .style("stroke", "#333")
            .style("stroke-width", 2);
    }
}
export function drawEdges(zoomGroup, links, xScale, yScale, xScale_s, yScale_s, currentView, showSchematicFeatures = false) {
    if (!zoomGroup) return;
    zoomGroup.selectAll(".link")
        .attr("d", d => createEdgePath(d, xScale, yScale, xScale_s, yScale_s, currentView, showSchematicFeatures));
}

/**
 * Refresh edge elements - rebind data and handle enter/exit for when edges are added/removed
 */
export function refreshEdgeElements(zoomGroup, links, xScale, yScale, xScale_s, yScale_s, currentView, showSchematicFeatures = false) {
    if (!zoomGroup) return;

    const edgeGroup = zoomGroup.select("g.edges");

    // Bind data with a key function to track edges
    const edgeSelection = edgeGroup.selectAll(".link")
        .data(links, d => `${d.source.id}-${d.target.id}`);

    // Enter: create new edges
    edgeSelection.enter()
        .append("path")
        .attr("class", "link")
        .style("fill", "none")
        .style("stroke-linejoin", "round")
        .style("stroke-linecap", "round")
        .style("stroke", d => d.color ? `#${d.color}` : "#999")
        .style("stroke-width", 2)
        .merge(edgeSelection)
        .attr("d", d => createEdgePath(d, xScale, yScale, xScale_s, yScale_s, currentView, showSchematicFeatures));

    // Exit: remove old edges
    edgeSelection.exit().remove();
}

export function drawLabels(zoomGroup, xScale, yScale, isSchematic = false, show = false, computedLabels = null, labelEditMode = 'full') {
    if (!zoomGroup) return;

    // If we have computed labels from the greedy algorithm, use those
    if (computedLabels && computedLabels.length > 0) {
        // Remove old labels and create new ones based on computed positions
        const labelGroup = zoomGroup.select("g.labels");
        labelGroup.selectAll(".label").remove();

        if (show) {
            // Remove old debug boxes
            labelGroup.selectAll(".debug-bbox").remove();

            const labelSelection = labelGroup.selectAll(".label")
                .data(computedLabels, d => d.Id)
                .enter()
                .append("text")
                .attr("class", "label")
                .text(d => d.Text)
                .attr("x", d => d.x)
                .attr("y", d => d.y)
                .attr("transform", d => {
                    const x = d.x;
                    const y = d.y;
                    return `rotate(${d.Angle}, ${x}, ${y})`;
                })
                .attr("text-anchor", d => {
                    // Convert Align to SVG text-anchor
                    if (d.Align === "C") return "middle";
                    if (d.Align === "L") return "start";
                    if (d.Align === "R") return "end";
                    return "start";
                })
                .attr("alignment-baseline", "middle")
                .style("font-family", "Arial, sans-serif")
                .style("font-size", d => `${d.FontSize}px`)
                .style("pointer-events", "all")
                .style("fill", "#333")
                .style("opacity", d => {
                    if (labelEditMode === 'drafting') {
                        return d.isFixed ? 1.0 : 0.2;
                    }
                    return 1.0;
                });

            // Add tooltips
            labelSelection.append("title").text(d => d.FullText);

            // Draw debug bounding boxes by measuring the actual rendered text
            if (false) {
            labelSelection.each(function(d) {
                const textEl = this;
                const bbox = textEl.getBBox();

                // Positions are already in screen pixels
                const x = d.x;
                const y = d.y;
                const angleRad = d.Angle * Math.PI / 180;
                const cos = Math.cos(angleRad);
                const sin = Math.sin(angleRad);

                // bbox gives us the unrotated bounding box in local coordinates
                // We need to rotate the corners around the text anchor point (x, y)
                const corners = [
                    { x: bbox.x, y: bbox.y },
                    { x: bbox.x + bbox.width, y: bbox.y },
                    { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
                    { x: bbox.x, y: bbox.y + bbox.height }
                ];

                // Rotate each corner around (x, y)
                const rotatedCorners = corners.map(c => {
                    const dx = c.x - x;
                    const dy = c.y - y;
                    return {
                        x: x + dx * cos - dy * sin,
                        y: y + dx * sin + dy * cos
                    };
                });

                const points = rotatedCorners.map(p => `${p.x},${p.y}`).join(" ");

                labelGroup.append("polygon")
                    .attr("class", "debug-bbox")
                    .attr("points", points)
                    .style("fill", "none")
                    .style("stroke", "red")
                    .style("stroke-width", "1px");
            });
            }
        }
    } else {
        // Fallback to simple positioning if no computed labels
        if (isSchematic) {
            zoomGroup.selectAll(".label")
                .attr("x", d => xScale(d.x_s) + 2 * visualization.nodeRadius)
                .attr("y", d => yScale(d.y_s))
                .style("opacity", show ? 1 : 0);
        } else {
            zoomGroup.selectAll(".label")
                .attr("x", d => xScale(d.x) + 2 * visualization.nodeRadius)
                .attr("y", d => yScale(d.y))
                .style("opacity", show ? 1 : 0);
        }
    }
}
export function drawPorts(zoomGroup, portData, xScale, yScale, xScale_s, yScale_s, currentView, getPortFillColor, portRadius = null, portDistance = null) {
    if (!zoomGroup) return;
    const useSchematic = currentView === 'schematic' || currentView === 'presentation';
    const xs = useSchematic ? xScale_s : xScale;
    const ys = useSchematic ? yScale_s : yScale;

    // Use provided portDistance for position calculation
    const portSelection = zoomGroup.selectAll(".port");
    portSelection
        .attr("cx", d => getPortPosition(d, xs, ys, useSchematic, portDistance).x)
        .attr("cy", d => getPortPosition(d, xs, ys, useSchematic, portDistance).y)
        .style("fill", d => getPortFillColor(d));

    // Update port radius if provided
    if (portRadius !== null) {
        portSelection.attr("r", portRadius);
    }
}

export function drawCutNodes(zoomGroup, nodes, xScale, yScale, xScale_s, yScale_s, currentView, eventHandlers, showSchematicFeatures = false) {
    if (!zoomGroup) return;

    // Check if cuts group exists, if not create it (should be created in setupSVGElements but safety first)
    if (zoomGroup.select("g.cuts").empty()) {
        const edgeGroup = zoomGroup.select("g.edges");
        if (!edgeGroup.empty()) {
             // Insert after edges
             zoomGroup.insert("g", "g.edges + *").attr("class", "cuts");
        } else {
             zoomGroup.append("g").attr("class", "cuts");
        }
    }

    const cutGroup = zoomGroup.select("g.cuts");
    const useSchematicView = currentView === 'schematic' || currentView === 'presentation';
    const shouldDraw = useSchematicView || showSchematicFeatures; // Draw in edit mode too if features enabled

    const xs = useSchematicView ? xScale_s : xScale;
    const ys = useSchematicView ? yScale_s : yScale;
    const xProp = useSchematicView ? 'x_s' : 'x';
    const yProp = useSchematicView ? 'y_s' : 'y';

    // Filter for dummy nodes (introduces by cutting tool)
    const dummyNodes = nodes.filter(n => n.isDummy);

    const cuts = cutGroup.selectAll(".cut-point")
        .data(dummyNodes, d => d.id);

    cuts.enter()
        .append("rect")
        .attr("class", "cut-point")
        .style("cursor", "pointer")
        .on("contextmenu", (event, d) => eventHandlers.handleCutContextMenu(event, d))
        .merge(cuts)
        .attr("width", 12)
        .attr("height", 12)
        .style("fill", "white")
        .style("fill-opacity", 0.4)
        .style("stroke", "none")
        .attr("x", d => xs(d[xProp] ?? d.x) - 6)
        .attr("y", d => ys(d[yProp] ?? d.y) - 6)
        .style("display", shouldDraw ? null : "none");

    cuts.exit().remove();
}

export function createEdgePath(edge, xScale, yScale, xScale_s, yScale_s, currentView, showSchematicFeatures = false) {
    const useSchematicView = currentView === 'schematic' || currentView === 'presentation';
    const shouldDrawSchematic = useSchematicView || showSchematicFeatures;

    const xs = useSchematicView ? xScale_s : xScale;
    const ys = useSchematicView ? yScale_s : yScale;
    const sx = xs(useSchematicView ? edge.source.x_s ?? edge.source.x : edge.source.x);
    const sy = ys(useSchematicView ? edge.source.y_s ?? edge.source.y : edge.source.y);
    const tx = xs(useSchematicView ? edge.target.x_s ?? edge.target.x : edge.target.x);
    const ty = ys(useSchematicView ? edge.target.y_s ?? edge.target.y : edge.target.y);
    if (shouldDrawSchematic && edge.bend) {
        const bx = xs(edge.bend.x);
        const by = ys(edge.bend.y);
        return `M${sx},${sy} L${bx},${by} L${tx},${ty}`;
    }
    return `M${sx},${sy} L${tx},${ty}`;
}
export function updateRoseVisibility(zoomGroup, currentView) {
    // Line handles removed - this function is kept for compatibility but does nothing
}
export function getPortFillColor(portData) {
    if (ui.selected_port && ui.selected_port.port.id === portData.port.id) {
        return "yellow";
    }
    return portData.port.usedCount > 0 ? "grey" : "white";
}
export function setupSVGElements(svg, links, nodes, eventHandlers) {
    const edgeGroup = svg.append("g").attr("class", "edges");
    svg.append("g").attr("class", "cuts"); // Changed from bends to cuts
    svg.append("g").attr("class", "metro-lines");
    const nodeGroup = svg.append("g").attr("class", "nodes");
    svg.append("g").attr("class", "ports");
    const labelGroup = svg.append("g").attr("class", "labels");
    // Create edges
    edgeGroup.selectAll(".link")
        .data(links)
        .enter()
        .append("path")
        .attr("class", "link")
        .style("fill", "none")
        .style("stroke-linejoin", "round")
        .style("stroke-linecap", "round")
        .style("stroke", d => d.color ? `#${d.color}` : "#999")
        .style("stroke-width", 2);
    // Create nodes (filter out dummy nodes)
    nodeGroup.selectAll(".node")
        .data(nodes.filter(n => !n.isDummy))
        .enter()
        .append("circle")
        .attr("class", "node")
        .attr("id", d => d.id)
        .attr("r", visualization.nodeRadius)
        .style("fill", "#69b3a2")
        .style("stroke", "#333")
        .style("stroke-width", 2)
        .on("mouseenter", (event, d) => eventHandlers.handleNodeHover(d))
        .on("mouseleave", eventHandlers.handleMouseLeave)
        .on("contextmenu", (event, d) => eventHandlers.handleNodeContextMenu(event, d));
    labelGroup.selectAll(".label")
        .data(nodes.filter(n => !n.isDummy))
        .enter()
        .append("text")
        .attr("class", "label")
        .text(d => d.label)
        .attr("text-anchor", "left")
        .attr("alignment-baseline", "middle")
        .style("font-family", "Arial, sans-serif")
        .style("font-size", "10px")
        .style("pointer-events", "none");
}
export function refreshPortElements(zoomGroup, nodes, eventHandlers) {
    if (!zoomGroup) return;
    const portGroup = zoomGroup.select("g.ports");
    const portData = [];
    // Filter out dummy nodes when collecting port data
    nodes.filter(n => !n.isDummy).forEach(node => {
        if (node.ports) {
            node.ports.forEach(port => {
                portData.push({ port, node, octilinear_id: port.octilinear_id });
            });
        }
    });

    // Update the data binding and refresh fill colors for existing ports
    const sel = portGroup.selectAll(".port").data(portData, d => d.port.id);

    // For any new ports that need to be created (shouldn't happen normally, but just in case)
    sel.enter()
        .append("circle")
        .attr("class", "port")
        .attr("r", 3) // Default radius, will be updated by updatePorts()
        .style("stroke", "#333")
        .style("stroke-width", 1)
        .on("mouseenter", eventHandlers.handlePortHover)
        .on("mouseleave", eventHandlers.handlePortLeave)
        .on("click", eventHandlers.handlePortClick)
        .on("dblclick", eventHandlers.handlePortDoubleClick);

    // Update fill color for all ports (both existing and new)
    portGroup.selectAll(".port")
        .style("fill", d => getPortFillColor(d));

    sel.exit().remove();
}