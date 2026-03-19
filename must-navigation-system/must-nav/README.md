# CITT Building Navigation System

**Centre for Innovation and Technology Transfer**  
**Mbeya University of Science and Technology (MUST), Tanzania**

---

## Overview

A minimalistic indoor navigation prototype for the CITT building at MUST, built with Python (Flask) and modern web technologies. The system provides an interactive 2D floor map with BFS-powered pathfinding between any two rooms across all  floors.

---

## Features

- Interactive 2D SVG floor maps (Ground Floor + Upper Floor)
- Room click → tooltip with room info, features, accessibility
- BFS (Breadth-First Search) navigation between any two rooms
- Cross-floor navigation via staircase
- Animated path overlay 
- Room search and filtering
- Zoom + pan controls
- Blueprint aesthetic inspired by MUST's academic/technical identity
- Mobile-responsive layout
- REST API for programmatic navigation queries

---

## Project Structure

```
must-navigation-system/
│
├── app.py                        # Flask backend + BFS API
├── requirements.txt              # Python dependencies
│
├── data/
│   └── building_layout.json      # Full building data (rooms, nav graph)
│
├── templates/
│   └── index.html                # Main HTML interface
│
├── static/
│   ├── css/
│   │   └── style.css             # Blueprint dark aesthetic
│   ├── js/
│   │   └── navigation.js         # SVG renderer + BFS + UI controller
│   └── maps/
│       ├── ground_floor.svg      # Static reference map (Ground)
│       └── upper_floor.svg       # Static reference map (Upper)
│
└── README.md
```

---

## Quick Start

### 1. Install dependencies

```bash
pip install flask
```

Or use the requirements file:
```bash
pip install -r requirements.txt
```

### 2. Run the server

```bash
python app.py
```

### 3. Open in browser

```
http://localhost:5000
```

---

## API Reference

### `GET /api/building`
Returns the complete building layout and navigation graph as JSON.

### `GET /api/rooms?floor=ground`
Lists all rooms. Optionally filter by `floor=ground` or `floor=upper`.

### `GET /api/room/<ROOM_ID>`
Returns details for a specific room (e.g. `/api/room/U01`).

### `GET /api/navigate?from=G01&to=U02`
Returns the BFS navigation path from one room to another.

**Example Response:**
```json
{
  "from": "G01",
  "to": "U02",
  "from_name": "Administrative Office",
  "to_name": "Incubation Hub A",
  "path": ["GN_HC_L", "GN_HC_C", "GN_HC_MR", "GN_HC_R", "GN_STAIR", "UN_STAIR", "UN_HC_R", "UN_HC_MR"],
  "ground_path": ["GN_HC_L", "GN_HC_C", "GN_HC_MR", "GN_HC_R", "GN_STAIR"],
  "upper_path": ["UN_STAIR", "UN_HC_R", "UN_HC_MR"],
  "floor_changes": [4],
  "instructions": [
    "🚶 Start at Administrative Office",
    "📶 Take stairs to Upper Floor",
    "🏁 Arrive at Incubation Hub A"
  ]
}
```

### `GET /api/search?q=lab`
Full-text search across room names, types, descriptions, and features.

---

## Navigation Algorithm

The system uses **Breadth-First Search (BFS)** on a weighted navigation graph.

### Graph Structure

Nodes represent waypoints in corridors and staircase landings:

| Node       | Description                        |
|------------|------------------------------------|
| GN_ENTRY   | Main entrance / reception foyer    |
| GN_VC_MID  | Vertical foyer midpoint            |
| GN_HC_C    | Central horizontal corridor        |
| GN_HC_L/ML/MR/R | Corridor waypoints (Ground)  |
| GN_STAIR   | Staircase node (Ground Floor)      |
| UN_STAIR   | Staircase node (Upper Floor)       |
| UN_HC_L/C/MR/R | Corridor waypoints (Upper)   |

The edge `["GN_STAIR", "UN_STAIR", "floor_change"]` represents the staircase connecting both floors.

### Path Finding

1. Rooms are mapped to their nearest corridor node via `room_nodes` in the JSON.
2. BFS traverses the undirected graph to find the shortest node-hop path.
3. The JavaScript client also implements BFS for instant real-time feedback.
4. The result is split per-floor and rendered as an animated polyline on the SVG.

---

## Building Layout

### Ground Floor

| Room ID | Name                     | Type         |
|---------|--------------------------|--------------|
| FOYER   | Reception & Entrance     | foyer        |
| G01     | Administrative Office    | office       |
| G02     | Director's Office        | office       |
| G03     | Seminar Hall             | conference   |
| G04     | Staircase                | staircase    |
| G05     | Documentation & Resources| office       |
| G06     | Meeting Room 1           | meeting_room |
| G07     | Meeting Room 2           | meeting_room |
| G08     | Restrooms                | toilet       |

### Upper Floor

| Room ID | Name                     | Type         |
|---------|--------------------------|--------------|
| U01     | Innovation Lab           | lab          |
| U02     | Incubation Hub A         | incubation   |
| U03     | Staircase                | staircase    |
| U04     | Prototype Workshop       | lab          |
| U05     | Collaboration Studio     | meeting_room |
| U06     | Incubation Hub B         | incubation   |
| U07     | Server & IT Infrastructure| server      |

---

## Extending the System

### Adding a new room

1. Add a room entry in `data/building_layout.json` under the correct floor.
2. Add its nav node connection to `nav_graph.room_nodes`.
3. Add any additional waypoint nodes to `nav_graph.nodes` if needed.
4. Add edges to `nav_graph.edges`.

### Adding a third floor

1. Add a `"level2"` floor in the JSON.
2. Add staircase nodes (e.g. `L2_STAIR`) connected to the upper floor staircase.
3. The floor-switch UI automatically adds a new button for each floor key.

### Future Enhancements

- QR code room labels (generate per-room QR codes linking to `/api/room/<ID>`)
- Real-time occupancy (WebSocket + PIR sensors)
- Mobile PWA with offline map support
- Campus-wide navigation (extend nav graph to multiple buildings)
- Accessibility routing (prefer accessible paths for mobility-impaired users)

---

## Tech Stack

| Layer    | Technology          |
|----------|---------------------|
| Backend  | Python 3.10+, Flask |
| Frontend | Vanilla HTML/CSS/JS |
| Maps     | Inline SVG (dynamic JS rendering) |
| Data     | JSON (building_layout.json) |
| Algorithm| BFS (Python + JS)   |
| Fonts    | IBM Plex Mono, IBM Plex Sans, Rajdhani (Google Fonts) |

---

## License

Educational prototype for MUST / CITT. Not for commercial deployment.
