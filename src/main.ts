// @deno-types="npm:@types/leaflet@^1.9.14"
import leaflet from "leaflet";

// Import the leaflet CSS and local stylesheet
import "leaflet/dist/leaflet.css";
import "./style.css";

// A deterministic random number generator for reproducible results
import luck from "./luck.ts";

// The location of our classroom as identified on Google Maps
const OAKES_CLASSROOM = leaflet.latLng(36.989, -122.062);

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 19; // Fixed zoom level for the map
const TILE_DEGREES = 1e-4; // Each movement step or cache cell size in degrees
const NEIGHBORHOOD_SIZE = 8; // Number of cells around the player to manage
const CACHE_SPAWN_PROBABILITY = 0.02; // Probability of spawning a new cache in a cell
const MAX_COINS_PER_CACHE = 3; // Maximum number of coins per cache
const MOVEMENT_STEP = TILE_DEGREES; // Player movement step in degrees
const MAX_VISIBLE_DISTANCE = 0.001; // Max visibility distance (in degrees) for caches (~111m per 0.001 latitude)

// A cache for cell objects to avoid recreating them
const cellCache: Record<string, { i: number; j: number }> = {};

// Retrieve or create a cell object by its (i, j) coordinates
function getCell(i: number, j: number) {
  const key = `${i},${j}`;
  if (!(key in cellCache)) {
    cellCache[key] = { i, j };
  }
  return cellCache[key];
}

// Create the map centered on the classroom
const map = leaflet.map(document.getElementById("map")!, {
  center: OAKES_CLASSROOM,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: false,
});

// Add a base tile layer from OpenStreetMap
leaflet
  .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  })
  .addTo(map);

// Place a draggable marker to represent the player
const playerMarker = leaflet.marker(OAKES_CLASSROOM, { draggable: true });
playerMarker.bindTooltip("That's you!");
playerMarker.addTo(map);

// PlayerInventory manages the player's coin inventory
class PlayerInventory {
  private inventory: Record<string, number> = {};

  // Add a coin to the player's inventory
  addItem(coinId: string) {
    this.inventory[coinId] = (this.inventory[coinId] || 0) + 1;
  }

  // Remove a coin from the player's inventory
  removeItem(coinId: string) {
    if (this.inventory[coinId]) {
      delete this.inventory[coinId];
    }
  }

  // Get all items (coins) the player currently holds
  getItems() {
    return this.inventory;
  }

  // Clear the player's inventory
  clear() {
    this.inventory = {};
  }
}

// UIManager handles updates to the global UI elements (like status panel)
class UIManager {
  static updateStatusPanel(inventory: Record<string, number>) {
    const statusPanel = document.getElementById(
      "statusPanel",
    ) as HTMLDivElement;
    const coinKeys = Object.keys(inventory);
    statusPanel.innerHTML = coinKeys.length > 0
      ? `Player Inventory: ${coinKeys.join(", ")}`
      : "Player Inventory: None";
  }
}

// CacheUI creates the popup UI for caches (the lootable containers in the world)
class CacheUI {
  static createPopup(
    coins: string[],
    onCollect: (coinId: string) => void,
    onDeposit: () => void,
    lat: number,
    lng: number,
  ): HTMLElement {
    // Create a popup element that shows the cache inventory and location
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `
      <div>Cache Inventory:</div>
      <ul id="coin-list">
        ${
      coins.map((coinId) =>
        `<li>${coinId} <button data-coin-id="${coinId}" class="collect-button">collect</button></li>`
      ).join("")
    }
      </ul>
      <button id="deposit">Deposit</button>
      <div>Cache Location: (${lat.toFixed(5)}, ${lng.toFixed(5)})</div>
    `;

    // Handle coin collection from the cache
    popupDiv.querySelectorAll<HTMLButtonElement>(".collect-button").forEach(
      (button) => {
        button.addEventListener("click", () => {
          const coinId = button.getAttribute("data-coin-id");
          if (coinId) {
            onCollect(coinId);
            button.parentElement?.remove();
          }
        });
      },
    );

    // Handle depositing a coin into the cache
    const depositBtn = popupDiv.querySelector<HTMLButtonElement>("#deposit");
    if (depositBtn) {
      depositBtn.addEventListener("click", () => {
        onDeposit();
      });
    }

    return popupDiv;
  }
}

// EventListener type for the event bus
type EventListener = (...args: unknown[]) => void;

// EventEmitter provides a simple publish-subscribe system for events
class EventEmitter {
  private events: Record<string, EventListener[]> = {};

  on(event: string, listener: EventListener): void {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
  }

