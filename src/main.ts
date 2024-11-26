// @deno-types="npm:@types/leaflet@^1.9.14"
import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css";
import "./style.css";

// Deterministic random number generator
import luck from "./luck.ts";

// Location of our classroom (as identified on Google Maps)
const OAKES_CLASSROOM = leaflet.latLng(36.989, -122.062);

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.02;
const MAX_COINS_PER_CACHE = 3;
const MOVEMENT_STEP = TILE_DEGREES;
const MAX_VISIBLE_DISTANCE = 0.001; // Max distance in degrees (~111m per 0.001 latitude)

// Flyweight pattern for managing game cells
const cellCache: Record<string, { i: number; j: number }> = {};

function getCell(i: number, j: number) {
  const key = `${i},${j}`;
  if (!(key in cellCache)) {
    cellCache[key] = { i, j };
  }
  return cellCache[key];
}

// Create the map (element with id "map" is defined in index.html)
const map = leaflet.map(document.getElementById("map")!, {
  center: OAKES_CLASSROOM,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: false,
});

// Populate the map with background tile layer
leaflet
  .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  })
  .addTo(map);

// Add a marker to represent the player
const playerMarker = leaflet.marker(OAKES_CLASSROOM, { draggable: true });
playerMarker.bindTooltip("That's you!");
playerMarker.addTo(map);

// Display the player's inventory
const playerInventory: Record<string, number> = {};
const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;
statusPanel.innerHTML = "Player Inventory: None";

// Add a polyline to track player movement history
const movementPolyline = leaflet.polyline([], { color: "red" }).addTo(map);

// Function to update the player's movement history
function updateMovementHistory(lat: number, lng: number) {
  const currentLatLng = leaflet.latLng(lat, lng);
  movementPolyline.addLatLng(currentLatLng);
}

// Memento interface and Cache class
interface Memento<T> {
  toMemento(): T;
  fromMemento(memento: T): void;
}

class Cache implements Memento<string> {
  coins: string[];
  marker: leaflet.Marker | null;

  constructor(coins: string[] = [], lat: number, lng: number) {
    this.coins = coins;
    this.marker = leaflet.marker([lat, lng]); // Create a marker for the cache
  }

  toMemento(): string {
    return JSON.stringify({ coins: this.coins });
  }

  fromMemento(memento: string): void {
    const state = JSON.parse(memento);
    this.coins = state.coins;
  }

  bindPopup() {
    if (this.marker) {
      this.marker.bindPopup(() => {
        const popupDiv = document.createElement("div");
        popupDiv.innerHTML = `
          <div>Cache Inventory:</div>
          <ul id="coin-list">
            ${
          this.coins
            .map(
              (coinId) =>
                `<li>${coinId} <button data-coin-id="${coinId}" class="collect-button">collect</button></li>`,
            )
            .join("")
        }
          </ul>
          <button id="deposit">Deposit</button>
          <div>Cache Location: (${
          this.marker?.getLatLng().lat.toFixed(5) ?? "Unknown"
        }, ${this.marker?.getLatLng().lng.toFixed(5) ?? "Unknown"})</div>`;

        popupDiv.querySelectorAll<HTMLButtonElement>(".collect-button").forEach(
          (button) => {
            button.addEventListener("click", () => {
              const coinId = button.getAttribute("data-coin-id");
              if (coinId) {
                this.coins = this.coins.filter((id) => id !== coinId);
                playerInventory[coinId] = (playerInventory[coinId] || 0) + 1;
                updateStatusPanel();
                button.parentElement!.remove();
              }
            });
          },
        );

        popupDiv
          .querySelector<HTMLButtonElement>("#deposit")!
          .addEventListener("click", () => {
            const coinKeys = Object.keys(playerInventory);
            if (coinKeys.length > 0) {
              const depositCoinId = coinKeys[0];
              delete playerInventory[depositCoinId];
              this.coins.push(depositCoinId);
              updateStatusPanel();
              const coinList = popupDiv.querySelector("#coin-list")!;
              const newCoinItem = document.createElement("li");
              newCoinItem.innerHTML =
                `${depositCoinId} <button data-coin-id="${depositCoinId}" class="collect-button">collect</button>`;
              coinList.appendChild(newCoinItem);

              newCoinItem.querySelector<HTMLButtonElement>(".collect-button")!
                .addEventListener("click", () => {
                  if (this.coins.indexOf(depositCoinId) !== -1) {
                    this.coins = this.coins.filter((id) =>
                      id !== depositCoinId
                    );
                    playerInventory[depositCoinId] =
                      (playerInventory[depositCoinId] || 0) + 1;
                    updateStatusPanel();
                    newCoinItem.remove();
                  }
                });
            }
          });

        return popupDiv;
      });
    }
  }
}

