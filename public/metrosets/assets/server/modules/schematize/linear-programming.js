import { solve } from 'https://esm.sh/yalps';

const diag = 1 / Math.sqrt(2);
const minDist = 150; // Minimum distance between adjacent nodes in LP data units
const minNodeDist = 5; // Minimum distance for non-adjacent nodes

// Elastic Filter configuration for debugging infeasibility
const USE_ELASTIC_FILTER = true; // Enable/disable the elastic filter debugging technique
const VIOLATION_PENALTY = 1000000; // High penalty for constraint violations (makes solver avoid violations when possible)
const VIOLATION_THRESHOLD = 1e-6; // Threshold for considering a violation variable as "active"

// Custom error for infeasible solutions
export class InfeasibleSolutionError extends Error {
    constructor(status) {
        super(`Infeasible solution reached: ${status}`);
        this.name = 'InfeasibleSolutionError';
        this.status = status;
    }
}

/**
 * Identifies pairs of non-adjacent nodes that are closer than minNodeDist
 * in the current layout and generates separation plane constraints.
 * @param {Object} networkData - The network data
 * @param {boolean} useSchematized - Whether to use schematized positions (x_s, y_s) or initial positions (x, y)
 */
function generateSeparationConstraints(networkData, useSchematized = false) {
    const constraints = {};
    const objectiveCoefficients = {};

    // Build adjacency set for quick lookup
    const adjacencySet = new Set();
    for (const edge of networkData.edges) {
        const id1 = typeof edge.source === 'object' ? edge.source.id : edge.source;
        const id2 = typeof edge.target === 'object' ? edge.target.id : edge.target;
        adjacencySet.add(`${id1}-${id2}`);
        adjacencySet.add(`${id2}-${id1}`);
    }

    const conflictPairs = [];
    const nodes = networkData.nodes;

    // Find conflicting pairs O(N^2)
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const nodeA = nodes[i];
            const nodeB = nodes[j];

            // Skip if adjacent
            if (adjacencySet.has(`${nodeA.id}-${nodeB.id}`)) {
                continue;
            }

            // Check if nodes are too close in the current layout
            const xA = useSchematized ? nodeA.x_s : nodeA.x;
            const yA = useSchematized ? nodeA.y_s : nodeA.y;
            const xB = useSchematized ? nodeB.x_s : nodeB.x;
            const yB = useSchematized ? nodeB.y_s : nodeB.y;

            const dx = xB - xA;
            const dy = yB - yA;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < minNodeDist && dist > 0.001) { // Avoid division by zero
                conflictPairs.push({
                    nodeA,
                    nodeB,
                    dx,
                    dy,
                    dist
                });
            }
        }
    }

    const layoutType = useSchematized ? 'schematized' : 'initial';
    console.log(`[Iteration ${useSchematized ? 'refinement' : 'initial'}] Found ${conflictPairs.length} conflicting non-adjacent node pairs in ${layoutType} layout`);

    // Generate separation plane constraints
    for (const conflict of conflictPairs) {
        const { nodeA, nodeB, dx, dy} = conflict;

        // Normalize the direction vector
        const norm = Math.sqrt(dx * dx + dy * dy);

        // The constraint: (dx) * (xB - xA) + (dy) * (yB - yA) >= minNodeDist * norm
        // Rearranged: dx * xB - dx * xA + dy * yB - dy * yA >= minNodeDist * norm

        const constraintName = `separation_${nodeA.id}_${nodeB.id}`;
        constraints[constraintName] = {
            min: minNodeDist * norm,
            vars: {
                [`${nodeB.id}_x`]: dx,
                [`${nodeA.id}_x`]: -dx,
                [`${nodeB.id}_y`]: dy,
                [`${nodeA.id}_y`]: -dy
            }
        };
    }

    return { constraints, objectiveCoefficients };
}

/**
 * Converts a constraint to a "soft" constraint by adding slack/surplus variables.
 * This is the core of the Elastic Filter debugging technique.
 *
 * @param {string} constraintName - Name of the constraint
 * @param {Object} constraint - The constraint object with min/max/equal and vars
 * @returns {Object} - Modified constraint with violation variables info
 */
