var acosh = Math.acosh;
var asinh = Math.sinh;
var atanh = Math.atanh;
var cosh = Math.cosh;
var sinh = Math.sinh;
var tanh = Math.tanh;
var atan = Math.atan; 
var cos = Math.cos;
var sin = Math.sin;

//Enum (no vanilla js implementation)
const HoverState = {
    "NOT_HOVERED": 0,
    "HOVERED": 1,
    "HOVER_NEIGHBOR": 2
};

function drawTriangle(ctx, x, y, size) {
  const h = size * Math.sqrt(3) / 2;
  ctx.beginPath();
  ctx.moveTo(x, y - h/2);
  ctx.lineTo(x - size/2, y + h/2);
  ctx.lineTo(x + size/2, y + h/2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();  
}

function drawDiamond(ctx, x, y, size) {
  const s = size / 2;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - s, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawCross(ctx, x, y, size, thickness = size / 3) {
  const t = thickness / 2, s = size / 2;
  ctx.beginPath();
  // Trace the outer perimeter clockwise (12-vertex polygon)
  ctx.moveTo(x - t, y - s);
  ctx.lineTo(x + t, y - s);
  ctx.lineTo(x + t, y - t);
  ctx.lineTo(x + s, y - t);
  ctx.lineTo(x + s, y + t);
  ctx.lineTo(x + t, y + t);
  ctx.lineTo(x + t, y + s);
  ctx.lineTo(x - t, y + s);
  ctx.lineTo(x - t, y + t);
  ctx.lineTo(x - s, y + t);
  ctx.lineTo(x - s, y - t);
  ctx.lineTo(x - t, y - t);
  ctx.closePath();

  ctx.fill();
  ctx.stroke();
}

function drawStar(ctx, x, y, r) {
    r *= 0.7
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i;
    const radius = i % 2 === 0 ? r : r * 0.4;
    ctx.lineTo(x + radius * Math.sin(angle),
               y - radius * Math.cos(angle));
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}


//Math helpers ---------------------------------------------------

function l2_norm_hyperbol(v){
    return Math.sqrt(v.x*v.x + v.y*v.y);
}

function complex(re,im){
    return {"re": re, "im": im};
}

function conjugate(z){
    return {"re": z.re, "im": -z.im};
}

function negative(z){
    return {"re": -z.re, "im": -z.im};
}

function complex_add(z1,z2){
    return {"re": z1.re + z2.re, "im": z1.im + z2.im};
}

function complex_mult(z1,z2){
    return {"re": z1.re*z2.re - z1.im*z2.im, "im": z1.re*z2.im + z1.im*z2.re};
}

function complex_div(z1,z2){
    let numerator = complex_mult(z1,conjugate(z2));
    let denominator = complex_mult(z2,conjugate(z2));
    return {"re": numerator.re / denominator.re, "im": numerator.im / denominator.re};
}

function set_transform(a,b,c,d){
    return {"a": a, "b": b, "c": c, "d": d};
}

function mobius(z, transform){
    return complex_div(
        complex_add(complex_mult(transform.a, z), transform.b), 
        complex_add(complex_mult(transform.c, z), transform.d)
    );
}

function cartToPolar(v){
    let r = l2_norm_hyperbol(v);
    let theta = Math.atan2(v.y,v.x);
    return {'r': r, 'theta': theta};
}


function lobachevskyToPolar(pt){
    let coshx = cosh(pt.x); 
    let coshy = cosh(pt.y);
    let r = acosh(coshx * coshy);
    let theta = 2 * atan(sinh(pt.y) / (sinh(pt.x) * coshy + Math.sqrt(coshx*coshx*coshy*coshy - 1)));
    return {"r": r, "theta": theta};
}

function polarToLobachevsky(pt){
    let x = atanh(tanh(pt.r) * cos(pt.theta));
    let y = atanh(tanh(pt.r) * sin(pt.theta));
    return {"x": x, "y": y};
}

//---------------------------------------------------------------------------------------

class HyperbolicVis {
    #nodeRadiusLarge = 0.02;
    #nodeRadiusSmall = 0.02;
    #stepSize = 10;

    #colors = ["#4e79a7","#f28e2c","#e15759","#76b7b2","#59a14f","#edc949","#af7aa1","#ff9da7","#9c755f","#bab0ab"];
    #margin = {top: 15, bottom: 15, left:15, right:15};

    constructor(divId,nodes,links, center_node,parameters) {
        var canvas = HyperbolicCanvas.create(divId);
        var selection = d3.select(canvas);

        // selection.getContext("webgl")
        var defaultProperties = {
            lineJoin: 'round',
            lineWidth: 1,
            strokeStyle: "#D3D3D3",
            fillStyle: '#66B2FF'
        }
        canvas.setContextProperties(defaultProperties);
        this.hcanvas = canvas;

        this.initialHeight = this.hcanvas.getUnderlayElement().offsetHeight;
        
        this.setHeight();

        this.curPos = HyperbolicCanvas.Point.ORIGIN;
        this.curScale = {"a": 1, "b": 0, "c": 0, "d": 1, "e": 0, "f": 0};

        this.curMove = {"x": 0, "y": 0};
        this.originalOrigin = complex(0,0);
        this.hoverNodes = [];

        this.lastHover = false;

        this.interactions = new Array();

        this.appendInteraction("start");

        this.center_node = center_node;

        this.qtype = parameters.qtype;
        this.qid   = new Set(parameters.id);
        this.correctindex = Number(parameters.correct);

        if (this.qtype === "point"){
            const shapes = [
                (ctx, x, y, s) => drawTriangle(ctx, x, y, s),
                (ctx, x, y, s) => drawCross(ctx, x, y, s),
                (ctx, x, y, s) => drawDiamond(ctx, x, y, s),
                (ctx, x, y, s) => drawStar(ctx, x, y, s)
            ]; 
            this.shape = shapes[this.correctindex];
        }        
    }

    addData(nodes,links,fname){
        this.nodes = nodes;
        this.links = [];

        this.idMap = new Map();
        this.nodes.forEach((n,index) => {
            n.id = index;
            this.idMap.set(n.id, index)
        });
        
        this.fname = fname;
    }

    setHeight(){
        this.width = this.hcanvas.getUnderlayElement().offsetWidth;
        this.height = this.hcanvas.getUnderlayElement().offsetHeight;

        this.curPos = HyperbolicCanvas.Point.ORIGIN;
        this.pixelOrigin = {"x": this.width / 2, "y": this.height / 2};
    }

    appendInteraction(e){
        this.interactions.push(
            {"time": Date.now().toString(), 
             "event": e,}
        );
    }    
    
    appendInteraction(e, v_id){
        this.interactions.push(
            {"time": Date.now().toString(), 
             "event": e,
             "node": v_id}
        );
    }

    dumpJson(){
        return JSON.stringify(this.interactions);
    }


    process(){
        this.nodes.forEach((n,i) => {
            // n.polar = lobachevskyToPolar(n.hyperbolic);
            n.id = i;
            n.polar = cartToPolar(n);
            n.hpnt = HyperbolicCanvas.Point
                .givenEuclideanPolarCoordinates(n.polar.r, n.polar.theta);
            n.complex = complex(n.hpnt.getX(), n.hpnt.getY());

            n.hovered = HoverState.NOT_HOVERED;
        });
    }

    draw(){
        let ctx = this.hcanvas.getContext();
        this.hcanvas.clear();

        ctx.setTransform(this.curScale);
          
    
        const isSpecial = (p) => this.qid.has(Number(p.id));

        this.nodes.forEach(n => {
            if(isSpecial(n)) return;
            ctx.strokeStyle = "black";
            ctx.lineWidth = 0.3;
            // ctx.globalAlpha = 0.25;
            let radius = this.#nodeRadiusSmall;
            if (this.hoverNodes.includes(`node_${n.id}`)){
                // console.log(n.class)
                ctx.fillStyle = "#FE6100";
                ctx.lineWidth = 3;
                radius = this.#nodeRadiusLarge;
            } else {
                if (n.hovered === HoverState.HOVERED){
                    ctx.fillStyle = "#FFB000";
                }else if(n.hovered === HoverState.HOVER_NEIGHBOR){
                    ctx.fillStyle = "#DC267F";
                }else{
                    // ctx.fillStyle = this.#colors[n.class];
                    ctx.fillStyle = this.#colors[0];
                }
            }
            
            ctx.strokeStyle = "#000";   // black outline
            ctx.lineWidth = 0.5;            
            
            n.hcircle = HyperbolicCanvas.Circle.givenHyperbolicCenterRadius(
                n.hpnt, radius / this.curScale.a
            );


            this.hcanvas.fillAndStroke(
                this.hcanvas.pathForHyperbolic(n.hcircle)
            );
        });

        this.nodes.forEach(n => {
            if (!isSpecial(n)) return;
            ctx.strokeStyle = "black";
            ctx.lineWidth = 0.3;
            // ctx.globalAlpha = 0.25;
            let radius = this.#nodeRadiusSmall;
            if (this.hoverNodes.includes(`node_${n.id}`)){
                // console.log(n.class)
                ctx.fillStyle = "#FE6100";
                ctx.lineWidth = 3;
                radius = this.#nodeRadiusLarge;
            } else {
                if (n.hovered === HoverState.HOVERED){
                    ctx.fillStyle = "#FFB000";
                }else if(n.hovered === HoverState.HOVER_NEIGHBOR){
                    ctx.fillStyle = "#DC267F";
                }else{
                    // ctx.fillStyle = this.#colors[n.class];
                    ctx.fillStyle = this.#colors[0];
                }
            }
            ctx.strokeStyle = "#000";   // black outline
            ctx.lineWidth = 0.5;            
            
            
            n.hcircle = HyperbolicCanvas.Circle.givenHyperbolicCenterRadius(
                n.hpnt, radius / this.curScale.a
            );

                
            const center = n.hcircle.getEuclideanCenter();
            console.log(n.hcircle.getEuclideanRadius())
            let [x,y] = this.hcanvas.getCanvasPixelCoords(center);
            this.shape(
                ctx,
                x,
                y,
                2.7 * n.hcircle.getEuclideanRadius() * this.hcanvas.getRadius()
            );
        })

        ctx.lineWidth = 3;
        this.hcanvas.stroke(this.hcanvas.pathForEuclidean(HyperbolicCanvas.Circle.UNIT));

        ctx.setTransform(1,0,0,1,0,0);

    }

    takeZToCenter(z){
        let transform = {
            "a": complex(1,0),
            "b": negative(z),
            "c": negative(conjugate(z)),
            "d": complex(1,0)
        };
        return z0 => mobius(z0, transform);
    }

    reposition(z){
        let transform = this.takeZToCenter(z);
        this.nodes.forEach(n => {
            n.complex = transform(n.complex);
            n.hpnt = HyperbolicCanvas.Point.givenCoordinates(n.complex.re, n.complex.im);
        });
        this.draw();
    }

    animate(interpolation, curInd){

        this.nodes.forEach(n => {
            let tmp = n.hpntInterp[curInd];
            n.hpnt = HyperbolicCanvas.Point.givenCoordinates(tmp.re, tmp.im);
        });

        this.draw();                    

        //Either call this again on next frame if there is more to do 
        if(curInd+1 < interpolation.length){
            requestAnimationFrame(() => this.animate(interpolation, curInd+1));
        }
        //Or clean up
        else{
            this.nodes.forEach(n => {
                n.complex = n.hpntInterp[interpolation.length-1];
            });
        } 
    }

    addDblClick(){
        let interpLen = 40;

        let onDblClick = e => {
            let x = ((this.width - e.layerX) - this.curScale.e) / this.curScale.a;
            let y = ((this.height - e.layerY) - this.curScale.f) / this.curScale.d;
            let destPos = this.hcanvas.at([x,y]);
            destPos = complex(-destPos.getX(), -destPos.getY());

            //Identity transform
            var transform_start = {
                "a": complex(1,0), 
                "b": complex(0,0), 
                "c": complex(0,0), 
                "d": complex(1,0)
            };

            //Takes destPos to center
            var transform_end = {
                "a": complex(1,0),
                "b": negative(destPos),
                "c": negative(conjugate(destPos)),
                "d": complex(1,0)
            };

            //Create an array of transformations to animate.
            let interpArr = new Array(interpLen).fill(-1);
            interpArr = interpArr.map((n,i) => {
                //Linear interpolation, then convert to complex number
                let t = (i+1) / interpLen;
                let left = complex(1-t,0);
                let right = complex(t,0)

                //Can compose mobius transformations via linear combination of its components. 
                let transform = {
                    "a": complex_add( complex_mult(left,transform_start.a), complex_mult(right,transform_end.a) ), 
                    "b": complex_add( complex_mult(left,transform_start.b), complex_mult(right,transform_end.b) ), 
                    "c": complex_add( complex_mult(left,transform_start.c), complex_mult(right,transform_end.c) ), 
                    "d": complex_add( complex_mult(left,transform_start.d), complex_mult(right,transform_end.d) )
                }
                return transform;
            });

            this.nodes.forEach(n => {
                n.hpntInterp = interpArr.map((transform) => {
                    return mobius(n.complex, transform);
                });
            })
            // this.originalOrigin = mobius(this.originalOrigin, transform_end);

            this.animate(interpArr, 0); 

            this.appendInteraction("dblclick");
        };
        this.hcanvas.getCanvasElement().addEventListener("dblclick", onDblClick);
    }

    checkToAddHoverInteraction(is_highlight, n){
        if (this.lastHover === false && is_highlight === true)
            this.lastHover = true;
        else if (this.lastHover === true && is_highlight === false){
            this.appendInteraction("hover", n.id);
            this.lastHover = false;
        }
    }

    highlightOverlap(e){
        let x = (e.layerX - this.curScale.e) / this.curScale.a;
        let y = (e.layerY - this.curScale.f) / this.curScale.d;
        let mousepnt = this.hcanvas.at([x,y]);

        var node = null;
        let is_highlight = this.nodes.some(n => {
            let is_currently_overlapping = n.hcircle.containsPoint(mousepnt);
            n.hovered = HoverState.NOT_HOVERED;
            node = n;
            return is_currently_overlapping;
        });
        
        if(is_highlight){
            node.hovered = HoverState.HOVERED;
            // node.neighbors.forEach(v => this.nodes[v].hovered = HoverState.HOVER_NEIGHBOR);
        }

        this.checkToAddHoverInteraction(is_highlight, node);            
        

        this.draw();
        
    }

    addPan(){

        var dragged = false;
        var onDown = e => {
            dragged = true;
            this.curMove = {"x": e.clientX, "y": e.clientY};
            this.appendInteraction("pan");
        }
        var onUp = e => {
            dragged = false;     
        }
        var whileDragging = e => {
            let newMove = {"x": e.clientX, "y": e.clientY};
            if(dragged){
                let diff = {"x": newMove.x - this.curMove.x, "y": newMove.y - this.curMove.y};
                let norm = l2_norm_hyperbol(diff);
                if (norm > 2){
                    var unit = {"x": diff.x / norm, "y": diff.y / norm};
                    let loc = this.hcanvas.at([this.pixelOrigin.x - this.#stepSize * unit.x, this.pixelOrigin.y - this.#stepSize * unit.y]);
                    this.reposition(complex(loc.getX(), loc.getY()));
                }
                this.curMove = newMove;
            }
            else{
                // this.highlightOverlap(e);
            }
        }
      
        this.hcanvas.getCanvasElement().addEventListener('mousemove', whileDragging);
        this.hcanvas.getCanvasElement().addEventListener('mousedown', onDown);
        this.hcanvas.getCanvasElement().addEventListener('mouseup', onUp);
    }

    addZoom(){
        let zoom = (e) => {
            // let container = this.hcanvas.getContainerElement();
            // let scrollSpeed = 0.1;
            // let newHeight = Math.min(1200, Math.max(200, this.height + scrollSpeed * e.deltaY));
            // container.style.height = `${newHeight}px`;
            // this.hcanvas.clear();
            // this.hcanvas._setupSize();
            // this.setHeight();
            this.appendInteraction("zoom")
            
            let dir = Math.sign(-e.deltaY);
            let s = Math.min(10, Math.max(0.1, this.curScale.a + 0.1 * dir));
            this.curScale = {
                "a": s,
                "b": 0, 
                "c": 0, 
                "d": s, 
                "e": this.pixelOrigin.x - s * this.pixelOrigin.x, 
                "f": this.pixelOrigin.y - s * this.pixelOrigin.y 
            }
            this.draw();
        }

        function preventScroll(e){
            e.preventDefault();
            e.stopPropagation();
            return false;
        }        

        let visContainer = document.getElementById("visualization-container")
        visContainer.addEventListener('wheel', preventScroll);
        visContainer.addEventListener('wheel', zoom);

    }

    addResetButton(){
        var resetButton = document.createElement("button")
        resetButton.classList.add("reset-button")
        document.getElementById("navbarToggler").appendChild(resetButton)
        resetButton.appendChild(document.createTextNode('Reset Visualization'));
        resetButton.onclick = () => {
            this.resetToDefault();
        }            
    }    

    setToCenterNode(){
        let center = this.nodes[this.center_node].complex;
        this.reposition(center);
    }

    interact(){
        this.addPan();
        this.addDblClick();
        this.addZoom();
        // this.addResetButton();
        if(this.center_node !== null){
            this.setToCenterNode();
        }
    }

    highlight_question(id_list) {
        this.hoverNodes = id_list;
        this.draw();
    }    

    resetToDefault(){
        this.curScale = {"a": 1, "b": 0, "c": 0, "d": 1, "e": 0, "f": 0};
        this.process();
        this.draw();

        if(this.center_node){
            this.setToCenterNode();
        }        

        this.appendInteraction("reset");
    }
}