/**
 * CITT Building Navigation System — navigation.js
 * Mbeya University of Science and Technology
 *
 * Modules:
 *   DataStore    — holds building data
 *   Navigator    — client-side BFS pathfinding
 *   MapRenderer  — draws interactive SVG maps
 *   UI           — manages application state & DOM
 */

'use strict';

// ═══════════════════════════════════════════════════════
//  1. CONSTANTS & HELPERS
// ═══════════════════════════════════════════════════════

const SVG_NS = 'http://www.w3.org/2000/svg';

const ROOM_COLORS = {
  office:      { fill: '#2a80b9', stroke: '#3a9fd4' },
  lab:         { fill: '#7d3c98', stroke: '#a04dcc' },
  meeting_room:{ fill: '#1a6695', stroke: '#2980b9' },
  conference:  { fill: '#1a5276', stroke: '#2471a3' },
  incubation:  { fill: '#1a8f6f', stroke: '#22b08a' },
  foyer:       { fill: '#0e6655', stroke: '#1a8f6f' },
  staircase:   { fill: '#2e4053', stroke: '#4a6278' },
  toilet:      { fill: '#212f3d', stroke: '#34495e' },
  server:      { fill: '#1c2833', stroke: '#2e4053' },
  corridor:    { fill: '#0d1f33', stroke: '#152840' },
  default:     { fill: '#1a2c42', stroke: '#2a4060' },
};

const CORRIDOR_COLOR = { fill: 'rgba(10, 24, 42, 0.9)', stroke: 'rgba(0,140,200,0.12)' };

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function lerp(a, b, t) { return a + (b - a) * t; }

// ═══════════════════════════════════════════════════════
//  2. DATA STORE
// ═══════════════════════════════════════════════════════

const DataStore = {
  building: null,
  floors: {},
  navGraph: {},
  allRooms: {},

  async load() {
    const res  = await fetch('/api/building');
    const data = await res.json();

    this.building  = data.building;
    this.floors    = data.floors;
    this.navGraph  = data.nav_graph;

    // Flatten rooms
    for (const floor of Object.values(data.floors)) {
      for (const room of floor.rooms) {
        this.allRooms[room.id] = room;
      }
    }
    return data;
  },

  getRoomsByFloor(floorId) {
    return (this.floors[floorId]?.rooms) || [];
  },

  getRoom(id) { return this.allRooms[id] || null; },
};

// ═══════════════════════════════════════════════════════
//  3. NAVIGATOR — BFS Pathfinding
// ═══════════════════════════════════════════════════════

const Navigator = {
  adj: {},    // adjacency list

  build(navGraph) {
    this.adj = {};
    const { nodes, edges } = navGraph;
    for (const nodeId of Object.keys(nodes)) {
      this.adj[nodeId] = [];
    }
    for (const edge of edges) {
      const [a, b, meta] = edge;
      const isFloorChange = meta === 'floor_change';
      this.adj[a].push({ to: b, floorChange: isFloorChange });
      this.adj[b].push({ to: a, floorChange: isFloorChange });
    }
  },

  /**
   * BFS from startNode → endNode.
   * Returns array of node IDs, or null if no path.
   */
  bfs(startNode, endNode) {
    if (startNode === endNode) return [startNode];

    const queue   = [[startNode]];
    const visited = new Set([startNode]);

    while (queue.length > 0) {
      const path    = queue.shift();
      const current = path[path.length - 1];

      for (const edge of (this.adj[current] || [])) {
        const { to } = edge;
        if (to === endNode) return [...path, to];
        if (!visited.has(to)) {
          visited.add(to);
          queue.push([...path, to]);
        }
      }
    }
    return null;
  },

  /**
   * Navigate between two ROOMS (not nodes directly).
   * Returns { path, groundPath, upperPath, floorChanges, instructions }
   */
  navigate(fromRoomId, toRoomId) {
    const { room_nodes, nodes } = DataStore.navGraph;

    const startNode = room_nodes[fromRoomId];
    const endNode   = room_nodes[toRoomId];

    if (!startNode || !endNode) return null;

    const path = this.bfs(startNode, endNode);
    if (!path) return null;

    // Split path by floor
    const groundPath = path.filter(n => nodes[n].floor === 'ground');
    const upperPath  = path.filter(n => nodes[n].floor === 'upper');

    // Find floor-change indices
    const floorChanges = [];
    for (let i = 0; i < path.length - 1; i++) {
      if (nodes[path[i]].floor !== nodes[path[i + 1]].floor) {
        floorChanges.push(i);
      }
    }

    // Build instructions
    const fromRoom = DataStore.getRoom(fromRoomId);
    const toRoom   = DataStore.getRoom(toRoomId);
    const instructions = [
      { icon: '🚶', text: `Start at ${fromRoom?.name || fromRoomId}`, type: 'start' },
    ];

    for (let i = 0; i < path.length - 1; i++) {
      const a = nodes[path[i]];
      const b = nodes[path[i + 1]];
      if (a.floor !== b.floor) {
        const dir = b.floor === 'upper' ? 'Upper' : 'Ground';
        instructions.push({ icon: '📶', text: `Take stairs to ${dir} Floor`, type: 'floor_change' });
      }
    }

    instructions.push({ icon: '🏁', text: `Arrive at ${toRoom?.name || toRoomId}`, type: 'end' });

    return { path, groundPath, upperPath, floorChanges, instructions, fromRoomId, toRoomId };
  },
};