function createSoftConstraint(constraintName, constraint) {
    const result = {
        constraint: { ...constraint },
        violationVars: []
    };

    const vars = { ...constraint.vars };

    // Handle equality constraints (equal) - need both positive and negative violation
    if (constraint.equal !== undefined) {
        // For equal constraint: sum(vars) = target
        // Convert to: sum(vars) + violation_pos - violation_neg = target
        // Where violation_pos >= 0, violation_neg >= 0
        const violationPosName = `violation_pos_${constraintName}`;
        const violationNegName = `violation_neg_${constraintName}`;

        vars[violationPosName] = 1;  // Allows constraint to be satisfied even if sum > target
        vars[violationNegName] = -1; // Allows constraint to be satisfied even if sum < target

        result.violationVars.push({
            name: violationPosName,
            type: 'equality_positive',
            constraintName,
            constraintDetails: constraint
        });
        result.violationVars.push({
            name: violationNegName,
            type: 'equality_negative',
            constraintName,
            constraintDetails: constraint
        });
    }
    // Handle >= constraint (min)
    else if (constraint.min !== undefined) {
        // For min constraint: sum(vars) >= min_value
        // Convert to: sum(vars) + surplus >= min_value
        // If sum < min_value, surplus makes up the difference
        const surplusName = `violation_surplus_${constraintName}`;
        vars[surplusName] = 1;

        result.violationVars.push({
            name: surplusName,
            type: 'surplus',
            constraintName,
            constraintDetails: constraint
        });
    }
    // Handle <= constraint (max)
    else if (constraint.max !== undefined) {
        // For max constraint: sum(vars) <= max_value
        // Convert to: sum(vars) - slack <= max_value
        // If sum > max_value, slack absorbs the excess
        const slackName = `violation_slack_${constraintName}`;
        vars[slackName] = -1;

        result.violationVars.push({
            name: slackName,
            type: 'slack',
            constraintName,
            constraintDetails: constraint
        });
    }

    result.constraint.vars = vars;
    return result;
}

/**
 * Analyzes the solution to find violated constraints.
 * @param {Map} solutionVars - The solution variables map
 * @param {Array} violationVarInfo - Information about violation variables
 * @returns {Array} - List of violated constraints with details
 */
function analyzeViolations(solutionVars, violationVarInfo) {
    const violations = [];

    for (const info of violationVarInfo) {
        const value = solutionVars.get(info.name) || 0;

        if (Math.abs(value) > VIOLATION_THRESHOLD) {
            violations.push({
                constraintName: info.constraintName,
                violationType: info.type,
                violationAmount: value,
                constraintDetails: info.constraintDetails
            });
        }
    }

    // Sort by violation amount (descending)
    violations.sort((a, b) => Math.abs(b.violationAmount) - Math.abs(a.violationAmount));

    return violations;
}

/**
 * Logs detailed information about violated constraints to help debug infeasibility.
 * @param {Array} violations - List of violated constraints
 */
function logViolationAnalysis(violations) {
    if (violations.length === 0) {
        console.log('No constraint violations detected - solution is feasible');
        return;
    }

    console.log(`⚠️  INFEASIBILITY ANALYSIS: ${violations.length} constraint(s) violated`);

    // Group violations by type
    const byType = {};
    for (const v of violations) {
        const type = v.violationType;
        if (!byType[type]) byType[type] = [];
        byType[type].push(v);
    }

    // Log summary by type
    console.log('Violation Summary by Type:');
    for (const [type, items] of Object.entries(byType)) {
        console.log(`   - ${type}: ${items.length} constraint(s)`);
    }

    // Log detailed violations
    console.log('Detailed Constraint Violations (sorted by severity):');

    for (let i = 0; i < Math.min(violations.length, 20); i++) { // Show top 20
        const v = violations[i];
        console.log(`\n${i + 1}. Constraint: "${v.constraintName}"`);
        console.log(`   Type: ${v.violationType}`);
        console.log(`   Violation Amount: ${v.violationAmount.toFixed(6)}`);

        const details = v.constraintDetails;
        if (details.equal !== undefined) {
            console.log(`   Required: equal to ${details.equal}`);
        } else if (details.min !== undefined) {
            console.log(`   Required: >= ${details.min}`);
        } else if (details.max !== undefined) {
            console.log(`   Required: <= ${details.max}`);
        }

        // Parse constraint name to extract node/edge information
        if (v.constraintName.startsWith('edge_')) {
            const parts = v.constraintName.split('_');
            console.log(`   Involved Nodes: ${parts[1]} -> ${parts[2]}`);
            console.log(`   Constraint Type: ${parts.slice(3).join('_')}`);
        } else if (v.constraintName.startsWith('separation_')) {
            const parts = v.constraintName.split('_');
            console.log(`   Separation between: ${parts[1]} and ${parts[2]}`);
        } else if (v.constraintName.startsWith('space_')) {
            const parts = v.constraintName.split('_');
            console.log(`   Spacing constraint between: ${parts[1]} and ${parts[2]}`);
        }

        // Log variables involved
        if (details.vars) {
            console.log(`   Variables: ${Object.keys(details.vars).join(', ')}`);
        }
    }

    if (violations.length > 20) {
        console.log(`\n   ... and ${violations.length - 20} more violations (showing top 20)`);
    }
}

/**
 * Solves the LP model with elastic filter (soft constraints) for debugging infeasibility.
 * This version adds slack/surplus variables to all constraints, allowing the solver to
 * find a solution even when the original problem is infeasible.
 */
