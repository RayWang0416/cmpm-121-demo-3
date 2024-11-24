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
const CACHE_SPAWN_PROBABILITY = 0.1;
const MAX_COINS_PER_CACHE = 3;

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

// Populate the map with a background tile layer
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

// Store cache data globally to maintain state
const cacheData: Record<string, { coins: string[] }> = {};

// Add caches to the map by cell numbers
function spawnCache(i: number, j: number) {
  const cell = getCell(i, j);

  // Convert cell numbers into lat/lng bounds
  const origin = OAKES_CLASSROOM;
  const bounds = leaflet.latLngBounds([
    [origin.lat + cell.i * TILE_DEGREES, origin.lng + cell.j * TILE_DEGREES],
    [
      origin.lat + (cell.i + 1) * TILE_DEGREES,
      origin.lng + (cell.j + 1) * TILE_DEGREES,
    ],
  ]);
  cell.i = origin.lat + cell.i * TILE_DEGREES;
  cell.j = origin.lat + cell.j * TILE_DEGREES;
  // Add a rectangle to the map to represent the cache
  const rect = leaflet.rectangle(bounds);
  rect.addTo(map);

  // Generate a unique key for the cache based on its coordinates
  const cacheKey = `${cell.i},${cell.j}`;

  // Initialize coin IDs for the cache if not already set
  if (!(cacheKey in cacheData)) {
    const coinCount = Math.min(
      Math.floor(
        luck([cell.i, cell.j, "initialValue"].toString()) * MAX_COINS_PER_CACHE,
      ) + 1,
      MAX_COINS_PER_CACHE,
    );
    const coinIds = Array.from(
      { length: coinCount },
      (_, index) => `{i: ${cell.i}, j: ${cell.j}, # ${index}}`,
    );
    cacheData[cacheKey] = { coins: coinIds };
  }

  // Handle interactions with the cache
  rect.bindPopup(() => {
    // Use the existing coin count from cacheData
    let { coins } = cacheData[cacheKey];

    // The popup offers a description and buttons
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `
                <div>Cache at "${cell.i},${cell.j}". Inventory:</div>
                <ul id="coin-list">
                  ${
      coins.map((coinId) =>
        `<li>${coinId} <button data-coin-id="${coinId}" class="collect-button">collect</button></li>`
      ).join("")
    }
                </ul>
                <button id="deposit">Deposit</button>`;

    // Add event listeners for collect buttons
    popupDiv.querySelectorAll<HTMLButtonElement>(".collect-button").forEach(
      (button) => {
        button.addEventListener("click", () => {
          const coinId = button.getAttribute("data-coin-id");
          if (coinId) {
            coins = coins.filter((id) => id !== coinId);
            playerInventory[coinId] = (playerInventory[coinId] || 0) + 1;
            cacheData[cacheKey] = { coins };
            updateStatusPanel();
            button.parentElement!.remove();
          }
        });
      },
    );

    // Deposit button: Transfer coins from player inventory to cache
    popupDiv
      .querySelector<HTMLButtonElement>("#deposit")!
      .addEventListener("click", () => {
        const coinKeys = Object.keys(playerInventory);
        if (coinKeys.length > 0) {
          const depositCoinId = coinKeys[0];
          delete playerInventory[depositCoinId];
          coins.push(depositCoinId);
          cacheData[cacheKey] = { coins };
          updateStatusPanel();
          const coinList = popupDiv.querySelector("#coin-list")!;
          const newCoinItem = document.createElement("li");
          newCoinItem.innerHTML =
            `${depositCoinId} <button data-coin-id="${depositCoinId}" class="collect-button">collect</button>`;
          coinList.appendChild(newCoinItem);
          newCoinItem.querySelector<HTMLButtonElement>(".collect-button")!
            .addEventListener("click", () => {
              if (coins.indexOf(depositCoinId) !== -1) {
                coins = coins.filter((id) => id !== depositCoinId);
                playerInventory[depositCoinId] =
                  (playerInventory[depositCoinId] || 0) + 1;
                cacheData[cacheKey] = { coins };
                updateStatusPanel();
                newCoinItem.remove();
              }
            });
        }
      });

    return popupDiv;
  });
}

// Update the player's inventory status panel
function updateStatusPanel() {
  const coinKeys = Object.keys(playerInventory);
  statusPanel.innerHTML = coinKeys.length > 0
    ? `Player Inventory: ${coinKeys.join(", ")}`
    : "Player Inventory: None";
}

// Look around the player's neighborhood for caches to spawn
for (let i = -NEIGHBORHOOD_SIZE; i < NEIGHBORHOOD_SIZE; i++) {
  for (let j = -NEIGHBORHOOD_SIZE; j < NEIGHBORHOOD_SIZE; j++) {
    // If location i,j is lucky enough, spawn a cache!
    if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
      spawnCache(i, j);
    }
  }
}

// Implement player movement with arrow keys and update player's location
const MOVEMENT_STEP = TILE_DEGREES;
self.addEventListener("keydown", (event) => {
  let newLat = playerMarker.getLatLng().lat;
  let newLng = playerMarker.getLatLng().lng;

  switch (event.key) {
    case "ArrowUp":
      newLat += MOVEMENT_STEP;
      break;
    case "ArrowDown":
      newLat -= MOVEMENT_STEP;
      break;
    case "ArrowLeft":
      newLng -= MOVEMENT_STEP;
      break;
    case "ArrowRight":
      newLng += MOVEMENT_STEP;
      break;
    default:
      return; // Ignore other keys
  }

  const newPosition = leaflet.latLng(newLat, newLng);
  playerMarker.setLatLng(newPosition);
  map.panTo(newPosition);

  statusPanel.innerHTML = `Player moved to: ${newLat.toFixed(5)}, ${
    newLng.toFixed(5)
  }`;
});