// ═══════════════════════════════════════════════════════
//  4. MAP RENDERER
// ═══════════════════════════════════════════════════════

const MapRenderer = {
  svg: null,
  currentFloor: 'ground',
  rooms: {},          // svgEl references, keyed by room id
  pathGroup: null,

  init(svgEl) {
    this.svg = svgEl;
  },

  /**
   * Draw the full floor map.
   */
  drawFloor(floorId) {
    this.currentFloor = floorId;
    this.rooms = {};

    const svg   = this.svg;
    const floor = DataStore.floors[floorId];
    if (!floor) return;

    // Clear existing content
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const vb = floor.svg_viewbox || '0 0 860 560';
    svg.setAttribute('viewBox', vb);
    svg.setAttribute('xmlns', SVG_NS);

    const [, , vbW, vbH] = vb.split(' ').map(Number);

    // ── Defs ───────────────────────────────────────
    const defs = svgEl('defs');

    // Blueprint grid pattern
    const pattern = svgEl('pattern', {
      id: 'grid', width: '20', height: '20',
      patternUnits: 'userSpaceOnUse'
    });
    const ph = svgEl('path', {
      d: 'M 20 0 L 0 0 0 20',
      fill: 'none', stroke: 'rgba(0,140,200,0.07)', 'stroke-width': '0.5'
    });
    pattern.appendChild(ph);
    defs.appendChild(pattern);

    // Room glow filter
    const filter = svgEl('filter', { id: 'room-glow', x: '-20%', y: '-20%', width: '140%', height: '140%' });
    const fgb = svgEl('feGaussianBlur', { stdDeviation: '3', result: 'blur' });
    const fco = svgEl('feComposite',    { in: 'SourceGraphic', in2: 'blur', operator: 'over' });
    filter.appendChild(fgb);
    filter.appendChild(fco);
    defs.appendChild(filter);

    svg.appendChild(defs);

    // ── Background ─────────────────────────────────
    svg.appendChild(svgEl('rect', {
      x: 0, y: 0, width: vbW, height: vbH,
      fill: '#070d19'
    }));

    // Blueprint grid
    svg.appendChild(svgEl('rect', {
      x: 0, y: 0, width: vbW, height: vbH,
      fill: 'url(#grid)'
    }));

    // ── Outer building walls ────────────────────────
    svg.appendChild(svgEl('rect', {
      x: 18, y: 18, width: vbW - 36, height: vbH - 36,
      fill: 'rgba(10,20,40,0.95)',
      stroke: 'rgba(0,160,220,0.5)',
      'stroke-width': '1.5',
      rx: 2
    }));

    // ── Corridor fills ──────────────────────────────
    this._drawCorridors(svg, floorId, vbW, vbH);

    // ── Rooms ───────────────────────────────────────
    const roomsGroup = svgEl('g', { id: 'rooms-group' });
    for (const room of floor.rooms) {
      const g = this._drawRoom(room);
      this.rooms[room.id] = g;
      roomsGroup.appendChild(g);
    }
    svg.appendChild(roomsGroup);

    // ── Floor label ─────────────────────────────────
    const floorLabel = svgEl('text', {
      x: vbW - 24, y: vbH - 12,
      'font-family': 'IBM Plex Mono, monospace',
      'font-size': '9',
      fill: 'rgba(0,160,220,0.3)',
      'text-anchor': 'end',
      'letter-spacing': '2'
    });
    floorLabel.textContent = `MUST · CITT · ${floor.name.toUpperCase()}`;
    svg.appendChild(floorLabel);

    // ── Compass rose (top-right) ──────────────────
    this._drawCompass(svg, vbW - 35, 40);

    // Path group (on top)
    this.pathGroup = svgEl('g', { id: 'path-group' });
    svg.appendChild(this.pathGroup);
  },

  _drawCorridors(svg, floorId, vbW, vbH) {
    const corridors = svgEl('g', { id: 'corridors', opacity: '1' });

    if (floorId === 'ground') {
      // Horizontal corridor
      corridors.appendChild(svgEl('rect', {
        x: 18, y: 210, width: vbW - 36, height: 60,
        fill: 'rgba(0,30,60,0.8)', stroke: 'rgba(0,140,200,0.1)', 'stroke-width': '0.5'
      }));
      // Centre-line
      corridors.appendChild(svgEl('line', {
        x1: 20, y1: 240, x2: vbW - 20, y2: 240,
        stroke: 'rgba(0,180,230,0.07)', 'stroke-width': '1', 'stroke-dasharray': '6 8'
      }));
      // Vertical foyer
      corridors.appendChild(svgEl('rect', {
        x: 385, y: 270, width: 90, height: vbH - 288,
        fill: 'rgba(0,40,70,0.85)', stroke: 'rgba(0,140,200,0.1)', 'stroke-width': '0.5'
      }));
    } else {
      // Upper floor horizontal corridor
      corridors.appendChild(svgEl('rect', {
        x: 18, y: 270, width: vbW - 36, height: 60,
        fill: 'rgba(0,30,60,0.8)', stroke: 'rgba(0,140,200,0.1)', 'stroke-width': '0.5'
      }));
      corridors.appendChild(svgEl('line', {
        x1: 20, y1: 300, x2: vbW - 20, y2: 300,
        stroke: 'rgba(0,180,230,0.07)', 'stroke-width': '1', 'stroke-dasharray': '6 8'
      }));
    }

    svg.appendChild(corridors);
  },

  _drawRoom(room) {
    const colors = ROOM_COLORS[room.type] || ROOM_COLORS.default;
    const g      = svgEl('g', { class: 'svg-room', 'data-id': room.id, 'data-type': room.type });

    // Room fill
    const rect = svgEl('rect', {
      class: 'room-fill',
      x: room.x + 1, y: room.y + 1,
      width:  room.w - 2, height: room.h - 2,
      fill:   colors.fill + '28',
      stroke: colors.stroke,
      'stroke-width': '1',
      rx: 1,
    });
    g.appendChild(rect);

    // Staircase hatch pattern
    if (room.type === 'staircase') {
      this._addStaircaseHatch(g, room, colors);
    }

    // Server room grid
    if (room.type === 'server') {
      this._addServerPattern(g, room, colors);
    }

    // Room label
    const cx = room.x + room.w / 2;
    const cy = room.y + room.h / 2;

    const labelLines = this._wrapText(room.name, Math.floor(room.w / 7));

    for (let i = 0; i < labelLines.length; i++) {
      const dy   = (i - (labelLines.length - 1) / 2) * 13;
      const text = svgEl('text', {
        x: cx, y: cy + dy,
        'font-family': 'IBM Plex Sans, sans-serif',
        'font-size': room.w > 100 ? '11' : '9',
        fill: '#c8dde8',
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'pointer-events': 'none',
      });
      text.textContent = labelLines[i];
      g.appendChild(text);
    }

    // Room ID badge (top-left corner)
    const idBg = svgEl('rect', {
      x: room.x + 3, y: room.y + 3,
      width: 24, height: 11,
      fill: colors.stroke + '33',
      rx: 1,
    });
    const idText = svgEl('text', {
      x: room.x + 15, y: room.y + 9,
      'font-family': 'IBM Plex Mono, monospace',
      'font-size': '7',
      fill: colors.stroke,
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      'pointer-events': 'none',
    });
    idText.textContent = room.id;
    g.appendChild(idBg);
    g.appendChild(idText);

    // Accessibility icon
    if (room.accessible) {
      const aText = svgEl('text', {
        x: room.x + room.w - 6, y: room.y + 10,
        'font-size': '8',
        fill: 'rgba(0,180,150,0.5)',
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'pointer-events': 'none',
      });
      aText.textContent = '♿';
      g.appendChild(aText);
    }

    return g;
  },

  _addStaircaseHatch(g, room, colors) {
    const step = 12;
    for (let x = room.x; x < room.x + room.w; x += step) {
      g.appendChild(svgEl('line', {
        x1: Math.max(x, room.x + 1),
        y1: room.y + 1,
        x2: Math.min(x + room.h, room.x + room.w - 1),
        y2: Math.min(room.y + 1 + (room.x + room.w - x), room.y + room.h - 1),
        stroke: colors.stroke + '18',
        'stroke-width': '1',
      }));
    }
    // Arrow indicating direction
    const arrowX = room.x + room.w / 2;
    const arrowY = room.y + room.h / 2 + 18;
    g.appendChild(svgEl('text', {
      x: arrowX, y: arrowY,
      'font-size': '14', fill: colors.stroke + '66',
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'pointer-events': 'none',
    })).textContent = '↕';
  },

  _addServerPattern(g, room, colors) {
    const rows = Math.floor((room.h - 20) / 14);
    for (let i = 0; i < rows; i++) {
      g.appendChild(svgEl('rect', {
        x: room.x + 10, y: room.y + 20 + i * 14,
        width: room.w - 20, height: 9,
        fill: 'none', stroke: colors.stroke + '22', 'stroke-width': '0.5', rx: 1,
      }));
    }
  },

  _wrapText(text, maxChars) {
    const words = text.split(' ');
    const lines = [];
    let line    = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length <= maxChars) {
        line = (line + ' ' + w).trim();
      } else {
        if (line) lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    return lines;
  },

  _drawCompass(svg, cx, cy) {
    const r = 14;
    svg.appendChild(svgEl('circle', {
      cx, cy, r, fill: 'none', stroke: 'rgba(0,160,220,0.12)', 'stroke-width': '0.8'
    }));
    // N arrow
    const arrow = svgEl('path', {
      d: `M${cx},${cy - r + 3} L${cx - 4},${cy + r - 5} L${cx},${cy - 2} L${cx + 4},${cy + r - 5} Z`,
      fill: 'rgba(0,180,150,0.5)'
    });
    svg.appendChild(arrow);
    const n = svgEl('text', {
      x: cx, y: cy - r - 4, 'font-family': 'IBM Plex Mono', 'font-size': '7',
      fill: 'rgba(0,180,150,0.5)', 'text-anchor': 'middle',
    });
    n.textContent = 'N';
    svg.appendChild(n);
  },

  /**
   * Draw navigation path polyline on the SVG.
   * pathNodes: array of nav_node IDs for the current floor.
   */
  drawPath(pathNodeIds, floorId, fromRoomId, toRoomId) {
    // Clear existing path
    this.clearPath();

    const nodes = DataStore.navGraph.nodes;
    const floorNodes = pathNodeIds.filter(id => nodes[id]?.floor === floorId);

    if (floorNodes.length < 1) return;

    const g = this.pathGroup;

    if (floorNodes.length >= 2) {
      // Build polyline points
      const points = floorNodes.map(id => `${nodes[id].x},${nodes[id].y}`).join(' ');

      // Shadow / glow line
      g.appendChild(svgEl('polyline', {
        points, fill: 'none',
        stroke: 'rgba(255,195,0,0.2)', 'stroke-width': '8',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      }));

      // Animated dashed path
      g.appendChild(svgEl('polyline', {
        class: 'nav-path-line',
        points, fill: 'none',
      }));
    }

    // Draw waypoint dots
    const dotsGroup = svgEl('g', { class: 'nav-path-dots' });
    for (let i = 1; i < floorNodes.length - 1; i++) {
      const n = nodes[floorNodes[i]];
      dotsGroup.appendChild(svgEl('circle', {
        cx: n.x, cy: n.y, r: '3',
        fill: '#ffd166', opacity: '0.6',
      }));
    }
    g.appendChild(dotsGroup);

    // Start marker
    const startNode = nodes[floorNodes[0]];
    const startGroup = svgEl('g', { class: 'nav-path-start' });
    startGroup.appendChild(svgEl('circle', { cx: startNode.x, cy: startNode.y, r: '7', fill: 'rgba(0,201,167,0.2)' }));
    startGroup.appendChild(svgEl('circle', { cx: startNode.x, cy: startNode.y, r: '4', fill: '#00c9a7' }));
    g.appendChild(startGroup);

    // End marker
    const endNode = nodes[floorNodes[floorNodes.length - 1]];
    const endGroup = svgEl('g', { class: 'nav-path-end' });
    endGroup.appendChild(svgEl('circle', { cx: endNode.x, cy: endNode.y, r: '7', fill: 'rgba(255,209,102,0.2)' }));
    endGroup.appendChild(svgEl('circle', { cx: endNode.x, cy: endNode.y, r: '4', fill: '#ffd166' }));
    g.appendChild(endGroup);

    // Highlight rooms on this floor
    const roomNodes = DataStore.navGraph.room_nodes;
    for (const [roomId, navNode] of Object.entries(roomNodes)) {
      const room = DataStore.getRoom(roomId);
      if (!room || room.floor !== floorId) continue;

      if (roomId === fromRoomId) this.setRoomState(roomId, 'source');
      else if (roomId === toRoomId) this.setRoomState(roomId, 'destination');
      else if (floorNodes.includes(navNode)) this.setRoomState(roomId, 'on-path');
    }
  },

  clearPath() {
    if (!this.pathGroup) return;
    while (this.pathGroup.firstChild) this.pathGroup.removeChild(this.pathGroup.firstChild);
    // Remove room state classes
    for (const g of Object.values(this.rooms)) {
      g.classList.remove('is-source', 'is-destination', 'on-path', 'highlighted');
    }
  },

  setRoomState(roomId, state) {
    const g = this.rooms[roomId];
    if (!g) return;
    g.classList.remove('is-source', 'is-destination', 'on-path', 'highlighted');
    if (state === 'source')      g.classList.add('is-source');
    if (state === 'destination') g.classList.add('is-destination');
    if (state === 'on-path')     g.classList.add('on-path');
    if (state === 'highlighted') g.classList.add('highlighted');
  },

  clearRoomStates() {
    for (const g of Object.values(this.rooms)) {
      g.classList.remove('is-source', 'is-destination', 'on-path', 'highlighted');
    }
  },
};