function solveLPModelWithElasticFilter(networkData, addSeparationConstraints = false, useSchematizedForSeparation = false) {
    // Clear the free variable registry for this solve (elastic uses same registry)
    freeVarRegistry.clear();

    const model = {
        direction: "minimize",
        objective: "objective",
        constraints: {},
        variables: {}
    };

    const objectiveCoefficients = {};
    const violationVarInfo = []; // Track all violation variables
    const originalConstraints = {}; // Store original constraints for analysis

    const addNonNegVar = (name) => {
        if (!model.variables[name]) {
            model.variables[name] = {};
        }
    };

    const addCoeff = (varName, coeff) => {
        objectiveCoefficients[varName] = (objectiveCoefficients[varName] || 0) + coeff;
    };

    // Helper to add a constraint with elastic filter (free-variable-aware)
    const addConstraintWithElastic = (name, constraint) => {
        originalConstraints[name] = { ...constraint };
        const soft = createSoftConstraint(name, constraint);

        // Only copy bounds to model.constraints (not vars)
        const constraintBounds = {};
        if (soft.constraint.min !== undefined) constraintBounds.min = soft.constraint.min;
        if (soft.constraint.max !== undefined) constraintBounds.max = soft.constraint.max;
        if (soft.constraint.equal !== undefined) constraintBounds.equal = soft.constraint.equal;
        model.constraints[name] = constraintBounds;

        // Add constraint coefficients to variables using free-variable-aware helper
        for (const [varName, coeff] of Object.entries(soft.constraint.vars)) {
            setVarCoeffInConstraint(model, varName, name, coeff);
        }

        // Add penalty for violation variables (these are always non-negative)
        for (const vInfo of soft.violationVars) {
            addNonNegVar(vInfo.name);
            addCoeff(vInfo.name, VIOLATION_PENALTY);
            violationVarInfo.push(vInfo);
        }
    };

    // Create FREE variables for each node position (can be negative)
    for (const node of networkData.nodes) {
        registerFreeVar(`${node.id}_x`, model);
        registerFreeVar(`${node.id}_y`, model);
    }

    // Process edges and create constraints
    const bendNodes = [];
    let skippedEdgesElastic = 0;

    for (const edge of networkData.edges) {
        edge.bend = null;

        if (!edge.nodes || (edge.ports[0] === -1 && edge.ports[1] === -1)) {
            skippedEdgesElastic++;
            continue;
        }

        const sourcePortId = edge.source_port?.octilinear_id ?? -1;
        const targetPortId = edge.target_port?.octilinear_id ?? -1;

        const isFixed = networkData.fixedAssignments &&
            networkData.fixedAssignments.has(`${edge.nodes[0].id}-${edge.nodes[1].id}`);
        const constraintWeight = isFixed ? 1000 : 1;

        let result;
        if (sourcePortId === -1) {
            result = createEdgeConstraints(edge.nodes[1], targetPortId, edge.nodes[0], minDist);
        } else if (targetPortId === -1) {
            result = createEdgeConstraints(edge.nodes[0], sourcePortId, edge.nodes[1], minDist);
        } else {
            if (sourcePortId === oppositePort(targetPortId)) {
                result = createEdgeConstraints(edge.nodes[0], sourcePortId, edge.nodes[1], minDist);
            } else {
                const bendName = `bend_${edge.nodes[0].id}_${edge.nodes[1].id}`;
                registerFreeVar(`${bendName}_x`, model);
                registerFreeVar(`${bendName}_y`, model);
                bendNodes.push({ edge, bendName });

                const res1 = createEdgeConstraints(edge.nodes[0], sourcePortId, { id: bendName }, minDist * 0.5);
                const res2 = createEdgeConstraints(edge.nodes[1], targetPortId, { id: bendName }, minDist * 0.5);

                result = {
                    constraints: {...res1.constraints, ...res2.constraints},
                    objectiveCoefficients: {...res1.objectiveCoefficients, ...res2.objectiveCoefficients}
                };
            }
        }

        // Add constraints with elastic filter
        for (const [name, constr] of Object.entries(result.constraints)) {
            addConstraintWithElastic(name, constr);
        }

        for (const [varName, coeff] of Object.entries(result.objectiveCoefficients)) {
            // Skip marker entries for variable creation
            if (varName.startsWith('__needsVar__')) {
                const actualVarName = varName.replace('__needsVar__', '');
                addNonNegVar(actualVarName);
                continue;
            }
            addCoeff(varName, coeff * constraintWeight);
        }
    }

    // Add separation constraints if requested
    if (addSeparationConstraints) {
        const separationResult = generateSeparationConstraints(networkData, useSchematizedForSeparation);
        for (const [name, constr] of Object.entries(separationResult.constraints)) {
            addConstraintWithElastic(name, constr);
        }
        for (const [varName, coeff] of Object.entries(separationResult.objectiveCoefficients)) {
            addCoeff(varName, coeff);
        }
    }

    model.constraints.objective = { max: 1e15 }; // Larger bound for elastic filter
    for (const [varName, coeff] of Object.entries(objectiveCoefficients)) {
        setVarObjective(model, varName, coeff);
    }

    const totalViolationVars = violationVarInfo.length;
    console.log(`Solving LP with Elastic Filter: ${Object.keys(model.variables).length} variables (${totalViolationVars} violation vars) and ${Object.keys(model.constraints).length} constraints`);

    const solution = solve(model, { precision: 1e-8, includeZeroVariables: true });

    // Analyze violations
    if (solution.status === "optimal") {
        const solutionVars = new Map(solution.variables);
        const violations = analyzeViolations(solutionVars, violationVarInfo);

        if (violations.length > 0) {
            logViolationAnalysis(violations);
        }

        return { solution, bendNodes, violations, violationVarInfo };
    }

    return { solution, bendNodes, violations: [], violationVarInfo };
}

