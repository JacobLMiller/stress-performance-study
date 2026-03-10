/**
 * Port assignment algorithms for optimal octilinear routing
 */

import { circularDistance } from './port.js';

export function assignPorts(data) {
    console.log("Assigning ports");

    // Handle both 'links' and 'edges' property names
    const links = data.links || data.edges;
    const { nodes, fixedAssignments } = data;

    if (!links) {
        console.error("assignPorts: No links or edges found in data!");
        return;
    }

    console.log(`assignPorts: Processing ${nodes.length} nodes and ${links.length} links`);

    // Reset usage counters
    nodes.forEach(n => n.ports && n.ports.forEach(p => p.usedCount = 0));

    const nodeDict = {};
    nodes.forEach(node => {
        nodeDict[node.id] = node;
        node.adjacency = [];
        // Use schematic coordinates (x_s, y_s) if available AND NOT FORCED to use initial, otherwise fall back to initial (x, y)
        // This is important for re-runs after cutting, where dummy nodes may have x_s, y_s
        // that differ significantly from their interpolated x, y values
        const useSchematic = (node.x_s !== undefined && node.y_s !== undefined) && !data.useInitialCoordinates;
        const coordX = useSchematic ? node.x_s : node.x;
        const coordY = useSchematic ? node.y_s : node.y;
        node.x_scaled = +coordX / 10000;
        node.y_scaled = +coordY / 10000;
    });

    // Process links and handle fixed assignments
    links.forEach(link => {
        resolveNodeReferences(link, nodeDict);
        if (!link.source || !link.target) {
            console.warn('Invalid link found:', link);
            return;
        }

        link.source_port = null;
        link.target_port = null;

        // Check for fixed assignments first
        if (applyFixedAssignment(link, fixedAssignments)) {
            return; // Skip normal assignment for fixed links
        }

        // Calculate angle and add to adjacency lists
        addToAdjacencyList(link);
    });

    // Assign ports for each node using dynamic programming
    nodes.forEach(node => assignNodePorts(node));
    console.log("Ports assigned.");
}

function resolveNodeReferences(link, nodeDict) {
    // Handle both cases: when source/target are IDs (strings) or already objects
    if (typeof link.source === 'string' || typeof link.source === 'number') {
        link.source = nodeDict[link.source];
    }
    if (typeof link.target === 'string' || typeof link.target === 'number') {
        link.target = nodeDict[link.target];
    }
}

function applyFixedAssignment(link, fixedAssignments) {
    if (!fixedAssignments) return false;

    const linkKey = `${link.source.id}-${link.target.id}`;
    const reverseLinkKey = `${link.target.id}-${link.source.id}`;

    if (fixedAssignments.has(linkKey)) {
        const assignment = fixedAssignments.get(linkKey);
        const sourcePort = link.source.portById[assignment.sourcePort];
        const targetPort = link.target.portById[assignment.targetPort];

        // Check if ports are already used by another edge (conflict prevention)
        if (sourcePort && sourcePort.usedCount > 0) {
            console.warn(`Port ${assignment.sourcePort} on node ${link.source.id} already in use, skipping fixed assignment`);
            return false;
        }
        if (targetPort && targetPort.usedCount > 0) {
            console.warn(`Port ${assignment.targetPort} on node ${link.target.id} already in use, skipping fixed assignment`);
            return false;
        }

        link.source_port = sourcePort;
        link.target_port = targetPort;
        if (link.source_port) link.source_port.usedCount++;
        if (link.target_port) link.target_port.usedCount++;
        return true;
    } else if (fixedAssignments.has(reverseLinkKey)) {
        const assignment = fixedAssignments.get(reverseLinkKey);
        const sourcePort = link.source.portById[assignment.targetPort];
        const targetPort = link.target.portById[assignment.sourcePort];

        // Check if ports are already used by another edge (conflict prevention)
        if (sourcePort && sourcePort.usedCount > 0) {
            console.warn(`Port ${assignment.targetPort} on node ${link.source.id} already in use, skipping fixed assignment`);
            return false;
        }
        if (targetPort && targetPort.usedCount > 0) {
            console.warn(`Port ${assignment.sourcePort} on node ${link.target.id} already in use, skipping fixed assignment`);
            return false;
        }

        link.source_port = sourcePort;
        link.target_port = targetPort;
        if (link.source_port) link.source_port.usedCount++;
        if (link.target_port) link.target_port.usedCount++;
        return true;
    }

    return false;
}

