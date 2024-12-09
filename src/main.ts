// @deno-types="npm:@types/leaflet@^1.9.14"
import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css";
import "./style.css";

// Deterministic random number generator
import luck from "./luck.ts";

// Location of our classroom
const OAKES_CLASSROOM = leaflet.latLng(36.989, -122.062);

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.02;
const MAX_COINS_PER_CACHE = 3;
const MOVEMENT_STEP = TILE_DEGREES;
const MAX_VISIBLE_DISTANCE = 0.001;

const cellCache: Record<string, { i: number; j: number }> = {};

function getCell(i: number, j: number) {
  const key = `${i},${j}`;
  if (!(key in cellCache)) {
    cellCache[key] = { i, j };
  }
  return cellCache[key];
}

// Create the map
const map = leaflet.map(document.getElementById("map")!, {
  center: OAKES_CLASSROOM,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: false,
});

leaflet
  .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  })
  .addTo(map);

const playerMarker = leaflet.marker(OAKES_CLASSROOM, { draggable: true });
playerMarker.bindTooltip("That's you!");
playerMarker.addTo(map);

// PlayerInventory负责玩家物品管理
class PlayerInventory {
  private inventory: Record<string, number> = {};

  addItem(coinId: string) {
    this.inventory[coinId] = (this.inventory[coinId] || 0) + 1;
  }

  removeItem(coinId: string) {
    if (this.inventory[coinId]) {
      delete this.inventory[coinId];
    }
  }

  getItems() {
    return this.inventory;
  }

  clear() {
    this.inventory = {};
  }
}

// UIManager负责全局UI更新
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

// CacheUI负责缓存UI弹窗创建
class CacheUI {
  static createPopup(
    coins: string[],
    onCollect: (coinId: string) => void,
    onDeposit: () => void,
    lat: number,
    lng: number,
  ): HTMLElement {
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

    // Collect按钮事件
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

    // Deposit按钮事件
    const depositBtn = popupDiv.querySelector<HTMLButtonElement>("#deposit");
    if (depositBtn) {
      depositBtn.addEventListener("click", () => {
        onDeposit();
      });
    }

    return popupDiv;
  }
}

// 事件总线（可选）
class EventEmitter {
  private events: Record<string, Function[]> = {};

  on(event: string, listener: Function) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
  }

  emit(event: string, ...args: any[]) {
    if (this.events[event]) {
      this.events[event].forEach((listener) => listener(...args));
    }
  }
}

// 定义Cacheable接口，Cache实现该接口专注于数据相关方法
interface Cacheable {
  toMemento(): string;
  fromMemento(memento: string): void;
}

// 将数值相关的实用函数分组在NumberUtils中
class NumberUtils {
  static roundToDecimals(num: number, decimals: number = 5): number {
    return parseFloat(num.toFixed(decimals));
  }
}

const playerInventory = new PlayerInventory();
const eventBus = new EventEmitter();

UIManager.updateStatusPanel(playerInventory.getItems());

const movementPolyline = leaflet.polyline([], { color: "red" }).addTo(map);

function updateMovementHistory(lat: number, lng: number) {
  const currentLatLng = leaflet.latLng(lat, lng);
  movementPolyline.addLatLng(currentLatLng);
}

// Cache类只负责缓存数据逻辑，并实现Cacheable接口
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

  bindPopup() {
    if (this.marker) {
      const latLng = this.marker.getLatLng();

      const onCollect = (coinId: string) => {
        this.coins = this.coins.filter((id) => id !== coinId);
        playerInventory.addItem(coinId);
        UIManager.updateStatusPanel(playerInventory.getItems());
        eventBus.emit("cacheUpdated", this);
        this.refreshPopupContent(latLng.lat, latLng.lng, onCollect, onDeposit);
      };

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

let lastPlayerCell = { i: 0, j: 0 };

function getPlayerCell(lat: number, lng: number) {
  const i = Math.floor((lat - OAKES_CLASSROOM.lat) / TILE_DEGREES);
  const j = Math.floor((lng - OAKES_CLASSROOM.lng) / TILE_DEGREES);
  return { i, j };
}

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

  const statusPanel = document.getElementById("statusPanel") as HTMLDivElement;
  statusPanel.innerHTML = `Player moved to: ${newLat.toFixed(5)}, ${
    newLng.toFixed(5)
  }`;
}

// Movement buttons
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

// Keyboard events
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

//Reset button
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

//Real location
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

function saveGameState() {
  const state = {
    playerPosition: playerMarker.getLatLng(),
    playerInventory: playerInventory.getItems(),
    movementHistory: movementPolyline.getLatLngs(),
  };
  localStorage.setItem("gameState", JSON.stringify(state));
}

type LatLng = { lat: number; lng: number };

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

loadGameState();
