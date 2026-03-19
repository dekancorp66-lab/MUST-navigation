"""
CITT Building Navigation System
Mbeya University of Science and Technology (MUST)
Backend: Python/Flask
"""

from flask import Flask, render_template, jsonify, request, send_from_directory
import json
import os
from collections import deque

app = Flask(__name__)

# ─── Load building data ───────────────────────────────────────────────────────

DATA_PATH = os.path.join(os.path.dirname(__file__), 'data', 'building_layout.json')

with open(DATA_PATH, 'r', encoding='utf-8') as f:
    BUILDING_DATA = json.load(f)

# ─── Pre-build adjacency list ─────────────────────────────────────────────────

def build_adjacency(nav_graph: dict) -> dict:
    """Build undirected adjacency list from edge list."""
    adj = {node_id: [] for node_id in nav_graph['nodes']}
    for edge in nav_graph['edges']:
        a, b = edge[0], edge[1]
        floor_change = len(edge) > 2 and edge[2] == 'floor_change'
        adj[a].append({'to': b, 'floor_change': floor_change})
        adj[b].append({'to': a, 'floor_change': floor_change})
    return adj


ADJ = build_adjacency(BUILDING_DATA['nav_graph'])

# ─── Helpers ──────────────────────────────────────────────────────────────────

def get_all_rooms() -> dict:
    """Return flat dict of room_id → room data."""
    rooms = {}
    for floor_data in BUILDING_DATA['floors'].values():
        for room in floor_data['rooms']:
            rooms[room['id']] = room
    return rooms


ALL_ROOMS = get_all_rooms()


def bfs(start_node: str, end_node: str) -> list | None:
    """BFS across the nav graph. Returns list of node IDs or None."""
    if start_node == end_node:
        return [start_node]

    queue = deque([[start_node]])
    visited = {start_node}

    while queue:
        path = queue.popleft()
        current = path[-1]

        for edge in ADJ.get(current, []):
            neighbor = edge['to']
            if neighbor == end_node:
                return path + [neighbor]
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(path + [neighbor])

    return None


def generate_instructions(path: list) -> list[str]:
    """Convert raw node path into human-readable navigation steps."""
    nodes = BUILDING_DATA['nav_graph']['nodes']
    steps = []

    for i in range(1, len(path)):
        a_node = nodes[path[i - 1]]
        b_node = nodes[path[i]]
        if a_node['floor'] != b_node['floor']:
            direction = 'Upper' if b_node['floor'] == 'upper' else 'Ground'
            steps.append(f"📶  Take the staircase to the {direction} Floor")

    return steps

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/building')
def api_building():
    """Full building data for client-side rendering."""
    return jsonify(BUILDING_DATA)


@app.route('/api/rooms')
def api_rooms():
    """List of all rooms with optional floor filter."""
    floor_filter = request.args.get('floor')
    rooms = list(ALL_ROOMS.values())
    if floor_filter:
        rooms = [r for r in rooms if r.get('floor') == floor_filter]
    return jsonify(rooms)


@app.route('/api/room/<room_id>')
def api_room(room_id: str):
    """Single room details."""
    room = ALL_ROOMS.get(room_id.upper())
    if not room:
        return jsonify({'error': f'Room {room_id} not found'}), 404
    return jsonify(room)


@app.route('/api/navigate')
def api_navigate():
    """
    BFS navigation between two rooms.
    Query params: from=ROOM_ID&to=ROOM_ID
    Returns path node IDs, node coordinates, floor changes, and instructions.
    """
    from_id = request.args.get('from', '').upper()
    to_id   = request.args.get('to',   '').upper()

    if not from_id or not to_id:
        return jsonify({'error': 'Both "from" and "to" parameters are required.'}), 400

    room_nodes = BUILDING_DATA['nav_graph']['room_nodes']
    nodes      = BUILDING_DATA['nav_graph']['nodes']

    start_node = room_nodes.get(from_id)
    end_node   = room_nodes.get(to_id)

    if not start_node:
        return jsonify({'error': f'Room "{from_id}" not found in navigation graph.'}), 404
    if not end_node:
        return jsonify({'error': f'Room "{to_id}" not found in navigation graph.'}), 404

    path = bfs(start_node, end_node)

    if path is None:
        return jsonify({'error': 'No navigable path found between these rooms.'}), 404

    # Identify floor-change indices
    floor_changes = []
    for i in range(len(path) - 1):
        if nodes[path[i]]['floor'] != nodes[path[i + 1]]['floor']:
            floor_changes.append(i)

    # Build path by floor for rendering
    ground_path = [n for n in path if nodes[n]['floor'] == 'ground']
    upper_path  = [n for n in path if nodes[n]['floor'] == 'upper']

    from_room = ALL_ROOMS.get(from_id, {})
    to_room   = ALL_ROOMS.get(to_id, {})

    instructions = [f"🚶 Start at {from_room.get('name', from_id)}"]
    instructions += generate_instructions(path)
    instructions += [f"🏁 Arrive at {to_room.get('name', to_id)}"]

    return jsonify({
        'from':         from_id,
        'to':           to_id,
        'from_name':    from_room.get('name', from_id),
        'to_name':      to_room.get('name', to_id),
        'path':         path,
        'path_nodes':   {n: nodes[n] for n in path},
        'ground_path':  ground_path,
        'upper_path':   upper_path,
        'floor_changes': floor_changes,
        'instructions': instructions,
        'total_nodes':  len(path)
    })


@app.route('/api/search')
def api_search():
    """Search rooms by name or type."""
    query = request.args.get('q', '').lower().strip()
    if not query:
        return jsonify(list(ALL_ROOMS.values()))

    results = [
        r for r in ALL_ROOMS.values()
        if query in r['name'].lower()
        or query in r.get('type', '').lower()
        or query in r.get('description', '').lower()
        or any(query in f.lower() for f in r.get('features', []))
    ]
    return jsonify(results)


# ─── Run ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    print("=" * 60)
    print("  CITT Building Navigation System")
    print("  Mbeya University of Science and Technology")
    print("=" * 60)
    print("  → http://localhost:5000")
    print()
    app.run(debug=True, port=5000, host='0.0.0.0')