// Global cache storage
const cacheStorage: Record<string, Cache> = {};

// Utility function to round numbers to a fixed decimal places
function roundToDecimals(num: number, decimals: number = 5): number {
  return parseFloat(num.toFixed(decimals));
}

// Add caches to the map by cell numbers
function spawnCache(i: number, j: number) {
  const cell = getCell(i, j);
  const cacheKey = `${cell.i},${cell.j}`;

  if (!cacheStorage[cacheKey]) {
    const coinCount = Math.min(
      Math.floor(
        luck([cell.i, cell.j, "initialValue"].toString()) * MAX_COINS_PER_CACHE,
      ) + 1,
      MAX_COINS_PER_CACHE,
    );
    const coins = Array.from(
      { length: coinCount },
      (_, index) =>
        `coin_${
          roundToDecimals(
            OAKES_CLASSROOM.lat + cell.i * TILE_DEGREES,
          )
        },${
          roundToDecimals(
            OAKES_CLASSROOM.lng + cell.j * TILE_DEGREES,
          )
        } #${index}`,
    );

    const lat = OAKES_CLASSROOM.lat + cell.i * TILE_DEGREES;
    const lng = OAKES_CLASSROOM.lng + cell.j * TILE_DEGREES;
    cacheStorage[cacheKey] = new Cache(coins, lat, lng);
  }

  const cache = cacheStorage[cacheKey];

  if (!cache.marker) {
    cache.marker = leaflet.marker([
      OAKES_CLASSROOM.lat + cell.i * TILE_DEGREES,
      OAKES_CLASSROOM.lng + cell.j * TILE_DEGREES,
    ]);
    cache.marker.addTo(map);
    cache.bindPopup();
  }
}

// Update cache visibility based on player's position
function updateCacheVisibility(playerLat: number, playerLng: number) {
  Object.keys(cacheStorage).forEach((key) => {
    const [i, j] = key.split(",").map(Number);
    const cache = cacheStorage[key];

    const cacheLat = OAKES_CLASSROOM.lat + i * TILE_DEGREES;
    const cacheLng = OAKES_CLASSROOM.lng + j * TILE_DEGREES;
    const distance = Math.sqrt(
      Math.pow(playerLat - cacheLat, 2) + Math.pow(playerLng - cacheLng, 2),
    );

    if (distance <= MAX_VISIBLE_DISTANCE) {
      if (!map.hasLayer(cache.marker!)) {
        cache.marker!.addTo(map);
        cache.bindPopup();
      }
    } else {
      if (map.hasLayer(cache.marker!)) {
        map.removeLayer(cache.marker!);
      }
    }
  });
}

// Track the player's last cell position
let lastPlayerCell = { i: 0, j: 0 };

// Function to determine the current cell based on the player's location
function getPlayerCell(lat: number, lng: number) {
  const i = Math.floor((lat - OAKES_CLASSROOM.lat) / TILE_DEGREES);
  const j = Math.floor((lng - OAKES_CLASSROOM.lng) / TILE_DEGREES);
  return { i, j };
}

// Regenerate caches and update visibility around the player's new position
function regenerateCachesAroundPlayer(lat: number, lng: number) {
  const { i: playerI, j: playerJ } = getPlayerCell(lat, lng);

  for (
    let i = playerI - NEIGHBORHOOD_SIZE;
    i <= playerI + NEIGHBORHOOD_SIZE;
    i++
  ) {
    for (
      let j = playerJ - NEIGHBORHOOD_SIZE;
      j <= playerJ + NEIGHBORHOOD_SIZE;
      j++
    ) {
      const cacheKey = `${i},${j}`;
      if (cacheStorage[cacheKey]) {
        spawnCache(i, j);
      } else if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
        spawnCache(i, j);
      }
    }
  }

  updateCacheVisibility(lat, lng);
}