  emit(event: string, ...args: unknown[]): void {
    if (this.events[event]) {
      this.events[event].forEach((listener) => listener(...args));
    }
  }
}

// Cacheable interface ensures classes can save/load their state via toMemento/fromMemento
interface Cacheable {
  toMemento(): string;
  fromMemento(memento: string): void;
}

// NumberUtils contains numeric utility functions
class NumberUtils {
  static roundToDecimals(num: number, decimals: number = 5): number {
    return parseFloat(num.toFixed(decimals));
  }
}

const playerInventory = new PlayerInventory();
const eventBus = new EventEmitter();

// Update the UI's status panel initially
UIManager.updateStatusPanel(playerInventory.getItems());

// A polyline to show the player's movement history on the map
const movementPolyline = leaflet.polyline([], { color: "red" }).addTo(map);

// Append new positions to the movement history
function updateMovementHistory(lat: number, lng: number) {
  const currentLatLng = leaflet.latLng(lat, lng);
  movementPolyline.addLatLng(currentLatLng);
}

// Cache represents a container of coins placed on the map
// It implements Cacheable, allowing it to save/load state
class Cache implements Cacheable {
  coins: string[];
  marker: leaflet.Marker | null;

  constructor(coins: string[] = [], lat: number, lng: number) {
    this.coins = coins;
    this.marker = leaflet.marker([lat, lng]);
  }

  toMemento(): string {
    return JSON.stringify({ coins: this.coins });
  }

  fromMemento(memento: string): void {
    const state = JSON.parse(memento);
    this.coins = state.coins;
  }

  // Attach a popup to the cache marker that shows its inventory
  bindPopup() {
    if (this.marker) {
      const latLng = this.marker.getLatLng();

      // Called when a coin is collected from the cache
      const onCollect = (coinId: string) => {
        this.coins = this.coins.filter((id) => id !== coinId);
        playerInventory.addItem(coinId);
        UIManager.updateStatusPanel(playerInventory.getItems());
        eventBus.emit("cacheUpdated", this);
        this.refreshPopupContent(latLng.lat, latLng.lng, onCollect, onDeposit);
      };

      // Called when depositing a coin into the cache from the player’s inventory
      const onDeposit = () => {
        const coinKeys = Object.keys(playerInventory.getItems());
        if (coinKeys.length > 0) {
          const depositCoinId = coinKeys[0];
          playerInventory.removeItem(depositCoinId);
          this.coins.push(depositCoinId);
          UIManager.updateStatusPanel(playerInventory.getItems());
          eventBus.emit("cacheUpdated", this);
          this.refreshPopupContent(
            latLng.lat,
            latLng.lng,
            onCollect,
            onDeposit,
          );
        }
      };

      // Create and bind the popup to the cache marker
      const popupContent = CacheUI.createPopup(
        this.coins,
        onCollect,
        onDeposit,
        latLng.lat,
        latLng.lng,
      );
      this.marker.bindPopup(popupContent);
    }
  }

  // Update the popup content if the cache changes (e.g., after collecting or depositing coins)
  private refreshPopupContent(
    lat: number,
    lng: number,
    onCollect: (coinId: string) => void,
    onDeposit: () => void,
  ) {
    if (this.marker && this.marker.getPopup()) {
      const newContent = CacheUI.createPopup(
        this.coins,
        onCollect,
        onDeposit,
        lat,
        lng,
      );
      this.marker.setPopupContent(newContent);
    }
  }
}

const cacheStorage: Record<string, Cache> = {};

// Create or retrieve caches within the game world
function spawnCache(i: number, j: number) {
  const cell = getCell(i, j);
  const cacheKey = `${cell.i},${cell.j}`;

  // If there's no cache at this cell, try to create one
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
          NumberUtils.roundToDecimals(
            OAKES_CLASSROOM.lat + cell.i * TILE_DEGREES,
          )
        },${
          NumberUtils.roundToDecimals(
            OAKES_CLASSROOM.lng + cell.j * TILE_DEGREES,
          )
        } #${index}`,
    );

    const lat = OAKES_CLASSROOM.lat + cell.i * TILE_DEGREES;
    const lng = OAKES_CLASSROOM.lng + cell.j * TILE_DEGREES;
    cacheStorage[cacheKey] = new Cache(coins, lat, lng);
  }

  const cache = cacheStorage[cacheKey];
  if (cache && !cache.marker) {
    cache.marker = leaflet.marker([
      OAKES_CLASSROOM.lat + cell.i * TILE_DEGREES,
      OAKES_CLASSROOM.lng + cell.j * TILE_DEGREES,
    ]);
    cache.marker.addTo(map);
    cache.bindPopup();
  }
}