/**
 * YALPS does not support unrestricted (free) variables — all variables are >= 0.
 * To model a free variable x, we split it into x = x_pos - x_neg where both >= 0.
 * This set of helpers manages that split transparently.
 */

// Set of logical variable names that need free-variable splitting
const freeVarRegistry = new Set();

/**
 * Registers a logical variable as "free" (unrestricted) and creates the
 * corresponding pos/neg pair in the YALPS model.
 */
function registerFreeVar(name, model) {
    freeVarRegistry.add(name);
    if (!model.variables[`${name}_pos`]) model.variables[`${name}_pos`] = {};
    if (!model.variables[`${name}_neg`]) model.variables[`${name}_neg`] = {};
}

/**
 * Adds a coefficient for a logical variable to a YALPS constraint row.
 * If the variable is free, the coefficient is split: +coeff on _pos, -coeff on _neg.
 * If the variable is non-negative (e.g. len_*), the coefficient goes directly.
 */
function setVarCoeffInConstraint(model, logicalVarName, constraintName, coeff) {
    if (freeVarRegistry.has(logicalVarName)) {
        model.variables[`${logicalVarName}_pos`][constraintName] = coeff;
        model.variables[`${logicalVarName}_neg`][constraintName] = -coeff;
    } else {
        if (!model.variables[logicalVarName]) model.variables[logicalVarName] = {};
        model.variables[logicalVarName][constraintName] = coeff;
    }
}

/**
 * Sets an objective coefficient for a logical variable.
 * Free variables get the coefficient on _pos and negated on _neg.
 */
function setVarObjective(model, logicalVarName, coeff) {
    if (freeVarRegistry.has(logicalVarName)) {
        model.variables[`${logicalVarName}_pos`].objective =
            (model.variables[`${logicalVarName}_pos`].objective || 0) + coeff;
        model.variables[`${logicalVarName}_neg`].objective =
            (model.variables[`${logicalVarName}_neg`].objective || 0) + (-coeff);
    } else {
        if (!model.variables[logicalVarName]) model.variables[logicalVarName] = {};
        model.variables[logicalVarName].objective =
            (model.variables[logicalVarName].objective || 0) + coeff;
    }
}

/**
 * Reads the value of a logical variable from the YALPS solution.
 * For free variables: value = pos - neg.
 */
function readVarValue(solutionVars, logicalVarName) {
    if (freeVarRegistry.has(logicalVarName)) {
        const pos = solutionVars.get(`${logicalVarName}_pos`) || 0;
        const neg = solutionVars.get(`${logicalVarName}_neg`) || 0;
        return pos - neg;
    }
    return solutionVars.get(logicalVarName);
}

/**
 * Solves the LP model with the given constraints
 */
