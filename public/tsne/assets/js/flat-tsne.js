

class FlatScatter {
    #colors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"]    
    #margin = {
        'top': 15, 
        'bottom': 15,
        'left': 15,
        'right': 15
    }

    constructor(svgid, nodes){
        this.svg = d3.select(svgid);
        this.layer1 = this.svg.append("g");

        this.nodes = nodes;

        let bbox = this.svg.node().getBoundingClientRect();
        this.width = bbox.width;
        this.height = bbox.height;
    }

    process(){
        let [xmin, xmax] = d3.extent(this.nodes, item => item.pos.x);
        let [ymin, ymax] = d3.extent(this.nodes, item => item.pos.y);

        let xscale = d3.scaleLinear().domain([xmin,xmax]).range([this.#margin.left, this.width - this.#margin.right]);
        let yscale = d3.scaleLinear().domain([ymin,ymax]).range([this.height - this.#margin.bottom, this.#margin.top]);

        this.nodes.forEach(d => {
            d.x = xscale(d.pos.x);
            d.y = yscale(d.pos.y);
        });

        this.draw();
    }

    draw(){
        this.layer1.selectAll(".node")
            .data(this.nodes, d => d.id)
            .join(
                enter => enter.append('circle')
                    .attr("class", "node")
                    .attr("cx", d => d.x)
                    .attr('cy', d => d.y)
                    .attr('r', 5)
                    .attr("fill", d => this.#colors[d.class])
            );
    }

}