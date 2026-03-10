/**
 * Node editing module — context menu, modals, and graph-mutation operations
 * for adding, removing, and extending nodes on the metro map.
 *
 * Re-exports the public API from internal modules.
 */

export {
    showNodeContextMenu
} from './node-context-menu.js';

export {
    removeNode,
    addNode,
    extendLinesToNode,
    getLinesAtNode,
    getExtendableLines,
    generateUniqueNodeId,
    getInsertionCandidates,
    validateLineSelection
} from './node-operations.js';

export {
    showAddNodeModal,
    showExtendLinesModal,
    closeAddNodeModal
} from './node-modals.js';

