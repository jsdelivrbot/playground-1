import createGraph from 'ngraph.graph';
import { aStar } from 'ngraph.path';
import getXY from './getXY';

import simplifyPointsPath from './simplify';
import createBlockPlacement from './blockPlacement';
import getBBoxAndRects from './getBBoxAndRects';

var CELL_WIDTH = 10;

export default function fieldRoads(graph, layout) {
  let {bbox} = getBBoxAndRects(graph, layout);
  var width = bbox.width;
  var height = bbox.height;
  var largestCost = Number.NEGATIVE_INFINITY;
  var gridGraph = makeGridGraph(layout);
  var pathMemory = createPathMemory();

  var pathFinder = aStar(gridGraph, {
    distance(fromNode, toNode, link) {
      var seenCount = pathMemory.getSeenCount(fromNode, toNode);
      var lengthReducer = seenCount === 0 ? 1 : (Math.exp(-0.8 * seenCount + Math.log(1 - 0.5)) + 0.5)
      var fromPos = fromNode.data;
      var toPos = toNode.data;
      var dist = aStar.l2(fromPos, toPos)
      return link.data.cost * dist * lengthReducer;
    },
    heuristic(from, to) {
      // let fromPos = from.data;
      // let toPos = to.data;
      //var r = largestCost * gridGraph.getLinksCount();
      return 0; //npath.aStar.l2(fromPos, toPos) * Math.exp(-0.001 * r * r) ;
    }
  });

  var route = runRouting(layout, graph);
  return {
    lines: route.edges,
    nodes: route.nodes
  }

  function runRouting(layout, graph) {
    var linksCount = graph.getLinksCount();
    var processed = 0;
    graph.forEachLink(link => {
      console.log('Processing link #' + processed + ' out of ' + linksCount);
      processed += 1;
      var fromPos = layout.getNodePosition(link.fromId);
      var toPos = layout.getNodePosition(link.toId);
      var gridFrom = getGridNode(fromPos);
      var gridTo = getGridNode(toPos);

      let npath = pathFinder.find(gridFrom, gridTo);
      pathMemory.rememberPath(npath, graph.getNode(link.toId), graph.getNode(link.fromId));
    });

    return saveRoutes();
  }

  function getGridNode(pos) {
    var xr = (pos.x - bbox.left)/width;
    var yr = (pos.y - bbox.top)/height;

    var xCellCount = width/CELL_WIDTH;
    var yCellCount = height/CELL_WIDTH;

    var col = Math.floor(xCellCount * xr);
    var row = Math.floor(yCellCount * yr);

    return getGridNodeKey(col, row);
  }

  function saveRoutes() {
    var edges = [], nodes = [];

    pathMemory.simplify();

    pathMemory.forEachEdge(v => {
      var from = v.fromId.split(',').map(v => Number.parseFloat(v));
      var to = v.toId.split(',').map(v => Number.parseFloat(v));
      var lineWidth = pathMemory.getEdgeWidth(v);
      edges.push({ 
        from: {
          x: from[0] * CELL_WIDTH + bbox.left,
          y: from[1] * CELL_WIDTH + bbox.top
        }, 
        to: {
          x: to[0] * CELL_WIDTH + bbox.left,
          y: to[1] * CELL_WIDTH + bbox.top
        },
        width: lineWidth
      });
    });

    // This will move nodes of original graph out from the road network
    pathMemory.moveRootsOut();

    pathMemory.forEachRoot(root => {
      var pos = root.pos;
      nodes.push({
        id: root.id,
        x: pos.center.x + bbox.left,
        y: pos.center.y + bbox.top,
        angle: pos.angle
      });
      //ctx.fillText(root.id, pos.center.x, pos.center.y)
    });


    return {edges, nodes};
  }


  function makeGridGraph(layout) {
    var gridGraph = createGraph();

    var cellsX = width/CELL_WIDTH;
    var cellsY = height/CELL_WIDTH;

    var maxVx = Number.NEGATIVE_INFINITY;
    var maxVy = Number.NEGATIVE_INFINITY;
    var minVx = Number.POSITIVE_INFINITY;
    var minVy = Number.POSITIVE_INFINITY;
    var maxV = 0;
    for (var col = 0; col < cellsX; col += 1) {
      for (var row = 0; row < cellsY; row += 1) {
        var x = (col * CELL_WIDTH + bbox.left);
        var y = (row * CELL_WIDTH + bbox.top);

        var v = getVelocity(x, y, layout);
        if (minVx > v.x) minVx = v.x; if (maxVx < v.x) maxVx = v.x;
        if (minVy > v.y) minVy = v.y; if (maxVy < v.y) maxVy = v.y;

        var vLength = length(v.x, v.y);
        if (vLength > maxV) maxV = vLength;

        gridGraph.addNode(getGridNodeKey(col, row), {
          vx: (v.x),
          vy: (v.y),
          x: x,
          y: y
        });
      }
    }

    console.log('Max v: ', maxV);

    for (var col = 0; col < cellsX - 1; col += 1) {
      for (var row = 0; row < cellsY - 1; row += 1) {
        var from = (getGridNodeKey(col, row));
        connect(from, getGridNodeKey(col + 1, row));
        connect(from, getGridNodeKey(col, row + 1));
        // var diag = connect(from, getGridNodeKey(col + 1, row + 1));
      }
    }

    return gridGraph;

    function connect(from, to) {
      var fromNode = gridGraph.getNode(from).data;
      var toNode = gridGraph.getNode(to).data;

      var costX = (fromNode.vx + toNode.vx)/(maxV * 2);
      var costY = (fromNode.vy + toNode.vy)/(maxV * 2);

      var cost = Math.sqrt(costX * costX + costY*costY);

      if (cost > largestCost) largestCost = cost;
      return gridGraph.addLink(from, to, {cost});
    }
  }

  function length(x, y) {
    return Math.sqrt(x * x + y * y);
  }
  
  function getVelocity(x, y, layout) {
    var v = getNearestNodeDistance(x, y, layout);
    return {x: v, y: v};
  }

  function getNearestNodeDistance(x, y, layout) {
    // TODO: tree?
    var minL = Number.POSITIVE_INFINITY;
    layout.forEachBody(body => {
      var distToBody = length(body.pos.x - x, body.pos.y - y);
      if (distToBody < minL) {
        minL = distToBody;
      }
    });

    return minL;
  }
}