function solveLPModel(networkData, addSeparationConstraints = false, useSchematizedForSeparation = false) {
    // Clear the free variable registry for this solve
    freeVarRegistry.clear();

    const model = {
        direction: "minimize",
        objective: "objective",
        constraints: {},
        variables: {}
    };

    const objectiveCoefficients = {};

    const addNonNegVar = (name) => {
        if (!model.variables[name]) {
            model.variables[name] = {};
        }
    };

    const addCoeff = (varName, coeff) => {
        objectiveCoefficients[varName] = (objectiveCoefficients[varName] || 0) + coeff;
    };

    // Create FREE variables for each node position (can be negative)
    for (const node of networkData.nodes) {
        registerFreeVar(`${node.id}_x`, model);
        registerFreeVar(`${node.id}_y`, model);
    }

    // Process edges and create constraints
    const bendNodes = [];
    const constrainedNodes = new Set(); // Track nodes that have at least one constraint
    let skippedEdges = 0;

    for (const edge of networkData.edges) {
        edge.bend = null;

        if (!edge.nodes || (edge.ports[0] === -1 && edge.ports[1] === -1)) {
            skippedEdges++;
            continue;
        }

        // Mark both nodes as constrained
        constrainedNodes.add(edge.nodes[0].id);
        constrainedNodes.add(edge.nodes[1].id);

        // Check if this edge has fixed port assignments
        const sourcePortId = edge.source_port?.octilinear_id ?? -1;
        const targetPortId = edge.target_port?.octilinear_id ?? -1;

        // Apply higher weight to fixed assignments to enforce them
        const isFixed = networkData.fixedAssignments &&
            networkData.fixedAssignments.has(`${edge.nodes[0].id}-${edge.nodes[1].id}`);
        const constraintWeight = isFixed ? 1000 : 1; // Higher weight for fixed assignments

        let result;
        if (sourcePortId === -1) {
            result = createEdgeConstraints(edge.nodes[1], targetPortId, edge.nodes[0], minDist);
        } else if (targetPortId === -1) {
            result = createEdgeConstraints(edge.nodes[0], sourcePortId, edge.nodes[1], minDist);
        } else {
            if (sourcePortId === oppositePort(targetPortId)) {
                result = createEdgeConstraints(edge.nodes[0], sourcePortId, edge.nodes[1], minDist);
            } else {
                const bendName = `bend_${edge.nodes[0].id}_${edge.nodes[1].id}`;
                // Bend nodes are also free variables (can be at negative positions)
                registerFreeVar(`${bendName}_x`, model);
                registerFreeVar(`${bendName}_y`, model);
                bendNodes.push({ edge, bendName });

                const res1 = createEdgeConstraints(edge.nodes[0], sourcePortId, { id: bendName }, minDist * 0.5);
                const res2 = createEdgeConstraints(edge.nodes[1], targetPortId, { id: bendName }, minDist * 0.5);

                result = {
                    constraints: {...res1.constraints, ...res2.constraints},
                    objectiveCoefficients: {...res1.objectiveCoefficients, ...res2.objectiveCoefficients}
                };
            }
        }

        for (const [name, constr] of Object.entries(result.constraints)) {
            // Only copy bounds to model.constraints (not the vars property)
            const constraintBounds = {};
            if (constr.min !== undefined) constraintBounds.min = constr.min;
            if (constr.max !== undefined) constraintBounds.max = constr.max;
            if (constr.equal !== undefined) constraintBounds.equal = constr.equal;
            model.constraints[name] = constraintBounds;

            // Add variable coefficients using the free-variable-aware helper
            for (const [varName, coeff] of Object.entries(constr.vars)) {
                setVarCoeffInConstraint(model, varName, name, coeff);
            }
        }
        for (const [varName, coeff] of Object.entries(result.objectiveCoefficients)) {
            // Skip marker entries for variable creation
            if (varName.startsWith('__needsVar__')) {
                const actualVarName = varName.replace('__needsVar__', '');
                addNonNegVar(actualVarName); // len vars are non-negative, not free
                continue;
            }
            addCoeff(varName, coeff * constraintWeight);
        }
    }

    // Log diagnostic info about skipped edges and unconstrained nodes
    if (skippedEdges > 0) {
        console.log(`[LP Debug] Skipped ${skippedEdges} edges (no port assignments)`);
    }
    const unconstrainedNodes = networkData.nodes.filter(n => !constrainedNodes.has(n.id));
    if (unconstrainedNodes.length > 0) {
        console.warn(`[LP Debug] ${unconstrainedNodes.length} unconstrained nodes (no edge constraints):`,
            unconstrainedNodes.map(n => n.id).slice(0, 10).join(', ') + (unconstrainedNodes.length > 10 ? '...' : ''));
        // Pin unconstrained nodes at their current position to prevent unboundedness
        for (const node of unconstrainedNodes) {
            const xPos = node.x || 0;
            const yPos = node.y || 0;
            model.constraints[`pin_${node.id}_x`] = { equal: xPos };
            setVarCoeffInConstraint(model, `${node.id}_x`, `pin_${node.id}_x`, 1);
            model.constraints[`pin_${node.id}_y`] = { equal: yPos };
            setVarCoeffInConstraint(model, `${node.id}_y`, `pin_${node.id}_y`, 1);
        }
    }

    // Add separation constraints if requested
    if (addSeparationConstraints) {
        const separationResult = generateSeparationConstraints(networkData, useSchematizedForSeparation);
        for (const [name, constr] of Object.entries(separationResult.constraints)) {
            const constraintBounds = {};
            if (constr.min !== undefined) constraintBounds.min = constr.min;
            if (constr.max !== undefined) constraintBounds.max = constr.max;
            if (constr.equal !== undefined) constraintBounds.equal = constr.equal;
            model.constraints[name] = constraintBounds;

            for (const [varName, coeff] of Object.entries(constr.vars)) {
                setVarCoeffInConstraint(model, varName, name, coeff);
            }
        }
        for (const [varName, coeff] of Object.entries(separationResult.objectiveCoefficients)) {
            addCoeff(varName, coeff);
        }
    }

    model.constraints.objective = { max: 1000000000 };
    for (const [varName, coeff] of Object.entries(objectiveCoefficients)) {
        setVarObjective(model, varName, coeff);
    }

    console.log(`Solving LP with ${Object.keys(model.variables).length} variables and ${Object.keys(model.constraints).length} constraints`);
    const solution = solve(model, { precision: 1e-8, includeZeroVariables: true });

    return { solution, bendNodes };
}