function addToAdjacencyList(link) {
    let angle = Math.atan2(link.target.y_scaled - link.source.y_scaled, link.target.x_scaled - link.source.x_scaled);
    if (angle < 0) angle += 2 * Math.PI;
    angle = angle * 180 / Math.PI;

    link.source.adjacency.push({ link, node: link.target, angle });
    link.target.adjacency.push({ link, node: link.source, angle: (angle + 180) % 360 });
}

function assignNodePorts(node) {
    // Filter out links that already have fixed assignments
    node.adjacency = node.adjacency.filter(adj =>
        !adj.link.source_port || !adj.link.target_port
    );

    node.adjacency.sort((a, b) => a.angle - b.angle);
    const ports = node.portsByAngle;
    const m = ports.length;
    const n = node.adjacency.length;

    if (n === 0) return;

    const optimalAssignment = findOptimalPortAssignment(node, ports, m, n);

    // Handle case where no valid assignment was found
    if (!optimalAssignment.backtrack || !optimalAssignment.availablePorts || optimalAssignment.availablePorts.length === 0) {
        console.warn(`Node ${node.id}: Could not find valid port assignment for ${n} remaining edges`);
        return;
    }

    applyPortAssignment(node, optimalAssignment.backtrack, optimalAssignment.rotation, optimalAssignment.availablePorts);
}

function findOptimalPortAssignment(node, ports, m, n) {
    // Filter out ports that are already used (by fixed assignments processed earlier)
    const availablePorts = ports.filter(p => !p.usedCount || p.usedCount === 0);
    const availableM = availablePorts.length;

    // If no ports available, return empty result
    if (availableM === 0 || n === 0) {
        return { backtrack: null, rotation: 0, cost: Infinity, availablePorts: [] };
    }

    // If more edges than available ports, we can't assign all - log warning
    if (n > availableM) {
        console.warn(`Node ${node.id}: ${n} edges to assign but only ${availableM} ports available (${m - availableM} already used)`);
    }

    let best = Infinity;
    let best_bt = null;
    let best_rot = 0;
    let rotatedPorts = availablePorts.slice();

    // Try all possible rotations using dynamic programming
    for (let rot = 0; rot < availableM; rot++) {
        const dp = Array(n + 1).fill(null).map(() => Array(availableM + 1).fill(Infinity));
        const bt = Array(n + 1).fill(null).map(() => Array(availableM + 1).fill(0));

        // Initialize DP table
        for (let j = 0; j <= availableM; j++) dp[0][j] = 0;

        // Fill DP table
        for (let i = 1; i <= n; i++) {
            for (let j = i; j <= availableM; j++) {
                const take = dp[i - 1][j - 1] + circularDistance(rotatedPorts[j - 1].angle, node.adjacency[i - 1].angle);
                const skip = dp[i][j - 1];

                if (take < skip) {
                    dp[i][j] = take;
                    bt[i][j] = 1;
                } else {
                    dp[i][j] = skip;
                    bt[i][j] = 2;
                }
            }
        }

        if (dp[n][availableM] < best) {
            best = dp[n][availableM];
            best_bt = bt;
            best_rot = rot;
        }

        rotatedPorts.push(rotatedPorts.shift());
    }

    return { backtrack: best_bt, rotation: best_rot, cost: best, availablePorts };
}

function applyPortAssignment(node, backtrack, rotation, availablePorts) {
    const ports = availablePorts;
    const finalRotated = ports.slice();

    // Apply rotation
    for (let i = 0; i < rotation; i++) {
        finalRotated.push(finalRotated.shift());
    }

    // Reconstruct assignment from backtrack
    const assignment = Array(node.adjacency.length).fill(null);
    let cj = ports.length;

    for (let i = node.adjacency.length; i > 0; i--) {
        if (backtrack[i][cj] === 1) {
            assignment[i - 1] = finalRotated[cj - 1];
            cj--;
        } else {
            cj--;
            i++;
        }
    }

    // Track which ports have been used in this assignment pass
    const usedPortsThisPass = new Set();

    // Apply assignments to links
    for (let i = 0; i < node.adjacency.length; i++) {
        const port = assignment[i];
        const adj = node.adjacency[i];

        if (!port) {
            console.warn(`No port assigned for edge at node ${node.id}, adjacency index ${i}`);
            continue;
        }

        // Check if this port was already assigned in this pass (duplicate assignment bug)
        if (usedPortsThisPass.has(port.id)) {
            console.error(`Port ${port.id} at node ${node.id} assigned to multiple edges! Skipping duplicate.`);
            continue;
        }
        usedPortsThisPass.add(port.id);

        if (adj.link.source === node) {
            adj.link.source_port = port;
            if (port) {
                port.usedCount++;
            }
        } else {
            adj.link.target_port = port;
            if (port) {
                port.usedCount++;
            }
        }
    }
}
