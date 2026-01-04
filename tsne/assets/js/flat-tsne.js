

class FlatScatter {
    #colors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"]    
    #margin = {
        'top': 15, 
        'bottom': 15,
        'left': 15,
        'right': 15
    }

    //Change the color first

    constructor(svgid, nodes, parameters){
        this.svg = d3.select(svgid);
        this.layer1 = this.svg.append("g");

        this.nodes = nodes;

        let bbox = this.svg.node().getBoundingClientRect();
        this.width = bbox.width;
        this.height = bbox.height;

        this.qtype = parameters.qtype;
        this.qid   = Number(parameters.id);
        this.correctindex = Number(parameters.correct);

        if (this.qtype === "point"){
            const shapes = [
                d3.symbolTriangle, 
                d3.symbolCross, 
                d3.symbolDiamond, 
                d3.symbolStar
            ]; 
            this.shape = shapes[this.correctindex];
        }
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
        const symbol = d3.symbol().size(20);
        this.layer1.selectAll(".node")
            .data(this.nodes, d => d.id)
            .join(
                enter => enter.append('path')
                    .attr("class", "node")
                    .attr("d", d => symbol.type(
                        d.id === this.qid ? this.shape : d3.symbolCircle
                     )()
                    )
                    // .attr("cx", d => d.x)
                    // .attr('cy', d => d.y)
                    // .attr('r', 5)
                    .attr("transform", d => `translate(${d.x}, ${d.y})`)
                    // .attr("fill", d => this.#colors[d.class])
                    .attr("fill", this.#colors[0])
            );
    }

}