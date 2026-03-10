/**
 * Legend rendering for the metro map presentation view.
 * Draws a color-keyed legend of all active metro lines.
 */

/**
 * Draw the metro lines legend in the bottom-right corner.
 * Only visible in presentation view when lines are shown.
 * @param {Object} vis - The Visualization instance
 */
export function drawLegend(vis) {
    vis.svg.selectAll(".legend-group").remove();

    if (vis.currentView !== 'presentation' || !vis.show_lines) return;

    const bounds = vis.svg.node().getBoundingClientRect();
    let width = bounds.width;
    let height = bounds.height;

    const vb = vis.svg.attr("viewBox");
    if (vb) {
        const parts = vb.split(/[\s,]+/).map(parseFloat);
        if (parts.length === 4) {
            width = parts[2];
            height = parts[3];
        }
    }

    const hypersetColors = vis.generateHypersetColors();
    const activeLines = [];

    if (vis.data.set_order) {
        Object.keys(vis.data.set_order).forEach(id => {
            const label = vis.data.sets?.[id]?.label || id;
            activeLines.push({ id, label, color: hypersetColors[id] || '#000' });
        });
    }

    activeLines.sort((a, b) => a.label.localeCompare(b.label));
    if (activeLines.length === 0) return;

    const padding = 15;
    const itemHeight = 20;
    const itemSpacing = 5;
    const colorBoxSize = 15;
    const fontSize = 14;
    const titleHeight = 30;

    const legend = vis.svg.append("g")
        .attr("class", "legend-group")
        .style("pointer-events", "none");

    const bg = legend.append("rect")
        .attr("class", "legend-bg")
        .attr("fill", "rgba(255, 255, 255, 0.9)")
        .attr("stroke", "#999")
        .attr("stroke-width", 1)
        .attr("rx", 5)
        .attr("ry", 5);

    legend.append("text")
        .attr("x", padding)
        .attr("y", padding + fontSize)
        .text("Metro Lines")
        .attr("font-weight", "bold")
        .attr("font-size", fontSize + 2)
        .attr("font-family", "sans-serif")
        .attr("fill", "#333");

    let maxWidth = 0;
    try {
        const titleNode = legend.select("text").node();
        if (titleNode?.getComputedTextLength) {
            maxWidth = titleNode.getComputedTextLength();
        }
    } catch { maxWidth = 100; }

    activeLines.forEach((line, i) => {
        const y = padding + titleHeight + i * (itemHeight + itemSpacing);

        legend.append("rect")
            .attr("x", padding).attr("y", y)
            .attr("width", colorBoxSize).attr("height", colorBoxSize)
            .attr("fill", line.color).attr("stroke", "none");

        const text = legend.append("text")
            .attr("x", padding + colorBoxSize + 10)
            .attr("y", y + colorBoxSize / 2 + 5)
            .text(line.label)
            .attr("font-size", fontSize)
            .attr("font-family", "sans-serif")
            .attr("fill", "#333")
            .attr("alignment-baseline", "middle");

        try {
            const node = text.node();
            if (node?.getComputedTextLength) {
                maxWidth = Math.max(maxWidth, node.getComputedTextLength() + colorBoxSize + 10);
            }
        } catch { /* ignore */ }
    });

    const legendWidth = maxWidth + padding * 2;
    const legendHeight = padding + titleHeight + activeLines.length * (itemHeight + itemSpacing) + padding;

    bg.attr("width", legendWidth).attr("height", legendHeight);

    const margin = 20;
    legend.attr("transform", `translate(${width - legendWidth - margin}, ${height - legendHeight - margin})`);
}

