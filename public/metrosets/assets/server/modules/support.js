export default function support(input) {
    console.log("Running support module");
    return mip_based_support(input);
}

function mip_based_support(data) {
    const elements = data.elements;
    const sets = data.sets;

    console.log("Starting MIP-based support calculation");

    // Create element to index mapping
    const elementToIndex = {};
    elements.forEach((elem, index) => {
        elementToIndex[elem] = index;
    });

    const n = elements.length;
    const h = Object.keys(sets).length;

    // Create incidence matrix: incidence[setIndex][elementIndex] = true if element is in set
    const incidence = Array.from({ length: h }, () => Array(n).fill(false));
    const setKeys = Object.keys(sets);

    setKeys.forEach((setKey, setIndex) => {
        sets[setKey].forEach(elem => {
            const elemIndex = elementToIndex[elem];
            if (elemIndex !== undefined) {
                incidence[setIndex][elemIndex] = true;
            }
        });
    });

    // Create cost matrix - cost[i][j] is the number of crossing when element i comes before element j
    const cost = Array.from({ length: n + 1 }, () => Array(n + 1).fill(-1));

    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if (i !== j) {
                let crossings = 0;
                // Count crossings: number of sets where elements have different membership
                for (let setIndex = 0; setIndex < h; setIndex++) {
                    if (incidence[setIndex][i] !== incidence[setIndex][j]) {
                        crossings++;
                    }
                }
                cost[i][j] = crossings;
            }
        }
    }
    console.table(cost)
    // Add virtual last node (similar to Python implementation)
    const lastNodeIndex = n;
    for (let i = 0; i < n; i++) {
        // Cost from element to virtual end: number of sets containing this element
        let setsContaining = 0;
        for (let setIndex = 0; setIndex < h; setIndex++) {
            if (incidence[setIndex][i]) {
                setsContaining++;
            }
        }
        cost[i][lastNodeIndex] = setsContaining;

        cost[lastNodeIndex][i] = setsContaining; // Cost from virtual start to any element is 0
    }
    console.table(cost)

    console.log("Cost matrix computed, solving TSP...");

    // Held-Karp is O(2^n * n^2) — only feasible for small n.
    // For n > 20, 2^n exceeds ~1M states and will crash or OOM the browser.
    const HELD_KARP_MAX_NODES = 20;
    const totalNodes = n + 1; // +1 for the virtual "last" node

    if (totalNodes > HELD_KARP_MAX_NODES) {
        console.warn(`${totalNodes} nodes exceeds Held-Karp limit (${HELD_KARP_MAX_NODES}), using heuristic fallback`);
        return path_based_support_fallback(data);
    }

    console.log(`Using Held-Karp exact solver for ${totalNodes} nodes`);
    const { permutation, optimal } = solveTSPHeldKarp(cost, totalNodes);

    if (!optimal || permutation.length === 0) {
        console.warn("Held-Karp solver did not find optimal solution, falling back to heuristic");
        return path_based_support_fallback(data);
    }

    console.log("TSP solution found, permutation:", permutation);

    // Remove virtual node and adjust permutation
    let finalPermutation = permutation.filter(index => index !== lastNodeIndex);

    // Find where the virtual node was and rotate the permutation to start after it
    const lastNodePosition = permutation.indexOf(lastNodeIndex);
    if (lastNodePosition !== -1) {
        const rotationPoint = (lastNodePosition + 1) % permutation.length;
        finalPermutation = [
            ...permutation.slice(rotationPoint).filter(index => index !== lastNodeIndex),
            ...permutation.slice(0, rotationPoint).filter(index => index !== lastNodeIndex)
        ];
    }

    // Create element ordering based on permutation
    const elementOrder = finalPermutation.map(index => elements[index]);

    // Create new element to order mapping
    const converter = {};
    elementOrder.forEach((elem, index) => {
        converter[elem] = index;
    });

    // Create ordered sets based on the optimal permutation
    const set_order = {};
    Object.keys(sets).forEach(setKey => {
        const setElements = sets[setKey].slice();
        setElements.sort((a, b) => converter[a] - converter[b]);
        set_order[setKey] = setElements;
    });

    console.log("Support calculation completed");
    console.log("Final element order:", elementOrder);
    console.log("Set order:", set_order);

    data.set_order = set_order;
    return data;
}

/**
 * Held-Karp exact TSP solver using dynamic programming.
 * Time: O(2^n * n^2), Space: O(2^n * n).
 * Practical for n <= ~22 nodes.
 *
 * Finds the minimum-cost Hamiltonian cycle starting and ending at node 0.
 */