// ═══════════════════════════════════════════════════════
//  5. UI CONTROLLER
// ═══════════════════════════════════════════════════════

const UI = {
  currentFloor: 'ground',
  selectedFrom: null,
  selectedTo:   null,
  currentPath:  null,
  activeRoomId: null,

  zoomLevel: 1,
  panX: 0, panY: 0,
  isDragging: false,
  dragStart: null,

  async init() {
    await DataStore.load();
    Navigator.build(DataStore.navGraph);

    MapRenderer.init(document.getElementById('building-svg'));
    MapRenderer.drawFloor('ground');

    this._populateSidebar('ground');
    this._populateSelects();
    this._bindEvents();
    this._bindRoomHovers();

    // Hide loading
    const overlay = document.getElementById('loading-overlay');
    overlay.classList.add('hidden');
    setTimeout(() => overlay.remove(), 500);
  },

  // ── Sidebar ────────────────────────────────────────

  _populateSidebar(floorId) {
    const list = document.getElementById('room-list');
    list.innerHTML = '';

    const rooms  = DataStore.getRoomsByFloor(floorId);
    const search = document.getElementById('room-search').value.toLowerCase().trim();

    const filtered = rooms.filter(r =>
      !search ||
      r.name.toLowerCase().includes(search) ||
      r.type.toLowerCase().includes(search) ||
      r.id.toLowerCase().includes(search)
    );

    if (filtered.length === 0) {
      list.innerHTML = '<div class="no-results">No rooms match your search.</div>';
      return;
    }

    for (const room of filtered) {
      const colors = ROOM_COLORS[room.type] || ROOM_COLORS.default;
      const item   = document.createElement('div');
      item.className = 'room-item';
      item.dataset.id = room.id;

      if (room.id === this.selectedFrom) item.classList.add('is-source');
      if (room.id === this.selectedTo)   item.classList.add('is-destination');

      item.innerHTML = `
        <span class="room-type-pip" style="background:${colors.stroke}"></span>
        <span class="room-item-name">${room.name}</span>
        <span class="room-item-id mono">${room.id}</span>
      `;

      item.addEventListener('click', () => this._onRoomListClick(room.id));
      list.appendChild(item);
    }
  },

  _populateSelects() {
    const fromSel = document.getElementById('from-select');
    const toSel   = document.getElementById('to-select');

    const allRooms = Object.values(DataStore.allRooms);

    const buildOptions = (sel) => {
      // Keep first option
      while (sel.options.length > 1) sel.remove(1);

      const byFloor = { ground: [], upper: [] };
      for (const r of allRooms) {
        if (byFloor[r.floor]) byFloor[r.floor].push(r);
      }

      for (const [floorId, rooms] of Object.entries(byFloor)) {
        const floorName = DataStore.floors[floorId]?.name || floorId;
        const group     = document.createElement('optgroup');
        group.label     = floorName;
        for (const r of rooms) {
          const opt    = document.createElement('option');
          opt.value    = r.id;
          opt.textContent = `${r.id} — ${r.name}`;
          group.appendChild(opt);
        }
        sel.appendChild(group);
      }
    };

    buildOptions(fromSel);
    buildOptions(toSel);
  },

  // ── Events ─────────────────────────────────────────

  _bindEvents() {
    // Floor tabs (sidebar)
    document.querySelectorAll('.floor-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.floor-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._populateSidebar(btn.dataset.floor);
      });
    });

    // Room search
    document.getElementById('room-search').addEventListener('input', () => {
      const activeTab = document.querySelector('.floor-tab.active');
      this._populateSidebar(activeTab?.dataset.floor || 'ground');
    });

    // Floor switch buttons (map toolbar)
    document.getElementById('btn-floor-ground').addEventListener('click', () => this._switchFloor('ground'));
    document.getElementById('btn-floor-upper').addEventListener('click', () => this._switchFloor('upper'));

    // Navigate
    document.getElementById('find-path-btn').addEventListener('click', () => this._findPath());
    document.getElementById('clear-btn').addEventListener('click', () => this._clearAll());

    // Swap
    document.getElementById('swap-btn').addEventListener('click', () => {
      const a = this.selectedFrom;
      const b = this.selectedTo;
      this.selectedFrom = b;
      this.selectedTo   = a;
      document.getElementById('from-select').value = b || '';
      document.getElementById('to-select').value   = a || '';
      this._updateSidebarStates();
    });

    // Selects
    document.getElementById('from-select').addEventListener('change', e => {
      this.selectedFrom = e.target.value || null;
      this._updateSidebarStates();
      if (this.selectedFrom) this._highlightRoomOnMap(this.selectedFrom);
    });

    document.getElementById('to-select').addEventListener('change', e => {
      this.selectedTo = e.target.value || null;
      this._updateSidebarStates();
      if (this.selectedTo) this._highlightRoomOnMap(this.selectedTo);
    });

    // Map room clicks (delegated)
    document.getElementById('building-svg').addEventListener('click', (e) => {
      const roomEl = e.target.closest('.svg-room');
      if (roomEl) {
        this._showRoomTooltip(roomEl.dataset.id);
      }
    });

    // Tooltip close
    document.getElementById('tooltip-close').addEventListener('click', () => {
      document.getElementById('room-tooltip').style.display = 'none';
    });

    document.getElementById('tooltip-set-from').addEventListener('click', () => {
      if (!this.activeRoomId) return;
      this.selectedFrom = this.activeRoomId;
      document.getElementById('from-select').value = this.activeRoomId;
      document.getElementById('room-tooltip').style.display = 'none';
      this._updateSidebarStates();
      MapRenderer.setRoomState(this.activeRoomId, 'source');
    });

    document.getElementById('tooltip-set-to').addEventListener('click', () => {
      if (!this.activeRoomId) return;
      this.selectedTo = this.activeRoomId;
      document.getElementById('to-select').value = this.activeRoomId;
      document.getElementById('room-tooltip').style.display = 'none';
      this._updateSidebarStates();
      MapRenderer.setRoomState(this.activeRoomId, 'destination');
    });

    // Zoom controls
    document.getElementById('zoom-in').addEventListener('click',    () => this._zoom(1.2));
    document.getElementById('zoom-out').addEventListener('click',   () => this._zoom(1 / 1.2));
    document.getElementById('zoom-reset').addEventListener('click', () => this._zoomReset());

    // Wheel zoom
    const viewport = document.getElementById('map-viewport');
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    // Pan (drag)
    viewport.addEventListener('mousedown', (e) => {
      if (e.target.closest('.svg-room')) return;
      this.isDragging = true;
      this.dragStart  = { x: e.clientX - this.panX, y: e.clientY - this.panY };
      viewport.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      this.panX = e.clientX - this.dragStart.x;
      this.panY = e.clientY - this.dragStart.y;
      this._applyTransform();
    });
    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      document.getElementById('map-viewport').style.cursor = 'grab';
    });
  },

  // ── Floor Switching ────────────────────────────────

  _switchFloor(floorId) {
    if (this.currentFloor === floorId) return;
    this.currentFloor = floorId;

    document.getElementById('btn-floor-ground').classList.toggle('active', floorId === 'ground');
    document.getElementById('btn-floor-upper').classList.toggle('active',  floorId === 'upper');

    MapRenderer.drawFloor(floorId);

    // Re-draw path if active
    if (this.currentPath) {
      const { path, fromRoomId, toRoomId } = this.currentPath;
      MapRenderer.drawPath(path, floorId, fromRoomId, toRoomId);
    }

    this._bindRoomHovers();
  },

  _bindRoomHovers() {
    // Re-bind after redraw
    document.querySelectorAll('.svg-room').forEach(g => {
      g.addEventListener('mouseenter', () => g.classList.add('highlighted'));
      g.addEventListener('mouseleave', () => {
        if (!g.classList.contains('is-source') &&
            !g.classList.contains('is-destination') &&
            !g.classList.contains('on-path')) {
          g.classList.remove('highlighted');
        }
      });
    });
  },

  // ── Room Interaction ───────────────────────────────

  _onRoomListClick(roomId) {
    const room = DataStore.getRoom(roomId);
    if (!room) return;

    // Switch floor if needed
    if (room.floor !== this.currentFloor) {
      this._switchFloor(room.floor);
    }

    this._showRoomTooltip(roomId);
  },

  _highlightRoomOnMap(roomId) {
    const room = DataStore.getRoom(roomId);
    if (!room) return;
    if (room.floor !== this.currentFloor) this._switchFloor(room.floor);
    MapRenderer.clearRoomStates();
    if (this.selectedFrom) MapRenderer.setRoomState(this.selectedFrom, 'source');
    if (this.selectedTo)   MapRenderer.setRoomState(this.selectedTo, 'destination');
  },

  _showRoomTooltip(roomId) {
    const room = DataStore.getRoom(roomId);
    if (!room) return;

    this.activeRoomId = roomId;

    const tooltip = document.getElementById('room-tooltip');
    const colors  = ROOM_COLORS[room.type] || ROOM_COLORS.default;

    document.getElementById('tooltip-type').textContent  = room.type.replace('_', ' ');
    document.getElementById('tooltip-type').style.color  = colors.stroke;
    document.getElementById('tooltip-type').style.borderColor = colors.stroke;
    document.getElementById('tooltip-name').textContent  = room.name;
    document.getElementById('tooltip-desc').textContent  = room.description;

    const feats = document.getElementById('tooltip-features');
    feats.innerHTML = (room.features || [])
      .map(f => `<span class="feature-tag">${f}</span>`)
      .join('');

    tooltip.style.display = 'block';
  },

  // ── Navigation ─────────────────────────────────────

  _findPath() {
    const from = this.selectedFrom;
    const to   = this.selectedTo;

    if (!from || !to) {
      this._showError('Please select both a start room and a destination.');
      return;
    }
    if (from === to) {
      this._showError('Start and destination are the same room!');
      return;
    }

    const result = Navigator.navigate(from, to);

    if (!result) {
      this._showError('No navigable path found between these rooms.');
      return;
    }

    this.currentPath = result;

    // Draw on current floor
    MapRenderer.drawPath(result.path, this.currentFloor, from, to);

    // If path starts on a different floor, auto-switch
    const fromRoom = DataStore.getRoom(from);
    if (fromRoom && fromRoom.floor !== this.currentFloor) {
      this._switchFloor(fromRoom.floor);
    }

    // Show results panel
    this._renderPathResult(result);

    // Update sidebar states
    this._updateSidebarStates();

    // Re-draw path for new floor
    MapRenderer.drawPath(result.path, this.currentFloor, from, to);
    this._bindRoomHovers();
  },

  _renderPathResult(result) {
    const section = document.getElementById('results-section');
    const panel   = document.getElementById('path-result');
    section.style.display = 'block';
    panel.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'path-result-header';
    header.innerHTML = `
      <span class="route-name">${DataStore.getRoom(result.fromRoomId)?.name || result.fromRoomId}</span>
      <span class="route-arrow">→</span>
      <span class="route-name">${DataStore.getRoom(result.toRoomId)?.name || result.toRoomId}</span>
    `;
    panel.appendChild(header);

    // Floor change indicators
    for (const step of result.instructions) {
      const div = document.createElement('div');
      div.className = `path-step${step.type === 'floor_change' ? ' floor-change' : ''}`;
      div.innerHTML = `<span class="path-step-icon">${step.icon}</span><span>${step.text}</span>`;

      if (step.type === 'floor_change') {
        // Clicking floor-change step switches the floor
        const targetFloor = step.text.includes('Upper') ? 'upper' : 'ground';
        div.addEventListener('click', () => this._switchFloor(targetFloor));

        const hint = document.createElement('div');
        hint.className = 'path-floor-indicator';
        hint.innerHTML = `<span>👆</span> <span>Click to view ${step.text.includes('Upper') ? 'Upper' : 'Ground'} Floor path</span>`;
        hint.addEventListener('click', () => this._switchFloor(targetFloor));
        panel.appendChild(div);
        panel.appendChild(hint);
        continue;
      }

      panel.appendChild(div);
    }
  },

  _showError(msg) {
    const section = document.getElementById('results-section');
    const panel   = document.getElementById('path-result');
    section.style.display = 'block';
    panel.innerHTML = `<div style="color:var(--error);font-size:12px;padding:8px 0">⚠ ${msg}</div>`;
  },

  _clearAll() {
    this.selectedFrom = null;
    this.selectedTo   = null;
    this.currentPath  = null;
    this.activeRoomId = null;

    document.getElementById('from-select').value = '';
    document.getElementById('to-select').value   = '';
    document.getElementById('results-section').style.display = 'none';
    document.getElementById('room-tooltip').style.display    = 'none';

    MapRenderer.clearPath();
    MapRenderer.clearRoomStates();
    this._updateSidebarStates();
  },

  _updateSidebarStates() {
    document.querySelectorAll('.room-item').forEach(item => {
      item.classList.remove('is-source', 'is-destination');
      if (item.dataset.id === this.selectedFrom) item.classList.add('is-source');
      if (item.dataset.id === this.selectedTo)   item.classList.add('is-destination');
    });
  },

  // ── Zoom / Pan ─────────────────────────────────────

  _zoom(factor) {
    this.zoomLevel = Math.max(0.4, Math.min(3.5, this.zoomLevel * factor));
    this._applyTransform();
  },

  _zoomReset() {
    this.zoomLevel = 1;
    this.panX = 0;
    this.panY = 0;
    this._applyTransform();
  },

  _applyTransform() {
    const container = document.getElementById('map-container');
    container.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;
  },
};

// ═══════════════════════════════════════════════════════
//  6. BOOT
// ═══════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  UI.init().catch(err => {
    console.error('CITT Navigator failed to initialise:', err);
    document.getElementById('loading-overlay').innerHTML =
      `<div style="color:#ff6b6b;font-family:monospace;text-align:center;padding:24px">
        Failed to load building data.<br>${err.message}
      </div>`;
  });
});