// Function to move the player and handle game updates
function movePlayer(direction: string) {
  let newLat = playerMarker.getLatLng().lat;
  let newLng = playerMarker.getLatLng().lng;

  switch (direction) {
    case "up":
      newLat += MOVEMENT_STEP;
      break;
    case "down":
      newLat -= MOVEMENT_STEP;
      break;
    case "left":
      newLng -= MOVEMENT_STEP;
      break;
    case "right":
      newLng += MOVEMENT_STEP;
      break;
  }

  const newPosition = leaflet.latLng(newLat, newLng);
  playerMarker.setLatLng(newPosition);
  map.panTo(newPosition);

  const newPlayerCell = getPlayerCell(newLat, newLng);
  if (
    newPlayerCell.i !== lastPlayerCell.i ||
    newPlayerCell.j !== lastPlayerCell.j
  ) {
    regenerateCachesAroundPlayer(newLat, newLng);
    lastPlayerCell = newPlayerCell;
  }

  updateCacheVisibility(newLat, newLng);
  updateMovementHistory(newLat, newLng);
  saveGameState();

  statusPanel.innerHTML = `Player moved to: ${newLat.toFixed(5)}, ${
    newLng.toFixed(5)
  }`;
}

// Event listeners for directional movement buttons
document.getElementById("north")!.addEventListener(
  "click",
  () => movePlayer("up"),
);
document.getElementById("south")!.addEventListener(
  "click",
  () => movePlayer("down"),
);
document.getElementById("west")!.addEventListener(
  "click",
  () => movePlayer("left"),
);
document.getElementById("east")!.addEventListener(
  "click",
  () => movePlayer("right"),
);

// Add keyboard event listener for arrow keys
document.addEventListener("keydown", (event) => {
  switch (event.key) {
    case "ArrowUp":
      movePlayer("up");
      break;
    case "ArrowDown":
      movePlayer("down");
      break;
    case "ArrowLeft":
      movePlayer("left");
      break;
    case "ArrowRight":
      movePlayer("right");
      break;
  }
});

// Event listener for reset button
document.getElementById("reset")!.addEventListener("click", () => {
  const confirmed = confirm("Are you sure you want to reset the game state?");
  if (confirmed) {
    localStorage.clear();
    Object.keys(playerInventory).forEach((key) => delete playerInventory[key]);
    movementPolyline.setLatLngs([]);
    updateStatusPanel();
    map.setView(OAKES_CLASSROOM, GAMEPLAY_ZOOM_LEVEL);
    playerMarker.setLatLng(OAKES_CLASSROOM);
    lastPlayerCell = { i: 0, j: 0 };
    regenerateCachesAroundPlayer(OAKES_CLASSROOM.lat, OAKES_CLASSROOM.lng);
  }
});

// Geolocation activation via 🌐 button
document.getElementById("sensor")!.addEventListener("click", () => {
  if (navigator.geolocation) {
    navigator.geolocation.watchPosition((position) => {
      const { latitude, longitude } = position.coords;
      const newPosition = leaflet.latLng(latitude, longitude);
      playerMarker.setLatLng(newPosition);
      map.panTo(newPosition);

      const newPlayerCell = getPlayerCell(latitude, longitude);
      if (
        newPlayerCell.i !== lastPlayerCell.i ||
        newPlayerCell.j !== lastPlayerCell.j
      ) {
        regenerateCachesAroundPlayer(latitude, longitude);
        lastPlayerCell = newPlayerCell;
      }

      updateCacheVisibility(latitude, longitude);
      updateMovementHistory(latitude, longitude);
      saveGameState();
    });
  } else {
    alert("Geolocation is not supported by this browser.");
  }
});

// Function to update the status panel
function updateStatusPanel() {
  const coinKeys = Object.keys(playerInventory);
  statusPanel.innerHTML = coinKeys.length > 0
    ? `Player Inventory: ${coinKeys.join(", ")}`
    : "Player Inventory: None";
}

// Save game state to local storage
function saveGameState() {
  const state = {
    playerPosition: playerMarker.getLatLng(),
    playerInventory,
    movementHistory: movementPolyline.getLatLngs(),
  };
  localStorage.setItem("gameState", JSON.stringify(state));
}

type LatLng = { lat: number; lng: number };

// Load game state from local storage
function loadGameState() {
  const savedState = localStorage.getItem("gameState");
  if (savedState) {
    const state = JSON.parse(savedState) as {
      playerPosition: { lat: number; lng: number };
      playerInventory: Record<string, number>;
      movementHistory: LatLng[];
    };
    const { lat, lng } = state.playerPosition;
    playerMarker.setLatLng(leaflet.latLng(lat, lng));
    map.panTo(leaflet.latLng(lat, lng));
    Object.assign(playerInventory, state.playerInventory);
    movementPolyline.setLatLngs(
      state.movementHistory.map((pos) => leaflet.latLng(pos.lat, pos.lng)),
    );
    updateStatusPanel();
    regenerateCachesAroundPlayer(lat, lng);
  }
}

// Load game state on startup
loadGameState();