function getGridNodeKey(col, row) {
  return `${col},${row}`;
}


function createPathMemory() {
  var roots = new Map(); // where the paths start and end.
  var maxSeenValue = 0;
  var pathGraph = createGraph();

  return {
    rememberPath,
    getSeenCount,
    simplify,
    moveRootsOut,
    forEachRoot,
    forEachEdge,
    getGraph: getGraph,
    getEdgeWidth: getEdgeWidth
  }

  function getGraph() {
    return pathGraph;
  }

  function moveRootsOut() {
    var edges = [];
    // max length of an edge segment that can be considered as a snap-candidate
    var snapLength = 32;

    pathGraph.forEachLink(link => {
      var xy1 = getXY(link.fromId);
      var xy2 = getXY(link.toId);
      xy1[0] *= CELL_WIDTH; xy1[1] *= CELL_WIDTH;
      xy2[0] *= CELL_WIDTH; xy2[1] *= CELL_WIDTH;
      var dx = (xy2[0] - xy1[0]);
      var dy = (xy2[1] - xy1[1]);
      var l = Math.sqrt(dx * dx + dy * dy);
      var parts = Math.ceil(l/snapLength)
      var minX = xy1[0], minY = xy1[1];
      var maxX = xy2[0], maxY = xy2[1];

      while (parts > 0) {
        // this will split long lines into smaller lines.
        var maxX = dx < 0 ? 
                    Math.max(minX + snapLength * dx/l, xy2[0]) :
                    Math.min(minX + snapLength * dx/l, xy2[0]);
        var maxY = dy < 0 ? 
                    Math.max(minY + snapLength * dy / l, xy2[1]) :
                    Math.min(minY + snapLength * dy / l, xy2[1]);

        var l0 = Math.sqrt((maxX - minX) * (maxX - minX) + (maxY - minY) * (maxY - minY));
        var rbbox = rotatedBBox({
          minX, minY, maxX, maxY,
          w: getEdgeWidth(link)
        });

        edges.push({
          minX: rbbox.minX, //Math.min(minX, maxX),
          minY: rbbox.minY, //Math.min(minY, maxY),
          maxX: rbbox.maxX, //Math.max(maxX, minX),
          maxY: rbbox.maxY, //Math.max(maxY, minY),
          line: { 
            length: l0, 
            minX, minY, maxX, maxY,
            width: getEdgeWidth(link) 
          }
        });
        minX = maxX; minY = maxY;
        parts -= 1;
      }
    });

    var placement = inplacePlacement(edges); // createBlockPlacement(edges);
    var rootSortedBySize = [];

    forEachRoot(root => { rootSortedBySize.push(root); });

    rootSortedBySize.sort((a, b) => b.size - a.size);
    rootSortedBySize.forEach(root => {
      var pos = getXY(root.internalId);
      pos[0] *= CELL_WIDTH; pos[1] *= CELL_WIDTH;
      placement.place(root, pos);
    });
  }

  function inplacePlacement() {
    return {
      place(node, pos) {
        node.pos = {center: {x: pos[0], y: pos[1]}, angle: 0}
      }
    }
  }

  function forEachRoot(callback) {
    roots.forEach(callback);
  }

  function forEachPathFrom(node, callback) {
    if (!node || !node.links) return;
    var visited = new Set();

    for(var i = 0; i < node.links.length; ++i) {
      var start = node.links[i];
      //if (start.fromId !== node.id) continue;
      var nextNodeId = start.fromId === node.id ? start.toId : start.fromId;

      var path = [];

      var parts = node.id.split(',').map(v => Number.parseFloat(v));
      visited.add(node.id)
      path.push({
        id: node.id,
        x: parts[0],
        y: parts[1],
        weight: start.weight
      });
      do {
        visited.add(nextNodeId);
        parts = nextNodeId.split(',').map(v => Number.parseFloat(v));
        path.push({
          id: nextNodeId,
          x: parts[0],
          y: parts[1],
          weight: start.data
        });

        var toNode = pathGraph.getNode(nextNodeId);
        var links = toNode.links;

        if (toNode.links.length !== 2) break; // No need to traverse further, as this is a crossroad.
        if (toNode.data && toNode.data.node) break; // We hit destination node. Cannot simplify further

        // Now we know we are in the middle of the road, there are no crossroads,
        // and we potentially can remove this node. But where should we go next?

        // We need to pick a link, that we haven't seen yet.
        // One of the link will be the link from where we came.
        if (links[0].fromId === start.fromId && links[0].toId === start.toId) {
          // So we should pick the link that we haven't seen yet.
          start = links[1];
        } else {
          start = links[0];
        }
        // we treat the graph as not oriented, so either toId or fromId should be our
        // target
        nextNodeId = start.fromId === nextNodeId ? start.toId : start.fromId;

        if (visited.has(nextNodeId)) {
          break; // Loop?
        } 
      } while (true);

      callback(path);
    }
  }

  function pointEqual(a, b) {
    return a.x === b.x && a.y === b.y;
  }

  function simplify() {
    console.log('Simplifying graph with ', pathGraph.getLinksCount() + ' edges, ' + pathGraph.getNodesCount() + ' nodes');
    printEdgeStats();
    var totalRemoved = 0;
    for (var factor = 0; factor < 1; ++factor) {
      pathGraph.forEachNode(node => { 
        if (!node) return; // Likely was already simplified.
        forEachPathFrom(node, path => {
          if (path.length < 3) return;

          var simplifiedPath = simplifyPointsPath(path, 3, true);
          var prev = path[0];
          var removedWeight = 0;
          var removed = 0;
          var simplifiedPathIndex = 1; // start from 1 since 0 should be the same as start
          if (!pointEqual(simplifiedPath[0], path[0])) throw new Error('Your expectations are wrong');
          if (!pointEqual(simplifiedPath[simplifiedPath.length - 1], path[path.length - 1])) throw new Error('Your expectations are wrong');

          for (var pathIndex = 1; pathIndex < path.length; ++pathIndex) {
            var originalPoint = path[pathIndex];
            if (pointEqual(simplifiedPath[simplifiedPathIndex], originalPoint)) {
              if (removed > 0) {
                pathGraph.addLink(prev.id, originalPoint.id, removedWeight/removed);
              }
              simplifiedPathIndex += 1;
              prev = originalPoint;
              removedWeight = 0;
              removed = 0;
            } else {
              pathGraph.removeNode(originalPoint.id);
              removed += 1;
              totalRemoved += 1;
              removedWeight += originalPoint.weight;
            }
          }
        });
      });

      printEdgeStats();
    }

    console.log('After simplification: ', pathGraph.getLinksCount() + ' edges, ' + pathGraph.getNodesCount() + ' nodes');
    console.log('Removed nodes: ' + totalRemoved)
  }

  function printEdgeStats() {
    var sum = 0;
    var count = 0;
    var lengths = [];
    pathGraph.forEachLink(link => {
      count += 1;
      var xy1 = getXY(link.fromId);
      var xy2 = getXY(link.toId);
      var dx = (xy1[0] - xy2[0]);
      var dy = (xy1[1] - xy2[1]);
      var l = Math.sqrt(dx * dx + dy * dy);
      lengths.push(l);
      sum += l;
    });
    lengths.sort((x, y) => x - y);
    console.log('avg link length = ' + sum/count);
    console.log('p50: ' + lengths[Math.floor(lengths.length / 2)]);
    console.log('min: ' + lengths[0]);
    console.log('max: ' + lengths[lengths.length - 1]);
    //console.log(lengths.filter(x => x > 1));
  }

  function getEdgeWidth(edge) {
    return Math.round(Math.pow(Math.round(4 * edge.data/maxSeenValue), 1.4)) + 1;
  }

  function forEachEdge(cb) {
    pathGraph.forEachLink(cb);
  }

  function rememberPath(path, startNode, endNode) {
    if (path.length < 1) throw new Error('Empty path?');
    if (path.length === 1) {
      console.warn('Cycles are not supported yet', startNode.id);
      return;
    }

    var from = path[0];
    for (var i = 1; i < path.length; ++i) {
      var to = path[i];
      rememberEdge(from, to);
      from = to;
    }

    // Remember bound nodes.
    var node = pathGraph.getNode(path[0].id);
    node.data = { node: startNode.id }
    roots.set(node.id, {
      internalId: node.id,
      id: startNode.id,
      size: startNode.data.size
    });

    node = pathGraph.getNode(path[path.length - 1].id);
    node.data = { node: endNode.id }
    roots.set(node.id, {
      internalId: node.id,
      id: endNode.id,
      size: endNode.data.size
    });
  }

  function getSeenCount(from, to) {
    //var key = getEdgeKey(from, to);
    var fromId = getFrom(from, to);
    var toId = getTo(from, to);
    var link = pathGraph.getLink(fromId, toId)
    return (link && link.data) || 0;
  }

  function rememberEdge(from, to) {
    //var key = getEdgeKey(from, to);
    var fromId = getFrom(from, to);
    var toId = getTo(from, to);
    var link = pathGraph.getLink(fromId, toId)
    if (!link) {
      link = pathGraph.addLink(fromId, toId, 1);
    } else {
      link.data += 1;
    }
    var seenValue =link.data; // (seenCount.get(key) || 0) + 1;
    if (seenValue > maxSeenValue) maxSeenValue = seenValue;
    //seenCount.set(key, seenValue);
  }

  function getFrom(from, to) {
    return from.id < to.id ? from.id : to.id;
  }

  function getTo(from, to) {
    return from.id < to.id ? to.id : from.id;
  }
}