export async function runLinearProgramming(networkData) {
    const start = performance.now();

    if (networkData && networkData.links) {
        // Always sync edges to links - links is the canonical source after cut add/remove
        networkData.edges = networkData.links;
    }

    if (!networkData || !networkData.nodes || !networkData.edges) {
        console.error('Layout error: Invalid networkData object');
        return networkData;
    }

    // Pre-process nodes to include edges
    const nodeMap = new Map(networkData.nodes.map(node => [node.id, node]));
    for (const node of networkData.nodes) {
        node.edges = [];
    }

    for (const edge of networkData.edges) {
        // Handle both cases: when source/target are IDs or already objects
        let sourceNode, targetNode;

        if (typeof edge.source === 'string' || typeof edge.source === 'number') {
            sourceNode = nodeMap.get(edge.source);
        } else if (edge.source && edge.source.id) {
            sourceNode = nodeMap.get(edge.source.id);
        }

        if (typeof edge.target === 'string' || typeof edge.target === 'number') {
            targetNode = nodeMap.get(edge.target);
        } else if (edge.target && edge.target.id) {
            targetNode = nodeMap.get(edge.target.id);
        }

        if (sourceNode && targetNode) {
            edge.nodes = [sourceNode, targetNode];
            edge.source = sourceNode; // Ensure edge.source is the node object
            edge.target = targetNode; // Ensure edge.target is the node object
            sourceNode.edges.push(edge);
            targetNode.edges.push(edge);

            const sourcePortId = edge.source_port?.octilinear_id ?? -1;
            const targetPortId = edge.target_port?.octilinear_id ?? -1;
            edge.ports = [sourcePortId, targetPortId];

            // Connect port to edge
            if (sourcePortId !== -1 && sourceNode.portById?.[sourcePortId]) {
                sourceNode.portById[sourcePortId].edges.push(edge);
            }
            if (targetPortId !== -1 && targetNode.portById?.[targetPortId]) {
                targetNode.portById[targetPortId].edges.push(edge);
            }

            edge.getPortAt = function(node) {
                return this.nodes[0].id === node.id ? this.ports[0] :
                    this.nodes[1].id === node.id ? this.ports[1] : null;
            };

            edge.getOther = function(node) {
                return this.nodes[0].id === node.id ? this.nodes[1] :
                    this.nodes[1].id === node.id ? this.nodes[0] : null;
            };
        } else {
            console.warn('Could not find source or target node for edge:', edge);
        }
    }

    try {
        console.log('Starting layout LP with YALPS');

        // Check if this is a re-run after editing (schematized positions already exist)
        const isRerun = networkData.nodes.some(node => node.x_s !== undefined && node.y_s !== undefined);

        console.log(`=== LP solve (${isRerun ? 'rerun after edit' : 'first run'}) ===`);
        let { solution, bendNodes } = solveLPModel(networkData, false, isRerun);

        if (solution.status === "optimal") {
            let solutionVars = new Map(solution.variables);

            // Update node positions with solution (using readVarValue for free variables)
            for (const node of networkData.nodes) {
                const xVal = readVarValue(solutionVars, `${node.id}_x`);
                const yVal = readVarValue(solutionVars, `${node.id}_y`);
                if (xVal !== undefined && yVal !== undefined) {
                    node.x_s = xVal;
                    node.y_s = yVal;
                }
            }

            // Update bend positions (bends are also free variables)
            for (const { edge, bendName } of bendNodes) {
                const xVal = readVarValue(solutionVars, `${bendName}_x`);
                const yVal = readVarValue(solutionVars, `${bendName}_y`);
                if (xVal !== undefined && yVal !== undefined) {
                    edge.bend = { x: xVal, y: yVal };
                }
            }

            // Log coordinate ranges
            const xs = networkData.nodes.map(n => n.x_s);
            const ys = networkData.nodes.map(n => n.y_s);
            const minX_s = Math.min(...xs), maxX_s = Math.max(...xs);
            const minY_s = Math.min(...ys), maxY_s = Math.max(...ys);
            console.log(`[LP Solution] x_s range: [${minX_s.toFixed(1)}, ${maxX_s.toFixed(1)}], extent: ${(maxX_s - minX_s).toFixed(1)}`);
            console.log(`[LP Solution] y_s range: [${minY_s.toFixed(1)}, ${maxY_s.toFixed(1)}], extent: ${(maxY_s - minY_s).toFixed(1)}`);
            console.log(`[LP Solution] minDist setting: ${minDist}, minNodeDist: ${minNodeDist}`);

            const runtime = performance.now() - start;
            console.log(`Layout LP total runtime: ${runtime.toFixed(3)}ms`);
            console.log('Layout optimization completed successfully');
            return networkData;
        } else {
            console.error('Layout LP failed:', solution.status);

            // Use elastic filter to diagnose infeasibility
            if (USE_ELASTIC_FILTER) {
                console.log('\nRunning Elastic Filter to diagnose infeasibility...\n');
                const elasticResult = solveLPModelWithElasticFilter(networkData, false, isRerun);

                if (elasticResult.solution.status === "optimal" && elasticResult.violations.length > 0) {
                    // The elastic solution found violated constraints - these are the cause of infeasibility
                    console.log(`\n The original LP was infeasible because ${elasticResult.violations.length} constraint(s) could not be satisfied simultaneously.`);
                    console.log('   Review the violation analysis above to understand the root cause.\n');
                } else if (elasticResult.solution.status !== "optimal") {
                    console.error('Even the elastic filter could not find a solution:', elasticResult.solution.status);
                }
            }

            throw new InfeasibleSolutionError(solution.status);
        }
    } catch (error) {
        console.error('YALPS Layout error:', error);
        // Re-throw InfeasibleSolutionError
        if (error instanceof InfeasibleSolutionError) {
            throw error;
        }
        console.warn('Exception caught - falling back to Cartesian layout');

        // Fallback: use Cartesian positions as schematized positions
        for (const node of networkData.nodes) {
            if (node.x !== undefined && node.y !== undefined) {
                node.x_s = node.x;
                node.y_s = node.y;
            } else {
                console.error(`Node ${node.id} missing x or y coordinates`);
                node.x_s = 0;
                node.y_s = 0;
            }
        }

        return networkData;
    }
}

