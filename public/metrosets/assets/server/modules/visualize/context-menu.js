/**
 * Context menu and line order dialog functionality
 */

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

let contextMenu = null;
let lineOrderDialog = null;
let lineOrderOverlay = null;

/**
 * Show context menu at specified position
 */
export function showContextMenu(x, y, items) {
    console.log('showContextMenu called at', x, y, 'with items:', items);

    // Remove existing context menu if any
    hideContextMenu();

    contextMenu = d3.select('body')
        .append('div')
        .attr('class', 'context-menu')
        .style('position', 'fixed')
        .style('left', `${x}px`)
        .style('top', `${y}px`)
        .style('display', 'block'); // Explicitly set display

    items.forEach(item => {
        const menuItem = contextMenu.append('div')
            .attr('class', 'context-menu-item');

        if (item.html) {
            menuItem.html(item.html);
        } else {
            menuItem.text(item.label);
        }

        menuItem.on('click', (event) => {
                event.stopPropagation();
                const currentMenu = contextMenu;
                item.action();
                // Only hide if the action didn't already replace/remove this menu
                if (contextMenu === currentMenu) {
                    hideContextMenu();
                }
            });
    });

    // Click anywhere else to close - delay this slightly to avoid immediate closure
    setTimeout(() => {
        d3.select('body').on('click.contextmenu', (event) => {
            if (!event.target.closest('.context-menu')) {
                hideContextMenu();
            }
        });
    }, 100);

    console.log('Context menu created');
}

/**
 * Hide context menu
 */
export function hideContextMenu() {
    if (contextMenu) {
        contextMenu.remove();
        contextMenu = null;
    }
    d3.select('body').on('click.contextmenu', null);
}

/**
 * Show line order dialog
 */
export function showLineOrderDialog(edgeKey, lineOrder, lineColors, onSave) {
    // Remove existing dialog if any
    hideLineOrderDialog();

    // Create overlay
    lineOrderOverlay = d3.select('body')
        .append('div')
        .attr('class', 'line-order-dialog-overlay')
        .on('click', hideLineOrderDialog);

    // Create dialog
    lineOrderDialog = d3.select('body')
        .append('div')
        .attr('class', 'line-order-dialog')
        .on('click', (event) => {
            event.stopPropagation(); // Prevent overlay click from closing
        });

    lineOrderDialog.append('h3')
        .text('Change Line Order');

    lineOrderDialog.append('p')
        .style('margin-bottom', '16px')
        .style('color', '#666')
        .text('Drag lines to reorder them on this edge');

    const list = lineOrderDialog.append('ul')
        .attr('class', 'line-order-list');

    // Create draggable list items
    const items = list.selectAll('.line-order-item')
        .data(lineOrder)
        .enter()
        .append('li')
        .attr('class', 'line-order-item')
        .attr('draggable', true)
        .html(d => `
            <div class="line-order-color" style="background-color: ${lineColors[d]}"></div>
            <span>Line ${d}</span>
        `);

    // Implement drag and drop
    let draggedElement = null;
    let draggedIndex = null;

    items.on('dragstart', function(event, d) {
        draggedElement = this;
        draggedIndex = lineOrder.indexOf(d);
        d3.select(this).classed('dragging', true);
        event.dataTransfer.effectAllowed = 'move';
    });

    items.on('dragover', function(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    });

    items.on('dragenter', function(event, d) {
        if (this !== draggedElement) {
            const dropIndex = lineOrder.indexOf(d);
            const item = lineOrder[draggedIndex];

            // Remove from old position
            lineOrder.splice(draggedIndex, 1);

            // Insert at new position
            lineOrder.splice(dropIndex, 0, item);

            // Update indices
            draggedIndex = dropIndex;

            // Re-render list
            updateListOrder(list, lineOrder, lineColors);

            // Reapply event handlers
            applyDragHandlers();
        }
    });

    items.on('dragend', function() {
        d3.select(this).classed('dragging', false);
        draggedElement = null;
        draggedIndex = null;
    });

    function applyDragHandlers() {
        const items = list.selectAll('.line-order-item');

        items.on('dragstart', function(event, d) {
            draggedElement = this;
            draggedIndex = lineOrder.indexOf(d);
            d3.select(this).classed('dragging', true);
            event.dataTransfer.effectAllowed = 'move';
        });

        items.on('dragover', function(event) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
        });

        items.on('dragenter', function(event, d) {
            if (this !== draggedElement) {
                const dropIndex = lineOrder.indexOf(d);
                const item = lineOrder[draggedIndex];

                lineOrder.splice(draggedIndex, 1);
                lineOrder.splice(dropIndex, 0, item);
                draggedIndex = dropIndex;

                updateListOrder(list, lineOrder, lineColors);
                applyDragHandlers();
            }
        });

        items.on('dragend', function() {
            d3.select(this).classed('dragging', false);
            draggedElement = null;
            draggedIndex = null;
        });
    }

    // Buttons
    const buttons = lineOrderDialog.append('div')
        .attr('class', 'line-order-buttons');

    buttons.append('button')
        .text('Cancel')
        .on('click', hideLineOrderDialog);

    buttons.append('button')
        .attr('class', 'primary')
        .text('Apply')
        .on('click', () => {
            onSave(edgeKey, lineOrder);
            hideLineOrderDialog();
        });

    // ESC key to close
    d3.select('body').on('keydown.linedialog', (event) => {
        if (event.key === 'Escape') {
            hideLineOrderDialog();
        }
    });
}

/**
 * Update list order without losing drag state
 */
function updateListOrder(list, lineOrder, lineColors) {
    const items = list.selectAll('.line-order-item')
        .data(lineOrder, d => d);

    items.order();

    items.html(d => `
        <div class="line-order-color" style="background-color: ${lineColors[d]}"></div>
        <span>Line ${d}</span>
    `);
}

/**
 * Hide line order dialog
 */
export function hideLineOrderDialog() {
    if (lineOrderDialog) {
        lineOrderDialog.remove();
        lineOrderDialog = null;
    }
    if (lineOrderOverlay) {
        lineOrderOverlay.remove();
        lineOrderOverlay = null;
    }
    d3.select('body').on('keydown.linedialog', null);
}

