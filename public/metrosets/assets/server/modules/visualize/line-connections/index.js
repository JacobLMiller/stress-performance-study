/**
 * Line connections module — station reordering and modal UI for editing
 * metro line connections.
 *
 * Re-exports the public API from internal modules.
 */

export {
    showLineConnectionsModal,
    closeLineConnectionsModal,
    updatePositionNumbersOverlay,
    isLineConnectionsModalOpen
} from './line-connections-modal.js';

export {
    calculateNewNodePosition,
    updateEdgeConnections,
    updateNodePositionAndLayout,
    isNodeOnSingleLine
} from './station-reorder-logic.js';

export {
    startReorderConnections,
    cancelReorderConnections,
    isReorderConnectionsActive
} from './reorder-connections.js';