function oppositePort(port) {
    return (port + 4) % 8;
}

/**
 * Creates edge constraints for octilinear layout.
 *
 * For edge length minimization, we use auxiliary variables to model |distance|.
 * Instead of minimizing (xB - xA) which can go negative and cause unboundedness,
 * we introduce an auxiliary variable `len` and constraints:
 *   len >= (xB - xA)   and   len >= -(xB - xA) = (xA - xB)
 * Then we minimize `len`, which gives us |xB - xA|.
 */
function createEdgeConstraints(nodeA, port, nodeB, minDistance) {
    const constraints = {};
    const objectiveCoefficients = {};

    // Auxiliary variable for edge length (absolute value)
    const lenVarName = `len_${nodeA.id}_${nodeB.id}`;

    const addCoeff = (varName, coeff) => {
        objectiveCoefficients[varName] = (objectiveCoefficients[varName] || 0) + coeff;
    };

    // Always add the length variable to the objective (positive coefficient)
    addCoeff(lenVarName, 1);

    // Length variable must be non-negative
    constraints[`${lenVarName}_nonneg`] = { min: 0, vars: { [lenVarName]: 1 } };

    switch (port) {
        case 0: // W: nodeB is West of nodeA (nodeB.x < nodeA.x, same y)
            constraints[`edge_${nodeA.id}_${nodeB.id}_y_eq`] = { equal: 0, vars: { [`${nodeA.id}_y`]: 1, [`${nodeB.id}_y`]: -1 } };
            constraints[`edge_${nodeA.id}_${nodeB.id}_x_dist`] = { max: -minDistance, vars: { [`${nodeB.id}_x`]: 1, [`${nodeA.id}_x`]: -1 } };
            // len >= xA - xB (the actual distance since xA > xB)
            constraints[`edge_${nodeA.id}_${nodeB.id}_len1`] = { min: 0, vars: { [lenVarName]: 1, [`${nodeA.id}_x`]: -1, [`${nodeB.id}_x`]: 1 } };
            constraints[`edge_${nodeA.id}_${nodeB.id}_len2`] = { min: 0, vars: { [lenVarName]: 1, [`${nodeA.id}_x`]: 1, [`${nodeB.id}_x`]: -1 } };
            break;
        case 1: // SW: nodeB is SouthWest of nodeA
            constraints[`edge_${nodeA.id}_${nodeB.id}_diag1`] = { equal: 0, vars: { [`${nodeA.id}_x`]: 1, [`${nodeA.id}_y`]: 1, [`${nodeB.id}_x`]: -1, [`${nodeB.id}_y`]: -1 } };
            constraints[`edge_${nodeA.id}_${nodeB.id}_dist1`] = { max: -diag * minDistance, vars: { [`${nodeB.id}_x`]: 1, [`${nodeA.id}_x`]: -1 } };
            // len >= |xA - xB| (diagonal distance in x)
            constraints[`edge_${nodeA.id}_${nodeB.id}_len1`] = { min: 0, vars: { [lenVarName]: 1, [`${nodeA.id}_x`]: -1, [`${nodeB.id}_x`]: 1 } };
            constraints[`edge_${nodeA.id}_${nodeB.id}_len2`] = { min: 0, vars: { [lenVarName]: 1, [`${nodeA.id}_x`]: 1, [`${nodeB.id}_x`]: -1 } };
            break;
        case 2: // S: nodeB is South of nodeA (same x, nodeB.y > nodeA.y)
            constraints[`edge_${nodeA.id}_${nodeB.id}_x_eq`] = { equal: 0, vars: { [`${nodeA.id}_x`]: 1, [`${nodeB.id}_x`]: -1 } };
            constraints[`edge_${nodeA.id}_${nodeB.id}_y_dist`] = { min: minDistance, vars: { [`${nodeB.id}_y`]: 1, [`${nodeA.id}_y`]: -1 } };
            // len >= |yB - yA|
            constraints[`edge_${nodeA.id}_${nodeB.id}_len1`] = { min: 0, vars: { [lenVarName]: 1, [`${nodeA.id}_y`]: -1, [`${nodeB.id}_y`]: 1 } };
            constraints[`edge_${nodeA.id}_${nodeB.id}_len2`] = { min: 0, vars: { [lenVarName]: 1, [`${nodeA.id}_y`]: 1, [`${nodeB.id}_y`]: -1 } };
            break;
        case 3: // SE: nodeB is SouthEast of nodeA
            constraints[`edge_${nodeA.id}_${nodeB.id}_diag2`] = { equal: 0, vars: { [`${nodeA.id}_x`]: 1, [`${nodeA.id}_y`]: -1, [`${nodeB.id}_x`]: -1, [`${nodeB.id}_y`]: 1 } };
            constraints[`edge_${nodeA.id}_${nodeB.id}_dist2`] = { min: diag * minDistance, vars: { [`${nodeB.id}_x`]: 1, [`${nodeA.id}_x`]: -1 } };
            // len >= |xB - xA|
            constraints[`edge_${nodeA.id}_${nodeB.id}_len1`] = { min: 0, vars: { [lenVarName]: 1, [`${nodeA.id}_x`]: -1, [`${nodeB.id}_x`]: 1 } };
            constraints[`edge_${nodeA.id}_${nodeB.id}_len2`] = { min: 0, vars: { [lenVarName]: 1, [`${nodeA.id}_x`]: 1, [`${nodeB.id}_x`]: -1 } };
            break;
        case 4: // E: nodeB is East of nodeA (nodeB.x > nodeA.x, same y)
            constraints[`edge_${nodeA.id}_${nodeB.id}_y_eq`] = { equal: 0, vars: { [`${nodeA.id}_y`]: 1, [`${nodeB.id}_y`]: -1 } };
            constraints[`edge_${nodeA.id}_${nodeB.id}_x_dist`] = { min: minDistance, vars: { [`${nodeB.id}_x`]: 1, [`${nodeA.id}_x`]: -1 } };
            // len >= |xB - xA|
            constraints[`edge_${nodeA.id}_${nodeB.id}_len1`] = { min: 0, vars: { [lenVarName]: 1, [`${nodeA.id}_x`]: -1, [`${nodeB.id}_x`]: 1 } };
            constraints[`edge_${nodeA.id}_${nodeB.id}_len2`] = { min: 0, vars: { [lenVarName]: 1, [`${nodeA.id}_x`]: 1, [`${nodeB.id}_x`]: -1 } };
            break;
        case 5: // NE: nodeB is NorthEast of nodeA
            constraints[`edge_${nodeA.id}_${nodeB.id}_diag3`] = { equal: 0, vars: { [`${nodeA.id}_x`]: 1, [`${nodeA.id}_y`]: 1, [`${nodeB.id}_x`]: -1, [`${nodeB.id}_y`]: -1 } };
            constraints[`edge_${nodeA.id}_${nodeB.id}_dist3`] = { min: diag * minDistance, vars: { [`${nodeB.id}_x`]: 1, [`${nodeA.id}_x`]: -1 } };
            // len >= |xB - xA|
            constraints[`edge_${nodeA.id}_${nodeB.id}_len1`] = { min: 0, vars: { [lenVarName]: 1, [`${nodeA.id}_x`]: -1, [`${nodeB.id}_x`]: 1 } };
            constraints[`edge_${nodeA.id}_${nodeB.id}_len2`] = { min: 0, vars: { [lenVarName]: 1, [`${nodeA.id}_x`]: 1, [`${nodeB.id}_x`]: -1 } };
            break;
        case 6: // N: nodeB is North of nodeA (same x, nodeB.y < nodeA.y)
            constraints[`edge_${nodeA.id}_${nodeB.id}_x_eq`] = { equal: 0, vars: { [`${nodeA.id}_x`]: 1, [`${nodeB.id}_x`]: -1 } };
            constraints[`edge_${nodeA.id}_${nodeB.id}_y_dist`] = { max: -minDistance, vars: { [`${nodeB.id}_y`]: 1, [`${nodeA.id}_y`]: -1 } };
            // len >= |yA - yB|
            constraints[`edge_${nodeA.id}_${nodeB.id}_len1`] = { min: 0, vars: { [lenVarName]: 1, [`${nodeA.id}_y`]: -1, [`${nodeB.id}_y`]: 1 } };
            constraints[`edge_${nodeA.id}_${nodeB.id}_len2`] = { min: 0, vars: { [lenVarName]: 1, [`${nodeA.id}_y`]: 1, [`${nodeB.id}_y`]: -1 } };
            break;
        case 7: // NW: nodeB is NorthWest of nodeA
            constraints[`edge_${nodeA.id}_${nodeB.id}_diag4`] = { equal: 0, vars: { [`${nodeA.id}_x`]: 1, [`${nodeA.id}_y`]: -1, [`${nodeB.id}_x`]: -1, [`${nodeB.id}_y`]: 1 } };
            constraints[`edge_${nodeA.id}_${nodeB.id}_dist4`] = { max: -diag * minDistance, vars: { [`${nodeB.id}_x`]: 1, [`${nodeA.id}_x`]: -1 } };
            // len >= |xA - xB|
            constraints[`edge_${nodeA.id}_${nodeB.id}_len1`] = { min: 0, vars: { [lenVarName]: 1, [`${nodeA.id}_x`]: -1, [`${nodeB.id}_x`]: 1 } };
            constraints[`edge_${nodeA.id}_${nodeB.id}_len2`] = { min: 0, vars: { [lenVarName]: 1, [`${nodeA.id}_x`]: 1, [`${nodeB.id}_x`]: -1 } };
            break;
    }

    // Mark the length variable as needing to be created
    objectiveCoefficients[`__needsVar__${lenVarName}`] = true;

    return { constraints, objectiveCoefficients };
}

