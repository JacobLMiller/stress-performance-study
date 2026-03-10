import {
  forceSimulation,
  forceManyBody,
  forceCenter,
  forceLink,
  forceCollide,
} from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

export default function layout(input, opts = {}) {

    console.log("Running layout module");

    // Allow forcing link rebuild even if links exist
    const { forceRebuildLinks = false } = opts;

    let parsedData = input;
    if (!input.links || input.links.length === 0 || forceRebuildLinks) {
        if (forceRebuildLinks) {
            console.log("Force rebuilding links from set_order for topology change");
        } else {
            console.log("No links found, building from set_order");
        }
        parsedData = add_links(input);
    } else {
        console.log("Links already exist, preserving existing link structure");
    }

    parsedData = compute_inital_layout(parsedData);
    return parsedData;
}

function add_links(data) {
    console.log("Add links");
    const links = [];
    
    const converter = {};
    
    data.elements_o.forEach((elem, index) => {
      converter[elem] = index;
    });
    
    const n = data.elements_o.length;
    let adjacency = Array.from({ length: n }, () => Array(n).fill(null));
    console.log("Add links");

      for (const [label, set] of Object.entries(data.set_order)) {
        for (let i = 1;  i < set.length; i++) {
            const source = set[i - 1];
            const target = set[i];

            if (adjacency[converter[source]][converter[target]] === null) {    

                const link = {
                    source: source,
                    target: target,
                    label: [label],
                    source_order: [label],
                    target_order: [label]
                };

                links.push(link);

                adjacency[converter[source]][converter[target]] = link;
                adjacency[converter[target]][converter[source]] = link;
            }
            else {
                const link = adjacency[converter[source]][converter[target]];
        
                link.label.push(label);
                link.source_order.push(label);
                link.target_order.push(label);
            }
          }
        }

    data.links = links;
    console.log("links:", links);

    return data;

}

function compute_inital_layout(data) {

  const nodes = data.nodes;
  const links = data.links;

  const out = layoutForce(nodes, links, { iterations: 400, collide: 10, strength: -100, distanceMinNotAdjacent: 5, linkDistance: 30, edgeSubdivisions: 3 });

  out.forEach((node, index) => {
      data.nodes[index].x = node.x;
      data.nodes[index].y = node.y;
  });

  return data;

}


/**
 * Run a fixed-iteration force layout.
 *
 * @param {Array<{id:string|number, x?:number, y?:number}>} nodes
 * @param {Array<{source:string|number, target:string|number}>} links
 * @param {object}   [opts]
 * @param {number}   [opts.width=800]     virtual canvas width  (for centering)
 * @param {number}   [opts.height=800]    virtual canvas height (for centering)
 * @param {number}   [opts.strength=-30]  many-body strength    (negative = repel)
 * @param {number}   [opts.collide=0]     radius for forceCollide (0 ⇒ off)
 * @param {number}   [opts.iterations=300]  number of ticks to simulate
 * @param {number}   [opts.distanceMinNotAdjacent=1]  minimum distance for many-body force
 * @param {number}   [opts.edgeSubdivisions=3]  number of subdivision nodes per edge for node-edge repulsion
 * @returns {Array<{id, x, y, vx, vy}>}   nodes array with final positions
 */
export function layoutForce (nodes, links, opts = {}) {
  const {
    width = 800,
    height = 800,
    strength = -100,
    collide = 10,
    iterations = 500,
    distanceMinNotAdjacent = 50,
    linkDistance = 100,
    edgeSubdivisions = 3,
  } = opts;

  // Clone inputs so caller's objects aren't mutated unexpectedly.
  const n = nodes.map(d => ({ ...d }));
  const l = links.map(d => ({ ...d }));

  // Create subdivision nodes for each edge
  const subdivisionNodes = [];
  const subdivisionMap = new Map(); // Map from link index to its subdivision nodes

  if (edgeSubdivisions > 0) {
    l.forEach((link, linkIndex) => {
      const subdivisions = [];
      for (let i = 0; i < edgeSubdivisions; i++) {
        const subdivNode = {
          id: `__subdiv_${linkIndex}_${i}`,
          x: 0, // Will be initialized below
          y: 0,
          isSubdivision: true,
          linkIndex: linkIndex,
          subdivIndex: i,
          subdivTotal: edgeSubdivisions
        };
        subdivisions.push(subdivNode);
        subdivisionNodes.push(subdivNode);
      }
      subdivisionMap.set(linkIndex, subdivisions);
    });
  }

  // Initialize subdivision node positions along their edges
  const initializeSubdivisionPositions = () => {
    l.forEach((link, linkIndex) => {
      const subdivisions = subdivisionMap.get(linkIndex);
      if (!subdivisions) return;

      const sourceNode = n.find(node => node.id === link.source || node.id === link.source.id);
      const targetNode = n.find(node => node.id === link.target || node.id === link.target.id);

      if (sourceNode && targetNode) {
        subdivisions.forEach((subdivNode) => {
          const t = (subdivNode.subdivIndex + 1) / (subdivNode.subdivTotal + 1);
          subdivNode.x = sourceNode.x + t * (targetNode.x - sourceNode.x);
          subdivNode.y = sourceNode.y + t * (targetNode.y - sourceNode.y);
        });
      }
    });
  };

  // Initialize positions
  initializeSubdivisionPositions();

  // Combine real nodes and subdivision nodes for the simulation
  const allNodes = [...n, ...subdivisionNodes];

  const sim = forceSimulation(allNodes).alphaDecay(0.0001)
    .force('charge', forceManyBody().strength(2*strength).distanceMin(distanceMinNotAdjacent))
    .force('center', forceCenter(width / 2, height / 2))
    .force('link', forceLink(l).id(d => d.id).distance(linkDistance).strength(1))
    .stop();                      // turn off the built-in timer

  if (collide > 0) {
    sim.force('collide', forceCollide(collide));
  }

  // Manually advance the simulation.
  for (let i = 0; i < iterations; ++i) {
    sim.tick();

    // After each tick, reposition subdivision nodes to lie on their edges
    if (edgeSubdivisions > 0) {
      l.forEach((link, linkIndex) => {
        const subdivisions = subdivisionMap.get(linkIndex);
        if (!subdivisions) return;

        // Get the current source and target positions (may be objects with x,y or IDs)
        let sourceNode, targetNode;
        if (typeof link.source === 'object') {
          sourceNode = link.source;
        } else {
          sourceNode = allNodes.find(node => node.id === link.source);
        }
        if (typeof link.target === 'object') {
          targetNode = link.target;
        } else {
          targetNode = allNodes.find(node => node.id === link.target);
        }

        if (sourceNode && targetNode) {
          subdivisions.forEach((subdivNode) => {
            const t = (subdivNode.subdivIndex + 1) / (subdivNode.subdivTotal + 1);
            subdivNode.x = sourceNode.x + t * (targetNode.x - sourceNode.x);
            subdivNode.y = sourceNode.y + t * (targetNode.y - sourceNode.y);
            // Reset velocities to prevent drift
            subdivNode.vx = 0;
            subdivNode.vy = 0;
          });
        }
      });
    }
  }

  return n;                       // Return only real nodes, not subdivisions
}