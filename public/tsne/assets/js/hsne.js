class HSNE {
    #nodeRadiusLarge = 15;
    #nodeRadiusSmall = 5;

    #colors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"]    
    #margin = {top: 15, bottom: 15, left:15, right:15};

    constructor(svgID) {
        this.svg = d3.select(svgID);

        this.loading = document.getElementById("loading");
        
        this.curScale = 3;


        // [this.nodes, this.links, this.idMap] = initGraph(nodes,links);

        this.layer1 = this.svg.append("g");
        this.width = this.svg.node().getBoundingClientRect().width;
        this.height = this.svg.node().getBoundingClientRect().height;

        this.origin = {
            "x": this.width / 2,
            "y": this.height / 2
        }

        this.interactions = new Array();
        this.appendInteraction("start");

        this.center_node = null;

        this.selected = [];

        this.stack    = [];

        let container = document.getElementById("drillcontainer");
        if (container) {
            const button = Object.assign(document.createElement("button"), {
                textContent: "drill down",
                onclick: () => this.drillDown()
            });
            container.appendChild(button);
        }
        container = document.getElementById("popstack");
        if (container) {
            const button = Object.assign(document.createElement("button"), {
                textContent: "Go back",
                onclick: () => this.popStack()
            });
            container.appendChild(button);
        }

        this.loading.style.left = `${this.width / 2}px`;
        this.loading.style.top = `${this.height / 2}px`;


    }

    addData(nodes,links,fname){
        this.nodes = nodes;

        this.idMap = new Map();
        this.nodes.forEach((n,index) => {
            n.id = n.id.toString();
            this.idMap.set(n.id, index)
        });
        this.fname = fname;
    }

    drillDown(){
        let landmarks = this.layer1.selectAll(".hover-node").data().map((d,i) => d.index);
        let ddata = {"ids": landmarks, "depth": this.curScale, "dname": this.fname};
        if (this.curScale > 1){
            this.stack.push(this.nodes);
            this.loading.classList.add('display');
            fetch('https://hyperbolic.algo.cit.tum.de/query', {
                'method': 'POST',
                'headers': {"Content-Type": 'application/json'},
                'body': JSON.stringify(ddata)
            })
            .then(response => { 
                console.log(response);
                return response.json()})
            .then(data => {
                console.log(data);
                this.nodes = data.data.nodes;
                this.process();
                this.draw();
                this.curScale -= 1;
                this.loading.classList.remove("display");
                document.getElementById("popstack").style.display = 'block';
            })
            .catch(error => console.error(error));
        }
    }

    popStack(){
        this.nodes = this.stack.pop();
        this.curScale += 1;
        if (this.stack.length < 1)
            document.getElementById("popstack").style.display = 'none';
        this.draw();        
    }
    
    appendInteraction(e){
        this.interactions.push(
            {"time": Date.now().toString(), 
             "event": e}
        );
    }

    dumpJson(){
        return JSON.stringify(this.interactions);
    }

    process(){
        //TODO: Change aspect ratio to square
        let xextent = d3.extent(this.nodes, d => d.euclidean.x);
        let yextent = d3.extent(this.nodes, d => d.euclidean.y);

        let xscale = d3.scaleLinear().domain(xextent).range([this.#margin.left, this.width-this.#margin.right]);
        let yscale = d3.scaleLinear().domain(yextent).range([this.#margin.top, this.height-this.#margin.bottom]);

        this.nodes.forEach(d => {
            d.x = xscale(d.euclidean.x);
            d.y = yscale(d.euclidean.y);
            d.r = this.#nodeRadiusSmall;
        });

        console.log(this.nodes)
        
    }

    draw(){
        // if(this.stack.length > 0){
        //     document.getElementById("popstack").style.display = 'block';
        // }else{
        //     document.getElementById("popstack").style.display = 'none';
        // }
        this.layer1.selectAll(".nodes")
            .data(this.nodes, d => d.id)
            .join(
                enter => enter.append("circle")
                    .attr("class", "nodes")
                    .attr("stroke", "black")
                    .attr("fill", d => d.class ? this.#colors[Math.abs(d.class)] : this.#colors[0])
                    .attr("cx", d => d.x)
                    .attr("cy", d => d.y)
                    .attr("r", d => d.r),
                update => update
                    .attr("cx", d => d.x)
                    .attr("cy", d => d.y)
                    .attr("fill", d => d.class ? this.#colors[Math.abs(d.class)] : this.#colors[0]), 
                exit => exit.remove()
            )
            .attr("id", d => {
                return "node_" + d.id;
            });
    }

    addZoom(){
        this.layer1.attr("transform", d3.zoomIdentity);
        this.zoom = d3.zoom()
            .scaleExtent([0.1, 10])
	        .on('zoom', e => {
                this.layer1.attr('transform', e.transform);
                this.layer1.selectAll(".nodes")
                    .attr("r", d => d.r / e.transform.k);
            });
        this.svg.call(this.zoom);
        this.svg.on("dblclick.zoom", null);        
        // this.svg.on("wheel.zoom", null);
        document.getElementById("visualization-container").addEventListener('wheel', () => this.appendInteraction("zoom"))
    }

    addHover(id_list){
        if (! id_list){
            id_list = [];
        }
        var tthis = this;
        this.layer1.selectAll(".nodes")
            .on("mouseenter", function(e,d) {
                if (!id_list.includes("node_" + d.id)) {
                    d3.select(this).attr("class", "nodes hover-node"); //function(){} syntax has a different "this" which is the svg element attached.
                }

                tthis.appendInteraction("hover");
            })
            .on("mouseleave", (e, d) => {
                this.layer1.selectAll(".nodes").filter(n => !id_list.includes("node_" + n.id))
                    .attr("class", "nodes default-node");
                
            });
    }

    makeCenter(x,y, k=1, duration=750){
        let t = d3.transition().duration(duration);
        this.svg.transition(t).call(
            this.zoom.transform, 
            d3.zoomIdentity.translate(x,y).scale(k)
        );
    }

    addDblClick(){
        this.svg.on("dblclick", e => {
            const transform = this.layer1.node().attributes.transform.value.toString();
            let floats = getFloatsFromString(transform);
            let x0 = floats[0];
            let y0 = floats[1];
            let k0 = floats[2];

            let xmove = this.origin.x + x0;
            let ymove = this.origin.y + y0;

            let [x,y] = d3.pointer(e);
            
            this.makeCenter(xmove - x, ymove-y, k0);

            this.appendInteraction("dblclick");


        });
    }

    addResetButton(){
        var resetButton = document.createElement("button")
        resetButton.classList.add("reset-button")
        document.getElementById("sidebar").appendChild(resetButton)
        resetButton.appendChild(document.createTextNode('Reset Visualization'));
        resetButton.onclick = () => {
            this.resetToDefault();
        }            
    }

    setToCenterNode(){
        const transform = this.layer1.node().attributes.transform.value.toString();
        let floats = getFloatsFromString(transform);
        let x0 = floats[0];
        let y0 = floats[1];
        let xmove = this.origin.x + x0;
        let ymove = this.origin.y + y0;
        let c_node = this.nodes[this.center_node];

        this.makeCenter(xmove-c_node.x, ymove-c_node.y, 1, 0);     
    }

    addBrush(){
        const brush = d3.brush()
            .extent([[0,0], [this.width, this.height]])
            // .on("start", () => console.log("brush start"))
            // .on("end", () => console.log("brush end"))
            .on("brush", e => {
                if (!e.selection) return;

                const [[x0,y0], [x1,y1]] = e.selection;
                this.layer1.selectAll(".nodes")
                    .classed("hover-node", d => {
                        return x0 <= d.x && d.x <= x1 && y0 <= d.y && d.y <= y1;
                });
            });
        this.svg.call(brush);
    }

    interact(id_list){
        this.layer1.on("click", () => {
            this.appendInteraction("pan");
        })
        // this.addZoom();
        this.addBrush();
        this.addHover(id_list);
        this.addDblClick();
        // this.addResetButton();

        if (this.center_node !== null){
            this.setToCenterNode();
        }
    }

    highlight_question(id_list) {
        this.layer1.selectAll(".nodes").filter(n => id_list.includes("node_" + n.id))
            .attr("class", "nodes question-node")
            .attr("r", d => d.r = this.#nodeRadiusLarge);

    }

    resetToDefault(){
        this.svg.call(this.zoom.transform, d3.zoomIdentity);
        // if(this.center_node){
        //     this.setToCenterNode();
        // }

        this.appendInteraction("reset");
    }
}