// Update which caches are visible based on the player's position
function updateCacheVisibility(playerLat: number, playerLng: number) {
  Object.keys(cacheStorage).forEach((key) => {
    const [i, j] = key.split(",").map(Number);
    const cache = cacheStorage[key];

    const cacheLat = OAKES_CLASSROOM.lat + i * TILE_DEGREES;
    const cacheLng = OAKES_CLASSROOM.lng + j * TILE_DEGREES;
    const distance = Math.sqrt(
      Math.pow(playerLat - cacheLat, 2) + Math.pow(playerLng - cacheLng, 2),
    );

    // If the cache is within visible distance, show it; otherwise hide it
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

let lastPlayerCell = { i: 0, j: 0 };

// Determine the cell coordinates (i, j) of a given latitude/longitude position
function getPlayerCell(lat: number, lng: number) {
  const i = Math.floor((lat - OAKES_CLASSROOM.lat) / TILE_DEGREES);
  const j = Math.floor((lng - OAKES_CLASSROOM.lng) / TILE_DEGREES);
  return { i, j };
}

// Regenerate caches around the player's new position to ensure the world feels populated
function regenerateCachesAroundPlayer(lat: number, lng: number) {
  const { i: playerI, j: playerJ } = getPlayerCell(lat, lng);

  for (
    let x = playerI - NEIGHBORHOOD_SIZE;
    x <= playerI + NEIGHBORHOOD_SIZE;
    x++
  ) {
    for (
      let y = playerJ - NEIGHBORHOOD_SIZE;
      y <= playerJ + NEIGHBORHOOD_SIZE;
      y++
    ) {
      const cacheKey = `${x},${y}`;
      if (cacheStorage[cacheKey]) {
        spawnCache(x, y);
      } else if (luck([x, y].toString()) < CACHE_SPAWN_PROBABILITY) {
        spawnCache(x, y);
      }
    }
  }

  updateCacheVisibility(lat, lng);
}

// Move the player in a given direction (up, down, left, right)
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
  // If the player moves into a new cell, regenerate the caches
  if (
    newPlayerCell.i !== lastPlayerCell.i || newPlayerCell.j !== lastPlayerCell.j
  ) {
    regenerateCachesAroundPlayer(newLat, newLng);
    lastPlayerCell = newPlayerCell;
  }

  updateCacheVisibility(newLat, newLng);
  updateMovementHistory(newLat, newLng);
  saveGameState();

  const statusPanel = document.getElementById("statusPanel") as HTMLDivElement;
  statusPanel.innerHTML = `Player moved to: ${newLat.toFixed(5)}, ${
    newLng.toFixed(5)
  }`;
}

// Movement button event handlers
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

// Handle keyboard arrow keys for player movement
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

// Reset the game state completely
document.getElementById("reset")!.addEventListener("click", () => {
  const confirmed = confirm("Are you sure you want to reset the game state?");
  if (confirmed) {
    localStorage.clear();
    playerInventory.clear();
    movementPolyline.setLatLngs([]);
    UIManager.updateStatusPanel(playerInventory.getItems());
    map.setView(OAKES_CLASSROOM, GAMEPLAY_ZOOM_LEVEL);
    playerMarker.setLatLng(OAKES_CLASSROOM);
    lastPlayerCell = { i: 0, j: 0 };
    regenerateCachesAroundPlayer(OAKES_CLASSROOM.lat, OAKES_CLASSROOM.lng);
  }
});

// Attempt to track the user's real location (if supported)
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

// Save the current game state (position, inventory, movement history) to localStorage
function saveGameState() {
  const state = {
    playerPosition: playerMarker.getLatLng(),
    playerInventory: playerInventory.getItems(),
    movementHistory: movementPolyline.getLatLngs(),
  };
  localStorage.setItem("gameState", JSON.stringify(state));
}

type LatLng = { lat: number; lng: number };

// Load the previously saved game state (if any) from localStorage
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

    playerInventory.clear();
    for (const coinId in state.playerInventory) {
      if (Object.prototype.hasOwnProperty.call(state.playerInventory, coinId)) {
        const count = state.playerInventory[coinId];
        for (let i = 0; i < count; i++) {
          playerInventory.addItem(coinId);
        }
      }
    }

    movementPolyline.setLatLngs(
      state.movementHistory.map((pos) => leaflet.latLng(pos.lat, pos.lng)),
    );
    UIManager.updateStatusPanel(playerInventory.getItems());
    regenerateCachesAroundPlayer(lat, lng);
  }
}

// Load the saved game state at startup
loadGameState();

//commit