function rotatedBBox(params) {
  var dx = params.maxX - params.minX;
  var dy = params.maxY - params.minY;
  var w2 = params.w/2;
  var l = Math.sqrt(dx * dx + dy * dy);
  var minX = Number.POSITIVE_INFINITY; var minY = Number.POSITIVE_INFINITY;
  var maxX = Number.NEGATIVE_INFINITY; var maxY = Number.NEGATIVE_INFINITY;
  if (l === 0) {
    // a dot?
    minX = params.minX - w2;
    maxX = params.maxX + w2;
    minY = params.minY - w2;
    maxY = params.maxY + w2;
  } else if (dx === 0) {
    // parallel to Y
    minX = params.minX - w2;
    maxX = params.maxX + w2;
    minY = params.minY;
    maxY = params.maxY;
  } else {
    // regular rectangle
    var points = [];

    var nx = -dy/l; var ny = dx/l;
    points.push({
      x: params.minX + nx * w2,
      y: params.minY + ny * w2,
    }, {
      x: params.minX - nx * w2,
      y: params.minY - ny * w2,
    }, {
      x: params.maxX + nx * w2,
      y: params.maxY + ny * w2,
    }, {
      x: params.maxX - nx * w2,
      y: params.maxY - ny * w2,
    });
    for (var i = 0; i < points.length; ++i) {
      var p = points[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }

  return {
    minX: Math.min(minX, maxX),
    minY: Math.min(minY, maxY),
    maxX: Math.max(maxX, minX),
    maxY: Math.max(maxY, minY),
  }
}