export function solveTSPHeldKarp(cost, n) {
    const INF = Number.MAX_SAFE_INTEGER;
    const fullMask = (1 << n) - 1;

    // dp[mask][i] = minimum cost to visit all nodes in `mask`, ending at node i,
    // starting from node 0.
    // mask is a bitmask where bit j is set if node j has been visited.
    const dp = new Array(1 << n);
    const parent = new Array(1 << n);
    for (let mask = 0; mask <= fullMask; mask++) {
        dp[mask] = new Float64Array(n).fill(INF);
        parent[mask] = new Int8Array(n).fill(-1);
    }

    // Start at node 0
    dp[1][0] = 0;

    for (let mask = 1; mask <= fullMask; mask++) {
        for (let u = 0; u < n; u++) {
            // u must be in mask
            if (!(mask & (1 << u))) continue;
            if (dp[mask][u] === INF) continue;

            for (let v = 0; v < n; v++) {
                // v must not be in mask yet
                if (mask & (1 << v)) continue;
                // Edge must exist (cost >= 0)
                if (cost[u][v] < 0) continue;

                const newMask = mask | (1 << v);
                const newCost = dp[mask][u] + cost[u][v];
                if (newCost < dp[newMask][v]) {
                    dp[newMask][v] = newCost;
                    parent[newMask][v] = u;
                }
            }
        }
    }

    // Find the best complete tour: visit all nodes and return to node 0
    let bestCost = INF;
    let lastNode = -1;

    for (let u = 1; u < n; u++) {
        if (dp[fullMask][u] === INF) continue;
        if (cost[u][0] < 0) continue;
        const totalCost = dp[fullMask][u] + cost[u][0];
        if (totalCost < bestCost) {
            bestCost = totalCost;
            lastNode = u;
        }
    }

    if (lastNode === -1) {
        console.error("Held-Karp: no valid tour found");
        return { permutation: [], optimal: false };
    }

    console.log(`Held-Karp optimal tour cost: ${bestCost}`);

    // Reconstruct the tour by backtracking through parent pointers
    const tour = [];
    let currentMask = fullMask;
    let currentNode = lastNode;

    while (currentNode !== -1) {
        tour.push(currentNode);
        const prevNode = parent[currentMask][currentNode];
        currentMask = currentMask ^ (1 << currentNode);
        currentNode = prevNode;
    }

    tour.reverse();  // tour now starts with node 0

    return { permutation: tour, optimal: true };
}

// Fallback to original heuristic method if Held-Karp fails
///TODO: add label to links;
function path_based_support_fallback(data) {
    console.log("Using fallback heuristic method");

    const elements = data.elements;
    const elem_dict = data.elem_dict;

    const converter = {};
    let initialOrder = [];

     elements.forEach((elem, index) => {
         converter[elem] = index;
         initialOrder.push(index);
     });

     const n = elements.length;

     let distanceMatrix = Array.from({ length: n }, () => Array(n).fill(0));

     for (let i = 0; i < n; i++) {
        const elem1 = elements[i];
        const sets1 = new Set(elem_dict[elem1]);

        for (let j = i + 1; j < n; j++) {
            const elem2 = elements[j];
            const sets2 = new Set(elem_dict[elem2]);

            let c = sets1.difference(sets2).size + sets2.difference(sets1).size;

            distanceMatrix[i][j] = c;
            distanceMatrix[j][i] = c;
        }
    }    

    console.log("order:", initialOrder);
    var ret = simulatedAnnealingTSP(distanceMatrix, initialOrder, {});
    console.log("best order:", ret[0]);

    console.log("converter:", converter);

    ret[0].forEach((order, index) => {
        let elem = elements[order];
        converter[elem] = index;
    });

    const set_order = {};

    Object.keys(data.sets).forEach((key) => {
        set_order[key] = [];
    });

    console.log("converter:", converter);

    for (const [label, set] of Object.entries(data.sets)) {
        set.sort((a, b) => converter[a] - converter[b]);
        
        set_order[label] = set;
        // for (let i = 1;  i < set.length; i++) {
        //     const source = set[i - 1];
        //     const target = set[i];

        //     if (adjacency[converter[source]][converter[target]] === false) {    

        //         links.push({
        //             source: source,
        //             target: target,
        //             label: label
        //         });

        //         adjacency[converter[source]][converter[target]] = true;
        //         adjacency[converter[target]][converter[source]] = true;
        //     }
            
        // }
    }

    data.set_order = set_order;

    return data

}

// Simulated annealing TSP solver
function simulatedAnnealingTSP(distanceMatrix, initialOrder, options = {}) {
  const tempStart = options.tempStart || 1000;
  const tempEnd = options.tempEnd || 1e-4;
  const alpha = options.alpha || 0.995;  // cooling rate
  const maxIter = options.maxIter || 100000;

  let currentOrder = [...initialOrder];
  let currentDistance = calculateTotalDistance(currentOrder, distanceMatrix);

  let bestOrder = [...currentOrder];
  let bestDistance = currentDistance;

  let temperature = tempStart;

  for (let iter = 0; iter < maxIter && temperature > tempEnd; iter++) {
    const newOrder = swapTwoCities(currentOrder);
    const newDistance = calculateTotalDistance(newOrder, distanceMatrix);

    const delta = newDistance - currentDistance;
    if (delta < 0 || Math.random() < Math.exp(-delta / temperature)) {
      currentOrder = newOrder;
      currentDistance = newDistance;

      if (newDistance < bestDistance) {
        bestOrder = [...newOrder];
        bestDistance = newDistance;
      }
    }

    temperature *= alpha;
  }

  return [bestOrder, bestDistance];
}

// Swap two cities to generate a new neighbor tour
function swapTwoCities(order) {
  const newOrder = [...order];
  const i = Math.floor(Math.random() * order.length);
  let j = Math.floor(Math.random() * order.length);
  while (j === i) {
    j = Math.floor(Math.random() * order.length);
  }

  [newOrder[i], newOrder[j]] = [newOrder[j], newOrder[i]];
  return newOrder;
}

// Calculate total distance of the tour
function calculateTotalDistance(order, distanceMatrix) {
  let total = 0;
  for (let i = 0; i < order.length; i++) {
    const from = order[i];
    const to = order[(i + 1) % order.length];  // wrap around
    total += distanceMatrix[from][to];
  }
  return total;
}
