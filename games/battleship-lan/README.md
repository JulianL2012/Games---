# 🚢 Battleship — LAN Multiplayer

Play **Battleship** over a local network (Wi-Fi / LAN) with a friend using a Node.js WebSocket server.

---

## Requirements

- **Node.js 14+** (download from [nodejs.org](https://nodejs.org))
- Both players on the **same Wi-Fi or LAN network**

---

## Quick Start

```bash
# 1. Navigate to this folder
cd games/battleship-lan

# 2. Install dependencies (first time only)
npm install

# 3. Start the server
npm start
```

The server prints something like:

```
🚢  Battleship LAN Server running!

  Local:   http://localhost:3000
  Network: http://192.168.1.42:3000
```

---

## How to Play

1. **Player 1 (host)** starts the server and opens the **Network** URL in their browser.
2. **Player 2** opens the **same Network URL** on their computer/phone on the same Wi-Fi.
3. Both players type the **same Room Code** (e.g. `SHARK`) and click **Connect & Join**.
4. Each player places their ships privately.
5. Click the enemy grid to fire — the server enforces turns and detects sunk ships.

### Custom port

```bash
node server.js 8080
```

---

## Notes

- No internet connection required — everything runs locally.
- The server only relays moves; it does **not** reveal ship positions to the opponent.
- All offline games in this repo continue to work without this server.

---

## License

MIT
