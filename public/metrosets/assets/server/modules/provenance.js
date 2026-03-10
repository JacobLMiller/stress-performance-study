import { Port, DIRECTIONS } from './schematize/port.js';
import { isReorderConnectionsActive, undoReorderClick, redoReorderClick } from './visualize/line-connections/reorder-connections.js';

const { Registry, initializeTrrack } = Trrack;

class ProvenanceTracker {
    constructor() {
        this.registry = Registry.create();
        this.trrack = null;
        this.visualization = null;
        this.setupActions();
        this.setupKeyboardShortcuts();
    }

    initialize(visualization) {
        this.visualization = visualization;
        // Create initial state snapshot
        const initialState = this.captureState();
        this.trrack = initializeTrrack({
            initialState,
            registry: this.registry
        });
        console.log("Provenance tracking initialized");
    }

    setupActions() {
        // Assign / change a single edge's port mapping
        this.registry.register("assign_port", (payload) => {
            if (this.visualization && payload) {
                const { sourceId, targetId, assignment } = payload;
                const key = `${sourceId}-${targetId}`;
                if (assignment) {
                    this.visualization.data.fixedAssignments.set(key, assignment);
                } else {
                    this.visualization.data.fixedAssignments.delete(key);
                }
                this.visualization.refreshVisualization('port_assignment');
            }
            return {
                undo: {
                    type: "restore_port_assignment",
                    payload: {
                        sourceId: payload.sourceId,
                        targetId: payload.targetId,
                        previousAssignment: payload.previousAssignment,
                        newAssignment: payload.assignment // for redo
                    }
                }
            };
        });

        // Restore (undo) a single edge's previous port mapping
        this.registry.register("restore_port_assignment", (payload) => {
            if (this.visualization && payload) {
                const { sourceId, targetId, previousAssignment } = payload;
                const key = `${sourceId}-${targetId}`;
                if (previousAssignment) {
                    this.visualization.data.fixedAssignments.set(key, previousAssignment);
                } else {
                    this.visualization.data.fixedAssignments.delete(key);
                }
                this.visualization.refreshVisualization('port_assignment');
            }
            return {
                undo: {
                    type: "assign_port",
                    payload: {
                        sourceId: payload.sourceId,
                        targetId: payload.targetId,
                        assignment: payload.newAssignment,
                        previousAssignment: payload.previousAssignment
                    }
                }
            };
        });

        // Straighten path (multiple assignments in batch)
        this.registry.register("straighten_path", (payload) => {
            if (this.visualization && payload) {
                const { assignments } = payload; // list of {key, assignment}
                assignments.forEach(({ key, assignment }) => {
                    if (assignment) this.visualization.data.fixedAssignments.set(key, assignment);
                });
                this.visualization.refreshVisualization('path_straightening');
            }
            return {
                undo: {
                    type: "restore_path_assignments",
                    payload: {
                        previousAssignments: payload.previousAssignments, // list of {key, assignment|null}
                        newAssignments: payload.assignments
                    }
                }
            };
        });

        // Restore previous batch of path assignments
        this.registry.register("restore_path_assignments", (payload) => {
            if (this.visualization && payload) {
                const { previousAssignments } = payload; // list of {key, assignment|null}
                previousAssignments.forEach(({ key, assignment }) => {
                    if (assignment) {
                        this.visualization.data.fixedAssignments.set(key, assignment);
                    } else {
                        this.visualization.data.fixedAssignments.delete(key);
                    }
                });
                this.visualization.refreshVisualization('path_straightening');
            }
            return {
                undo: {
                    type: "straighten_path",
                    payload: {
                        assignments: payload.newAssignments,
                        previousAssignments: payload.previousAssignments
                    }
                }
            };
        });

        // View change (edit <-> presentation)
        this.registry.register("change_view", (payload) => {
            if (this.visualization && payload) {
                const { view } = payload;
                if (view === 'presentation') {
                    this.visualization.showPresentation(false);
                } else {
                    this.visualization.showEdit(false);
                }
            }
            return {
                undo: {
                    type: "change_view",
                    payload: {
                        view: payload.previousView,
                        previousView: payload.view
                    }
                }
            };
        });

        // Node drag (movement)
        this.registry.register("drag_node", (payload) => {
            if (this.visualization && payload) {
                const { nodeId, position, hasManualEdits } = payload;

                // Update node position
                const node = this.visualization.nodes.find(n => n.id === nodeId);
                if (node) {
                    node.x = position.x;
                    node.y = position.y;
                    node.fx = null;
                    node.fy = null;

                    // Also update data.nodes source to ensure consistency
                    const dataNode = this.visualization.data.nodes.find(n => n.id === nodeId);
                    if (dataNode) {
                        dataNode.x = position.x;
                        dataNode.y = position.y;
                        dataNode.x_original = position.x;
                        dataNode.y_original = position.y;
                    }
                }

                // Restore manual edits flag
                this.visualization.hasManualEdits = hasManualEdits;

                // Trigger refresh to update layout and ports
                this.visualization.refreshVisualization('node_drag');
            }
            return {
                undo: {
                    type: "drag_node",
                    payload: {
                        nodeId: payload.nodeId,
                        position: payload.prevPosition,
                        hasManualEdits: payload.prevHasManualEdits,
                        // For redo
                        prevPosition: payload.position,
                        prevHasManualEdits: payload.hasManualEdits
                    }
                }
            };
        });

        // Remove cut (dummy node)
        this.registry.register("remove_cut", (payload) => {
            if (this.visualization && payload) {
                const { nodeId } = payload;
                const node = this.visualization.nodes.find(n => n.id === nodeId);
                if (node && node.isDummy) {
                    const connectedEdges = this.visualization.links.filter(l => l.source.id === nodeId || l.target.id === nodeId);
                    if (connectedEdges.length === 2) {
                        const edge1 = connectedEdges[0];
                        const edge2 = connectedEdges[1];

                        const neighbor1 = edge1.source.id === nodeId ? edge1.target.id : edge1.source.id;
                        const neighbor2 = edge2.source.id === nodeId ? edge2.target.id : edge2.source.id;

                        // Capture set_order insertions so we can restore the dummy in each line
                        const setOrderEntries = [];
                        const setOrder = this.visualization.data.set_order || {};
                        for (const [lineId, lineStations] of Object.entries(setOrder)) {
                            const idx = lineStations.indexOf(nodeId);
                            if (idx > -1) {
                                setOrderEntries.push({ lineId, index: idx });
                            }
                        }

                        // Capture fixedAssignments referencing this dummy node
                        const savedAssignments = [];
                        if (this.visualization.data.fixedAssignments) {
                            for (const [key, value] of this.visualization.data.fixedAssignments.entries()) {
                                if (key.includes(nodeId)) {
                                    savedAssignments.push({ key, value });
                                }
                            }
                        }

                        const restoreInfo = {
                            nodeId,
                            position: { x: node.x, y: node.y },
                            originalPosition: { x: node.x_original, y: node.y_original },
                            schematicPosition: { x: node.x_s, y: node.y_s },
                            connections: [neighbor1, neighbor2],
                            setOrderEntries,
                            savedAssignments
                        };

                        // Pass 'true' to indicate this call comes from the provenance system
                        this.visualization.removeCut(node, true);

                        return {
                            undo: {
                                type: "restore_cut",
                                payload: restoreInfo
                            }
                        };
                    }
                }
            }
            return { undo: { type: "noop", payload: {} } };
        });

        // Restore cut (undo of remove_cut): re-insert the dummy node and split the merged edge
        this.registry.register("restore_cut", (payload) => {
            if (this.visualization && payload) {
                const { nodeId, position, originalPosition, schematicPosition, connections, setOrderEntries, savedAssignments } = payload;
                const vis = this.visualization;
                const [neighborId1, neighborId2] = connections;

                const neighborNode1 = vis.nodes.find(n => n.id === neighborId1);
                const neighborNode2 = vis.nodes.find(n => n.id === neighborId2);
                if (!neighborNode1 || !neighborNode2) {
                    console.warn('[restore_cut] Could not find neighbor nodes', neighborId1, neighborId2);
                    return { undo: { type: "noop", payload: {} } };
                }

                // Remove the merged edge between the two neighbors
                const mergedEdgeIdx = vis.links.findIndex(l =>
                    (l.source.id === neighborId1 && l.target.id === neighborId2) ||
                    (l.source.id === neighborId2 && l.target.id === neighborId1)
                );
                if (mergedEdgeIdx > -1) vis.links.splice(mergedEdgeIdx, 1);
                if (vis.data.links) {
                    const dataIdx = vis.data.links.findIndex(l => {
                        const sId = typeof l.source === 'object' ? l.source.id : l.source;
                        const tId = typeof l.target === 'object' ? l.target.id : l.target;
                        return (sId === neighborId1 && tId === neighborId2) ||
                               (sId === neighborId2 && tId === neighborId1);
                    });
                    if (dataIdx > -1) vis.data.links.splice(dataIdx, 1);
                }

                // Recreate the dummy node with ports
                const newNode = {
                    id: nodeId,
                    label: '',
                    isDummy: true,
                    x: position.x,
                    y: position.y,
                    x_original: originalPosition?.x ?? position.x,
                    y_original: originalPosition?.y ?? position.y,
                    x_s: schematicPosition.x,
                    y_s: schematicPosition.y
                };

                // Create 8 octilinear ports
                newNode.ports = [];
                newNode.portById = [];
                for (let dirId = 0; dirId < DIRECTIONS.length; dirId++) {
                    const dir = DIRECTIONS[dirId];
                    let angle = Math.atan2(dir.y, dir.x);
                    if (angle < 0) angle += 2 * Math.PI;
                    angle = angle * 180 / Math.PI;
                    const port = new Port(`${newNode.id}-${dir.x}-${dir.y}`, dir.x, dir.y, angle, newNode, dirId);
                    port.usedCount = 0;
                    port.edges = [];
                    newNode.ports.push(port);
                    newNode.portById[dirId] = port;
                }
                newNode.portsByAngle = [...newNode.ports].sort((a, b) => a.angle - b.angle);

                // Add node back
                vis.nodes.push(newNode);
                if (vis.data.nodes) vis.data.nodes.push(newNode);

                // Create two edges: neighbor1 <-> dummy, dummy <-> neighbor2
                const edge1 = { source: neighborNode1, target: newNode };
                const edge2 = { source: newNode, target: neighborNode2 };
                vis.links.push(edge1, edge2);
                if (vis.data.links) vis.data.links.push(edge1, edge2);
                if (vis.data.edges && vis.data.edges !== vis.data.links) {
                    vis.data.edges = vis.data.links;
                }

                // Restore set_order entries
                if (setOrderEntries) {
                    const setOrder = vis.data.set_order || {};
                    for (const { lineId, index } of setOrderEntries) {
                        if (setOrder[lineId]) {
                            setOrder[lineId].splice(index, 0, nodeId);
                        }
                    }
                }

                // Restore fixedAssignments
                if (savedAssignments && vis.data.fixedAssignments) {
                    for (const { key, value } of savedAssignments) {
                        vis.data.fixedAssignments.set(key, value);
                    }
                }

                // Update force simulation
                if (vis.simulation) {
                    vis.simulation.nodes(vis.nodes);
                    const linkForce = vis.simulation.force("link");
                    if (linkForce) linkForce.links(vis.links);
                }

                vis.refreshVisualization('cut_restore');
            }
            return {
                undo: {
                    type: "remove_cut",
                    payload: { nodeId: payload.nodeId }
                }
            };
        });

        // Insert cut (batch of dummy nodes from the cutting tool)
        this.registry.register("insert_cut", (payload) => {
            // This action is applied AFTER the cutting tool already mutated the graph,
            // so the "do" direction is a no-op — the graph is already up to date.
            // We just store the info so that undo can reverse it.
            return {
                undo: {
                    type: "undo_insert_cut",
                    payload: payload // { cuts: [...] }
                }
            };
        });

        // Undo insert cut: remove each dummy node that was inserted by the cutting tool
        this.registry.register("undo_insert_cut", (payload) => {
            if (this.visualization && payload) {
                const vis = this.visualization;
                const { cuts } = payload; // array of { nodeId, sourceId, targetId, setOrderEntries, ... }

                for (const cut of cuts) {
                    const node = vis.nodes.find(n => n.id === cut.nodeId);
                    if (!node || !node.isDummy) continue;

                    // Use the same removal logic as removeCut (from cut-removal.js)
                    vis.removeCut(node, true);
                }
            }
            return {
                undo: {
                    type: "redo_insert_cut",
                    payload: payload
                }
            };
        });

        // Redo insert cut: re-insert each dummy node that was removed by undo
        this.registry.register("redo_insert_cut", (payload) => {
            if (this.visualization && payload) {
                const vis = this.visualization;
                const { cuts } = payload;

                for (const cut of cuts) {
                    const { nodeId, sourceId, targetId, position, originalPosition, schematicPosition, setOrderEntries } = cut;

                    const sourceNode = vis.nodes.find(n => n.id === sourceId);
                    const targetNode = vis.nodes.find(n => n.id === targetId);
                    if (!sourceNode || !targetNode) {
                        console.warn('[redo_insert_cut] Could not find source/target nodes', sourceId, targetId);
                        continue;
                    }

                    // Remove the merged edge between source and target
                    const mergedEdgeIdx = vis.links.findIndex(l =>
                        (l.source.id === sourceId && l.target.id === targetId) ||
                        (l.source.id === targetId && l.target.id === sourceId)
                    );
                    if (mergedEdgeIdx > -1) vis.links.splice(mergedEdgeIdx, 1);
                    if (vis.data.links) {
                        const dataIdx = vis.data.links.findIndex(l => {
                            const sId = typeof l.source === 'object' ? l.source.id : l.source;
                            const tId = typeof l.target === 'object' ? l.target.id : l.target;
                            return (sId === sourceId && tId === targetId) ||
                                   (sId === targetId && tId === sourceId);
                        });
                        if (dataIdx > -1) vis.data.links.splice(dataIdx, 1);
                    }

                    // Recreate the dummy node
                    const newNode = {
                        id: nodeId,
                        label: '',
                        isDummy: true,
                        x: position.x,
                        y: position.y,
                        x_original: originalPosition?.x ?? position.x,
                        y_original: originalPosition?.y ?? position.y,
                        x_s: schematicPosition.x,
                        y_s: schematicPosition.y
                    };

                    // Create 8 octilinear ports
                    newNode.ports = [];
                    newNode.portById = [];
                    for (let dirId = 0; dirId < DIRECTIONS.length; dirId++) {
                        const dir = DIRECTIONS[dirId];
                        let angle = Math.atan2(dir.y, dir.x);
                        if (angle < 0) angle += 2 * Math.PI;
                        angle = angle * 180 / Math.PI;
                        const port = new Port(`${newNode.id}-${dir.x}-${dir.y}`, dir.x, dir.y, angle, newNode, dirId);
                        port.usedCount = 0;
                        port.edges = [];
                        newNode.ports.push(port);
                        newNode.portById[dirId] = port;
                    }
                    newNode.portsByAngle = [...newNode.ports].sort((a, b) => a.angle - b.angle);

                    // Add node back
                    vis.nodes.push(newNode);
                    if (vis.data.nodes) vis.data.nodes.push(newNode);

                    // Create two edges
                    const edge1 = { source: sourceNode, target: newNode };
                    const edge2 = { source: newNode, target: targetNode };
                    vis.links.push(edge1, edge2);
                    if (vis.data.links) vis.data.links.push(edge1, edge2);
                    if (vis.data.edges && vis.data.edges !== vis.data.links) {
                        vis.data.edges = vis.data.links;
                    }

                    // Restore set_order entries
                    if (setOrderEntries) {
                        const setOrder = vis.data.set_order || {};
                        for (const { lineId, index } of setOrderEntries) {
                            if (setOrder[lineId]) {
                                setOrder[lineId].splice(index, 0, nodeId);
                            }
                        }
                    }
                }

                // Update force simulation once after all nodes are re-inserted
                if (vis.simulation) {
                    vis.simulation.nodes(vis.nodes);
                    const linkForce = vis.simulation.force("link");
                    if (linkForce) linkForce.links(vis.links);
                }

                vis.refreshVisualization('cut_redo_insert');
            }
            return {
                undo: {
                    type: "undo_insert_cut",
                    payload: payload
                }
            };
        });

        // Remove bend
        this.registry.register("remove_bend", (payload) => {
            if (this.visualization && payload) {
                const { sourceId, targetId } = payload;
                // Find link in visualization logic
                const link = this.visualization.links.find(l =>
                    (l.source.id === sourceId && l.target.id === targetId) ||
                    (l.source.id === targetId && l.target.id === sourceId)
                );

                if (link && link.bend) {
                    const previousBend = { ...link.bend };
                    delete link.bend;

                    // Update data source
                    // Handle both object and string ID formats just in case
                    const dataLink = this.visualization.data.links.find(l => {
                        const s = typeof l.source === 'object' ? l.source.id : l.source;
                        const t = typeof l.target === 'object' ? l.target.id : l.target;
                        return (s === sourceId && t === targetId) || (s === targetId && t === sourceId);
                    });

                    if (dataLink) delete dataLink.bend;

                    this.visualization.refreshVisualization('bend_removal');

                    return {
                        undo: {
                            type: "restore_bend",
                            payload: { sourceId, targetId, bend: previousBend }
                        }
                    };
                }
            }
            return { undo: { type: "noop", payload: {} } };
        });

        // Restore bend
        this.registry.register("restore_bend", (payload) => {
            if (this.visualization && payload) {
                const { sourceId, targetId, bend } = payload;
                const link = this.visualization.links.find(l =>
                    (l.source.id === sourceId && l.target.id === targetId) ||
                    (l.source.id === targetId && l.target.id === sourceId)
                );

                if (link) {
                    link.bend = bend;

                    const dataLink = this.visualization.data.links.find(l => {
                        const s = typeof l.source === 'object' ? l.source.id : l.source;
                        const t = typeof l.target === 'object' ? l.target.id : l.target;
                        return (s === sourceId && t === targetId) || (s === targetId && t === sourceId);
                    });

                    if (dataLink) dataLink.bend = bend;

                    this.visualization.refreshVisualization('bend_restore');
                }
            }
            return {
                undo: {
                    type: "remove_bend",
                    payload: { sourceId, targetId }
                }
            };
        });

        // Set manual label preference for a single node
        this.registry.register("set_label_preference", (payload) => {
            if (this.visualization && payload) {
                const { nodeId, direction } = payload;
                if (direction == null) this.visualization.manualLabelPreferences.delete(nodeId);
                else this.visualization.manualLabelPreferences.set(nodeId, direction);
                this.visualization.invalidateLabels();
                this.visualization.drawLabels();
            }
            return {
                undo: {
                    type: "restore_label_preference",
                    payload: {
                        nodeId: payload.nodeId,
                        previousDirection: payload.previousDirection,
                        newDirection: payload.direction
                    }
                }
            };
        });

        // Restore (undo) a single node's previous label preference
        this.registry.register("restore_label_preference", (payload) => {
            if (this.visualization && payload) {
                const { nodeId, previousDirection } = payload;
                if (previousDirection == null) this.visualization.manualLabelPreferences.delete(nodeId);
                else this.visualization.manualLabelPreferences.set(nodeId, previousDirection);
                this.visualization.invalidateLabels();
                this.visualization.drawLabels();
            }
            return {
                undo: {
                    type: "set_label_preference",
                    payload: {
                        nodeId: payload.nodeId,
                        direction: payload.newDirection,
                        previousDirection: payload.previousDirection
                    }
                }
            };
        });

        // Set manual label preference for an entire line
        this.registry.register("set_line_label_preference", (payload) => {
            if (this.visualization && payload) {
                const { lineId, direction } = payload;
                if (direction == null) this.visualization.manualLineLabelPreferences.delete(lineId);
                else this.visualization.manualLineLabelPreferences.set(lineId, direction);
                this.visualization.invalidateLabels();
                this.visualization.drawLabels();
            }
            return {
                undo: {
                    type: "restore_line_label_preference",
                    payload: {
                        lineId: payload.lineId,
                        previousDirection: payload.previousDirection,
                        newDirection: payload.direction
                    }
                }
            };
        });

        // Restore (undo) a line's previous label preference
        this.registry.register("restore_line_label_preference", (payload) => {
            if (this.visualization && payload) {
                const { lineId, previousDirection } = payload;
                if (previousDirection == null) this.visualization.manualLineLabelPreferences.delete(lineId);
                else this.visualization.manualLineLabelPreferences.set(lineId, previousDirection);
                this.visualization.invalidateLabels();
                this.visualization.drawLabels();
            }
            return {
                undo: {
                    type: "set_line_label_preference",
                    payload: {
                        lineId: payload.lineId,
                        direction: payload.newDirection,
                        previousDirection: payload.previousDirection
                    }
                }
            };
        });

        // Batch-set label preferences for a segment of nodes
        this.registry.register("set_segment_label_preferences", (payload) => {
            if (this.visualization && payload) {
                const { nodeIds, direction } = payload;
                for (const nid of nodeIds) {
                    if (direction == null) this.visualization.manualLabelPreferences.delete(nid);
                    else this.visualization.manualLabelPreferences.set(nid, direction);
                }
                this.visualization.invalidateLabels();
                this.visualization.drawLabels();
            }
            return {
                undo: {
                    type: "restore_segment_label_preferences",
                    payload: {
                        nodeIds: payload.nodeIds,
                        previousPreferences: payload.previousPreferences,
                        newDirection: payload.direction
                    }
                }
            };
        });

        // Restore (undo) a segment's previous per-node label preferences
        this.registry.register("restore_segment_label_preferences", (payload) => {
            if (this.visualization && payload) {
                const { nodeIds, previousPreferences } = payload;
                // previousPreferences is an array of [nodeId, direction|null]
                const prevMap = new Map(previousPreferences);
                for (const nid of nodeIds) {
                    const prevDir = prevMap.get(nid) ?? null;
                    if (prevDir == null) this.visualization.manualLabelPreferences.delete(nid);
                    else this.visualization.manualLabelPreferences.set(nid, prevDir);
                }
                this.visualization.invalidateLabels();
                this.visualization.drawLabels();
            }
            return {
                undo: {
                    type: "set_segment_label_preferences",
                    payload: {
                        nodeIds: payload.nodeIds,
                        direction: payload.newDirection,
                        previousPreferences: payload.previousPreferences
                    }
                }
            };
        });

        // Reorder connections — the reorder already happened before tracking,
        // so the "do" direction is a no-op. We just store the info for undo/redo.
        this.registry.register("reorder_connections", (payload) => {
            return {
                undo: {
                    type: "undo_reorder_connections",
                    payload: payload
                }
            };
        });

        // Undo reorder connections: restore original station order and edges
        this.registry.register("undo_reorder_connections", (payload) => {
            if (this.visualization && payload) {
                const { hypersetId, oldOrder, newOrder } = payload;
                this._applyReorder(hypersetId, newOrder, oldOrder);
            }
            return {
                undo: {
                    type: "redo_reorder_connections",
                    payload: payload
                }
            };
        });

        // Redo reorder connections: re-apply the new station order and edges
        this.registry.register("redo_reorder_connections", (payload) => {
            if (this.visualization && payload) {
                const { hypersetId, oldOrder, newOrder } = payload;
                this._applyReorder(hypersetId, oldOrder, newOrder);
            }
            return {
                undo: {
                    type: "undo_reorder_connections",
                    payload: payload
                }
            };
        });

        // No-op action for when something fails
        this.registry.register("noop", () => {
             return { undo: { type: "noop", payload: {} } };
        });
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (event) => {
            if (event.ctrlKey || event.metaKey) {
                if (event.key === 'z' && !event.shiftKey) {
                    event.preventDefault();
                    this.undo();
                } else if ((event.key === 'y') || (event.key === 'z' && event.shiftKey)) {
                    event.preventDefault();
                    this.redo();
                }
            }
        });
    }

    captureState() {
        if (!this.visualization) return {};
        return {
            fixedAssignments: Array.from(this.visualization.data.fixedAssignments.entries()),
            currentView: this.visualization.currentView,
            timestamp: Date.now()
        };
    }

    trackPortAssignment(sourceId, targetId, newAssignment) {
        if (!this.trrack) return;
        const key = `${sourceId}-${targetId}`;
        let previousAssignment = this.visualization.data.fixedAssignments.get(key) || null;

        // If no fixed assignment exists, capture the current effective assignment from the graph
        // This ensures that "Undo" restores the exact previous state, converting implicit assignments to explicit ones
        if (!previousAssignment && this.visualization && this.visualization.links) {
            const link = this.visualization.links.find(l =>
                (l.source.id === sourceId && l.target.id === targetId) ||
                (l.source.id === targetId && l.target.id === sourceId)
            );

            if (link && link.source_port && link.target_port) {
                // Determine direction to match the key
                if (link.source.id === sourceId) {
                    previousAssignment = {
                        sourcePort: link.source_port.octilinear_id,
                        targetPort: link.target_port.octilinear_id
                    };
                } else {
                    previousAssignment = {
                        sourcePort: link.target_port.octilinear_id,
                        targetPort: link.source_port.octilinear_id
                    };
                }
            }
        }

        this.trrack.apply("Port Assignment", {
            type: "assign_port",
            payload: {
                sourceId,
                targetId,
                assignment: newAssignment,
                previousAssignment
            }
        });
    }

    trackPathStraightening(assignments, previousAssignments) {
        if (!this.trrack) return;
        this.trrack.apply("Straighten Path", {
            type: "straighten_path",
            payload: {
                assignments,
                previousAssignments
            }
        });
    }

    trackViewChange(newView, previousView) {
        if (!this.trrack) return;
        this.trrack.apply("View Change", {
            type: "change_view",
            payload: {
                view: newView,
                previousView
            }
        });
    }

    trackNodeDrag(nodeId, prevPosition, newPosition, prevHasManualEdits, newHasManualEdits) {
        if (!this.trrack) return;
        this.trrack.apply("Node Drag", {
            type: "drag_node", // Uses the registered action
            payload: {
                nodeId,
                position: newPosition,
                prevPosition: prevPosition,
                hasManualEdits: newHasManualEdits,
                prevHasManualEdits: prevHasManualEdits
            }
        });
    }

    trackCutRemoval(nodeId) {
        if (!this.trrack) return;
        this.trrack.apply("Remove Cut", {
            type: "remove_cut", // Uses the registered action
            payload: {
                nodeId
            }
        });
    }

    trackCutInsertion(cuts) {
        if (!this.trrack) return;
        this.trrack.apply("Insert Cut", {
            type: "insert_cut",
            payload: {
                cuts // array of { nodeId, sourceId, targetId, position, originalPosition, schematicPosition, setOrderEntries }
            }
        });
    }

    trackBendRemoval(link) {
        if (!this.trrack) return;
        this.trrack.apply("Remove Bend", {
            type: "remove_bend",
            payload: {
                sourceId: link.source.id,
                targetId: link.target.id
            }
        });
    }

    trackLabelPreference(nodeId, newDirection, previousDirection) {
        if (!this.trrack) return;
        this.trrack.apply("Set Label Position", {
            type: "set_label_preference",
            payload: {
                nodeId,
                direction: newDirection,
                previousDirection: previousDirection ?? null
            }
        });
    }

    trackLineLabelPreference(lineId, newDirection, previousDirection) {
        if (!this.trrack) return;
        this.trrack.apply("Set Line Label Position", {
            type: "set_line_label_preference",
            payload: {
                lineId,
                direction: newDirection,
                previousDirection: previousDirection ?? null
            }
        });
    }

    trackSegmentLabelPreferences(nodeIds, newDirection, previousPreferencesMap) {
        if (!this.trrack) return;
        // Convert Map to array of [nodeId, direction] pairs for serialization
        const previousPreferences = Array.from(previousPreferencesMap.entries());
        this.trrack.apply("Set Segment Label Position", {
            type: "set_segment_label_preferences",
            payload: {
                nodeIds,
                direction: newDirection,
                previousPreferences
            }
        });
    }

    trackReorderConnections(hypersetId, oldOrder, newOrder) {
        if (!this.trrack) return;
        this.trrack.apply("Reorder Connections", {
            type: "reorder_connections",
            payload: {
                hypersetId,
                oldOrder: [...oldOrder],
                newOrder: [...newOrder]
            }
        });
    }

    /**
     * Internal helper: switch a line from `fromOrder` to `toOrder`,
     * rebuilding graph edges and refreshing the visualisation.
     */
    _applyReorder(hypersetId, fromOrder, toOrder) {
        const vis = this.visualization;
        if (!vis) return;

        // 1. Update station order
        vis.data.set_order[hypersetId] = [...toOrder];

        // 2. Rebuild edges
        const findEdge = (aId, bId) => vis.links.find(l =>
            (l.source.id === aId && l.target.id === bId) ||
            (l.source.id === bId && l.target.id === aId)
        );

        const removeEdge = (edge) => {
            const idx = vis.links.indexOf(edge);
            if (idx > -1) vis.links.splice(idx, 1);
            if (vis.data.links) {
                const di = vis.data.links.findIndex(l => {
                    const sid = typeof l.source === 'object' ? l.source.id : l.source;
                    const tid = typeof l.target === 'object' ? l.target.id : l.target;
                    return (sid === edge.source.id && tid === edge.target.id) ||
                           (sid === edge.target.id && tid === edge.source.id);
                });
                if (di > -1) vis.data.links.splice(di, 1);
            }
        };

        const createEdgeIfNeeded = (aId, bId) => {
            if (findEdge(aId, bId)) return;
            const srcNode = vis.nodes.find(n => n.id === aId);
            const tgtNode = vis.nodes.find(n => n.id === bId);
            if (!srcNode || !tgtNode) return;
            vis.links.push({ source: srcNode, target: tgtNode });
            if (vis.data.links) {
                vis.data.links.push({ source: aId, target: bId });
            }
        };

        // Build a set of edges used by OTHER lines (so we don't remove shared edges)
        const edgeLines = new Map();
        for (const [lineId, stations] of Object.entries(vis.data.set_order)) {
            if (lineId === hypersetId) continue;
            for (let i = 0; i < stations.length - 1; i++) {
                const key1 = `${stations[i]}|${stations[i + 1]}`;
                const key2 = `${stations[i + 1]}|${stations[i]}`;
                edgeLines.set(key1, (edgeLines.get(key1) || 0) + 1);
                edgeLines.set(key2, (edgeLines.get(key2) || 0) + 1);
            }
        }

        // Remove old edges that are NOT shared
        for (let i = 0; i < fromOrder.length - 1; i++) {
            const key = `${fromOrder[i]}|${fromOrder[i + 1]}`;
            if (!edgeLines.has(key)) {
                const edge = findEdge(fromOrder[i], fromOrder[i + 1]);
                if (edge) removeEdge(edge);
            }
        }

        // Add new edges
        for (let i = 0; i < toOrder.length - 1; i++) {
            createEdgeIfNeeded(toOrder[i], toOrder[i + 1]);
        }

        // Refresh simulation link force
        if (vis.simulation) {
            const linkForce = vis.simulation.force('link');
            if (linkForce) linkForce.links(vis.links);
        }

        // 3. Redraw everything
        vis.preprocess();
        vis.draw();
        vis.refreshPortData();
        vis.refreshEdges();
        if (vis.show_lines) vis.drawMetrolines();
        vis.drawLegend();
        if (vis.show_labels) {
            vis.invalidateLabels();
            vis.drawLabels();
        }

        vis.isDirty = true;
        vis.hasManualEdits = true;
    }

    undo() {
        // During reorder-connections mode, undo individual node clicks
        if (isReorderConnectionsActive()) {
            undoReorderClick();
            return;
        }
        if (this.trrack) {
            this.trrack.undo();
            console.log("Undo performed");
        } else {
            console.log("Trrack not initialized");
        }
    }

    redo() {
        // During reorder-connections mode, redo individual node clicks
        if (isReorderConnectionsActive()) {
            redoReorderClick();
            return;
        }
        if (this.trrack) {
            this.trrack.redo();
            console.log("Redo performed");
        } else {
            console.log("Trrack not initialized");
        }
    }

    getHistory() {
        return this.trrack ? this.trrack.graph : [];
    }

    canUndo() {
        // Check if there are nodes to undo to
        if (!this.trrack || !this.trrack.graph) return false;
        try {
            const currentNode = this.trrack.current;
            return currentNode && currentNode.parent !== null;
        } catch (e) {
            return false;
        }
    }

    canRedo() {
        // Check if there are nodes to redo to
        if (!this.trrack || !this.trrack.graph) return false;
        try {
            const currentNode = this.trrack.current;
            return currentNode && currentNode.children && currentNode.children.length > 0;
        } catch (e) {
            return false;
        }
    }
}

// Singleton instance
const provenanceTracker = new ProvenanceTracker();
export default provenanceTracker;
