/**
 * UI state management for visualization interactions
 */

export const ui = {
    hover_node: null,
    hover_edge: null,
    selected_port: null
};

export const visualization = {
    margin: 25,
    nodeRadius: 10,
    portRadius: 2,
    portDistance: 14, // nodeRadius + portRadius + 2
};

export function resetUIState() {
    ui.hover_node = null;
    ui.hover_edge = null;
}

export function setHoverNode(node) {
    ui.hover_node = node;
}
export function setSelectedPort(portData) {
    ui.selected_port = portData;
}

export function clearSelectedPort() {
    ui.selected_port = null;
}

