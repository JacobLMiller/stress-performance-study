/**
 * Port class and related utilities for octilinear routing
 */

export class Port {
    constructor(id, x, y, angle, parent, octilinear_id) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.angle = angle;
        this.parent = parent;
        this.octilinear_id = octilinear_id;
        this.edges = [];
        this.usedCount = 0;
    }
}

export const DIRECTIONS = [
    { x: -1, y:  0 }, // 0 W
    { x: -1, y:  1 }, // 1 SW
    { x:  0, y:  1 }, // 2 S
    { x:  1, y:  1 }, // 3 SE
    { x:  1, y:  0 }, // 4 E
    { x:  1, y: -1 }, // 5 NE
    { x:  0, y: -1 }, // 6 N
    { x: -1, y: -1 }  // 7 NW
];

export function createPorts(data) {
    console.log("Creating ports");
    const { nodes } = data;

    nodes.forEach(node => {
        node.ports = [];
        node.portById = [];

        for (let dirId = 0; dirId < DIRECTIONS.length; dirId++) {
            const dir = DIRECTIONS[dirId];
            let angle = Math.atan2(dir.y, dir.x);
            if (angle < 0) angle += 2 * Math.PI;
            angle = angle * 180 / Math.PI;

            const port = new Port(`${node.id}-${dir.x}-${dir.y}`, dir.x, dir.y, angle, node, dirId);
            node.ports.push(port);
            node.portById[dirId] = port;
        }
        node.portsByAngle = [...node.ports].sort((a, b) => a.angle - b.angle);
    });
}

export function circularDistance(a, b) {
    let diff = Math.abs(a - b);
    return Math.min(diff, 360 - diff);
}

export function oppositePort(port) {
    return (port + 4) % 8;
}
