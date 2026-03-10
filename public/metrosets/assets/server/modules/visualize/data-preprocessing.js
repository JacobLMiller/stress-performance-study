/**
 * Data preprocessing utilities for visualization
 */

export function preprocessVisualizationData(data) {
    const { nodes, links = [] } = data;

    const nodeDict = {};
    nodes.forEach(node => {
        nodeDict[node.id] = node;
        node.x = +node.x;
        node.y = +node.y;

        // Restore parent reference for ports if they exist
        if (node.ports && Array.isArray(node.ports)) {
            node.ports.forEach(port => {
                port.parent = node;
            });
        }
    });

    // Resolve node references in links
    links.forEach(link => {
        if (typeof link.source === 'string' || typeof link.source === 'number') {
            link.source = nodeDict[link.source];
        }
        if (typeof link.target === 'string' || typeof link.target === 'number') {
            link.target = nodeDict[link.target];
        }

        // Restore port references and update port.edges
        if (link.source && link.source.ports && link.source_port_octilinear_id !== undefined) {
             const port = link.source.ports.find(p => p.octilinear_id === link.source_port_octilinear_id);
             if (port) {
                 link.source_port = port;
                 if (!port.edges) port.edges = [];
                 if (!port.edges.includes(link)) port.edges.push(link);
             }
        }
        if (link.target && link.target.ports && link.target_port_octilinear_id !== undefined) {
             const port = link.target.ports.find(p => p.octilinear_id === link.target_port_octilinear_id);
             if (port) {
                 link.target_port = port;
                 if (!port.edges) port.edges = [];
                 if (!port.edges.includes(link)) port.edges.push(link);
             }
        }
    });

    // Filter out invalid nodes and links
    const validNodes = nodes.filter(Boolean);
    const validLinks = links.filter(link => link.source && link.target);

    return {
        nodes: validNodes,
        links: validLinks,
        nodeDict,
        set_order: data.set_order || {}
    };
}
